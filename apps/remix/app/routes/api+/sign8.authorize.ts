import crypto from 'node:crypto';
import { redirect } from 'react-router';

import { getSign8AuthorizationUrl } from '@documenso/lib/server-only/sign8/sign8-oauth';
import { getFileServerSide } from '@documenso/lib/universal/upload/get-file.server';
import { prisma } from '@documenso/prisma';
import { addSigningPlaceholder } from '@documenso/signing/helpers/add-signing-placeholder';
import { updateSigningPlaceholder } from '@documenso/signing/helpers/update-signing-placeholder';

import type { Route } from './+types/sign8.authorize';

/**
 * API endpoint to initiate Sign8 OAuth flow for QES signing
 *
 * Query Parameters:
 * - token: The recipient token
 * - returnUrl: URL to redirect to after signing
 *
 * Flow (CAdES detached - documentDigests approach):
 * 1. Get the original PDF
 * 2. Add signing placeholder to PDF (empty signature container)
 * 3. Update placeholder to calculate ByteRange offsets
 * 4. Extract ByteRange content (excluding placeholder) and compute SHA-256 hash
 * 5. Store prepared PDF, hash, and ByteRange in database
 * 6. Redirect to Sign8 OAuth with the hash
 * 7. After callback, call signDoc with documentDigests (not full document)
 * 8. Sign8 returns CMS/PKCS#7 signature (SignatureObject)
 * 9. Embed CMS signature into prepared PDF at placeholder position
 */
export const loader = async ({ request }: Route.LoaderArgs) => {
  const url = new URL(request.url);
  const token = url.searchParams.get('token');
  const returnUrl = url.searchParams.get('returnUrl');

  if (!token) {
    return Response.json({ error: 'Missing recipient token' }, { status: 400 });
  }

  if (!returnUrl) {
    return Response.json({ error: 'Missing return URL' }, { status: 400 });
  }

  // Get the recipient with envelope and document data
  const recipient = await prisma.recipient.findFirst({
    where: { token },
    select: {
      id: true,
      signatureLevel: true,
      signingStatus: true,
      envelope: {
        select: {
          id: true,
          envelopeItems: {
            select: {
              id: true,
              documentData: true,
            },
            orderBy: {
              order: 'asc',
            },
            take: 1,
          },
        },
      },
    },
  });

  if (!recipient) {
    return Response.json({ error: 'Recipient not found' }, { status: 404 });
  }

  if (recipient.signatureLevel !== 'QES') {
    return Response.json(
      { error: 'This recipient is not configured for QES signing' },
      { status: 400 },
    );
  }

  if (recipient.signingStatus === 'SIGNED') {
    return Response.json({ error: 'Document already signed' }, { status: 400 });
  }

  const firstEnvelopeItem = recipient.envelope?.envelopeItems[0];
  if (!firstEnvelopeItem?.documentData) {
    return Response.json({ error: 'Document data not found' }, { status: 404 });
  }

  try {
    // Get the actual PDF file content
    const pdfContent = await getFileServerSide(firstEnvelopeItem.documentData);
    const pdfBuffer = Buffer.isBuffer(pdfContent) ? pdfContent : Buffer.from(pdfContent);

    console.log('Sign8 authorize - Original PDF size:', pdfBuffer.length, 'bytes');

    // CAdES detached flow: Prepare PDF with signature placeholder
    // Step 1: Add signing placeholder (empty signature container)
    const pdfWithPlaceholder = await addSigningPlaceholder({ pdf: pdfBuffer });
    console.log('Sign8 authorize - PDF with placeholder size:', pdfWithPlaceholder.length, 'bytes');

    // Step 2: Update placeholder to calculate ByteRange offsets
    const { pdf: preparedPdf, byteRange } = updateSigningPlaceholder({ pdf: pdfWithPlaceholder });
    console.log('Sign8 authorize - ByteRange:', byteRange);

    // Step 3: Extract ByteRange content (excluding signature placeholder) and hash it
    // ByteRange format: [offset1, length1, offset2, length2]
    // Content to sign = bytes[0..byteRange[1]] + bytes[byteRange[2]..end]
    const contentToSign = Buffer.concat([
      preparedPdf.subarray(0, byteRange[1]),
      preparedPdf.subarray(byteRange[2]),
    ]);

    // Compute SHA-256 hash of ByteRange content in Standard Base64 format
    const documentHash = crypto.createHash('sha256').update(contentToSign).digest('base64');

    console.log('Sign8 authorize - Content to sign size:', contentToSign.length, 'bytes');
    console.log('Sign8 authorize - Document hash (SHA-256, Standard Base64):', documentHash);

    // Delete any existing pending signature for this recipient
    await prisma.sign8QESPendingSignature.deleteMany({
      where: { recipientId: recipient.id },
    });

    // Store prepared PDF (with placeholder), hash, and ByteRange for callback
    // CAdES detached approach - Sign8 will return CMS signature to embed
    const pendingSignature = await prisma.sign8QESPendingSignature.create({
      data: {
        recipientId: recipient.id,
        preparedPdfData: preparedPdf.toString('base64'), // PDF with signature placeholder
        documentHash, // SHA-256 of ByteRange content (Standard Base64)
        byteRange: JSON.stringify(byteRange), // ByteRange for signature embedding
        expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes expiry
      },
    });

    const authorizationUrl = getSign8AuthorizationUrl({
      recipientToken: token,
      documentHash,
      returnUrl,
      pendingSignatureId: pendingSignature.id,
    });

    console.log('Sign8 authorize - Redirecting to:', authorizationUrl);

    return redirect(authorizationUrl);
  } catch (error) {
    console.error('Sign8 authorization error:', error);
    console.error('Error stack:', error instanceof Error ? error.stack : 'No stack');
    return Response.json(
      {
        error: 'Failed to initiate Sign8 authentication',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
};
