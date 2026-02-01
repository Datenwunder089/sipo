import { PDFDocument } from '@cantoo/pdf-lib';
import { FieldType } from '@prisma/client';
import crypto from 'node:crypto';
import { redirect } from 'react-router';

import { insertFieldsIntoPdf } from '@documenso/lib/server-only/pdf/insert-fields-into-pdf';
import { getSign8AuthorizationUrl } from '@documenso/lib/server-only/sign8/sign8-oauth';
import { getFileServerSide } from '@documenso/lib/universal/upload/get-file.server';
import { prisma } from '@documenso/prisma';
import type { FieldWithSignature } from '@documenso/prisma/types/field-with-signature';
import { addSigningPlaceholder } from '@documenso/signing/helpers/add-signing-placeholder';
import { updateSigningPlaceholder } from '@documenso/signing/helpers/update-signing-placeholder';

import type { Route } from './+types/sign8.authorize';

/**
 * API endpoint to initiate Sign8 OAuth flow for QES signing
 *
 * POST Body (form data):
 * - token: The recipient token
 * - returnUrl: URL to redirect to after signing
 * - fullName: Optional full name for visual signature
 * - signature: Optional signature (base64 image or text)
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
export const action = async ({ request }: Route.ActionArgs) => {
  // Parse form data from POST body
  const formData = await request.formData();
  const token = formData.get('token') as string | null;
  const returnUrl = formData.get('returnUrl') as string | null;
  const fullName = formData.get('fullName') as string | null;
  const signatureParam = formData.get('signature') as string | null;

  if (!token) {
    return Response.json({ error: 'Missing recipient token' }, { status: 400 });
  }

  if (!returnUrl) {
    return Response.json({ error: 'Missing return URL' }, { status: 400 });
  }

  // Get the recipient with envelope, document data, and fields
  const recipient = await prisma.recipient.findFirst({
    where: { token },
    select: {
      id: true,
      name: true,
      signatureLevel: true,
      signingStatus: true,
      fields: {
        include: {
          signature: true,
        },
      },
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

  // Only allow QES and AES signature levels for Sign8 signing
  if (recipient.signatureLevel !== 'QES' && recipient.signatureLevel !== 'AES') {
    return Response.json(
      { error: 'This recipient is not configured for QES or AES signing' },
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
    let pdfBuffer = Buffer.isBuffer(pdfContent) ? pdfContent : Buffer.from(pdfContent);

    console.log('Sign8 authorize - Original PDF size:', pdfBuffer.length, 'bytes');

    // Prepare fields for visual rendering
    // Determine if signature is base64 image or text
    const isBase64Signature = signatureParam?.startsWith('data:image/');
    const signatureValue = signatureParam || fullName || recipient.name || 'QES Signature';

    // Build virtual "inserted" fields for visual rendering
    const fieldsToRender: FieldWithSignature[] = recipient.fields
      .filter((field) => field.type === FieldType.SIGNATURE)
      .map((field) => ({
        ...field,
        inserted: true,
        customText: isBase64Signature ? '' : signatureValue,
        signature: {
          id: 0,
          created: new Date(),
          recipientId: recipient.id,
          fieldId: field.id,
          // Use base64 image if provided, otherwise null
          signatureImageAsBase64: isBase64Signature ? signatureParam : null,
          // Use typed text if not base64
          typedSignature: isBase64Signature ? null : signatureValue,
          signatureLevel: recipient.signatureLevel,
          sign8SignatureData: null,
          sign8PendingSignatureId: null,
          sign8CredentialId: null,
        },
      }));

    console.log('Sign8 authorize - Fields to render:', fieldsToRender.length);

    // Insert visual signature appearances into the PDF
    if (fieldsToRender.length > 0) {
      pdfBuffer = await insertFieldsIntoPdf({
        pdf: pdfBuffer,
        fields: fieldsToRender,
      });
      console.log('Sign8 authorize - PDF with fields size:', pdfBuffer.length, 'bytes');
    }

    // CAdES detached flow: Prepare PDF with signature placeholder
    // Collect ALL signature field positions for clickable areas
    const signatureFieldsFromRecipient = recipient.fields.filter(
      (f) => f.type === FieldType.SIGNATURE,
    );

    // Convert field positions to PDF coordinates
    // Note: Field positions are stored as percentages of page size
    // PDF coordinates are from bottom-left in points
    const signatureFieldPositions: Array<{
      page: number;
      x: number;
      y: number;
      width: number;
      height: number;
    }> = [];

    if (signatureFieldsFromRecipient.length > 0) {
      // Get PDF page dimensions
      const pdfDoc = await PDFDocument.load(pdfBuffer);

      for (const signatureField of signatureFieldsFromRecipient) {
        const page = pdfDoc.getPage(signatureField.page - 1);
        const { width: pageWidth, height: pageHeight } = page.getSize();

        // Convert percentage to PDF points
        // positionX/Y are percentages (0-100), width/height are also percentages
        // Convert Decimal types to numbers
        const fieldPosX = Number(signatureField.positionX);
        const fieldPosY = Number(signatureField.positionY);
        const fieldWidth = Number(signatureField.width);
        const fieldHeight = Number(signatureField.height);

        // Skip fields with invalid dimensions
        if (fieldWidth <= 0 || fieldHeight <= 0) {
          continue;
        }

        const x = (fieldPosX / 100) * pageWidth;
        const y = pageHeight - (fieldPosY / 100) * pageHeight - (fieldHeight / 100) * pageHeight; // Flip Y coordinate
        const width = (fieldWidth / 100) * pageWidth;
        const height = (fieldHeight / 100) * pageHeight;

        signatureFieldPositions.push({
          page: signatureField.page,
          x,
          y,
          width,
          height,
        });
      }

      console.log('Sign8 authorize - Signature field positions:', signatureFieldPositions);
    }

    // Step 1: Add signing placeholder (empty signature container)
    const pdfWithPlaceholder = await addSigningPlaceholder({
      pdf: pdfBuffer,
      signatureFields: signatureFieldPositions.length > 0 ? signatureFieldPositions : undefined,
    });
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
      signatureLevel: recipient.signatureLevel as 'QES' | 'AES',
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
