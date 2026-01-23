import type { SignatureLevel } from '@prisma/client';

/**
 * Information about an external QES signature from Sign8
 */
export type ExternalSignatureInfo = {
  recipientId: number;
  recipientName: string;
  recipientEmail: string;
  signatureLevel: SignatureLevel;
  sign8SignatureData: string; // Base64 encoded PKCS#7/CMS signature
  signedAt: Date;
};

/**
 * Extract QES signature information from recipients and their signatures.
 * This is used for audit logging and certificate generation.
 *
 * Note: Full PDF multi-signature embedding would require significant PDF
 * structure modifications. For the initial implementation, we store the
 * QES signatures in the database and include them in the audit trail.
 * The final document is sealed with the organization's certificate.
 */
export const extractQESSignatures = (
  recipients: Array<{
    id: number;
    name: string;
    email: string;
    signatureLevel: SignatureLevel;
    signedAt?: Date | null;
    fields?: Array<{
      signature?: {
        signatureLevel?: SignatureLevel | null;
        sign8SignatureData?: string | null;
        created: Date;
      } | null;
    }>;
  }>,
): ExternalSignatureInfo[] => {
  const qesSignatures: ExternalSignatureInfo[] = [];

  for (const recipient of recipients) {
    // Check if recipient has QES signature level
    if (recipient.signatureLevel !== 'QES') {
      continue;
    }

    // Find signature with QES data
    const qesField = recipient.fields?.find(
      (field) => field.signature?.signatureLevel === 'QES' && field.signature?.sign8SignatureData,
    );

    if (qesField?.signature?.sign8SignatureData) {
      qesSignatures.push({
        recipientId: recipient.id,
        recipientName: recipient.name,
        recipientEmail: recipient.email,
        signatureLevel: 'QES',
        sign8SignatureData: qesField.signature.sign8SignatureData,
        signedAt: qesField.signature.created,
      });
    }
  }

  return qesSignatures;
};

/**
 * Format QES signature information for audit log purposes
 */
export const formatQESSignaturesForAuditLog = (
  qesSignatures: ExternalSignatureInfo[],
): string[] => {
  return qesSignatures.map(
    (sig) =>
      `QES Signature by ${sig.recipientName} (${sig.recipientEmail}) at ${sig.signedAt.toISOString()}`,
  );
};
