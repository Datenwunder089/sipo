import { useEffect, useMemo, useRef } from 'react';

import { Trans, useLingui } from '@lingui/react/macro';
import { SignatureLevel } from '@prisma/client';
import { BadgeCheckIcon, ShieldAlertIcon } from 'lucide-react';
import { useSearchParams } from 'react-router';

import { Alert, AlertDescription, AlertTitle } from '@documenso/ui/primitives/alert';
import { useToast } from '@documenso/ui/primitives/use-toast';

import { useRequiredEnvelopeSigningContext } from './envelope-signing-provider';

export type DocumentSigningSign8QESProps = {
  recipientName: string;
  recipientEmail: string;
  signatureLevel: SignatureLevel;
  onSign8Complete: (signatureData: {
    signature: string;
    credentialId: string;
    pendingSignatureId: string;
    hasSignedPdf?: boolean;
  }) => void | Promise<void>;
  onSign8Error?: (error: string) => void;
};

export const DocumentSigningSign8QES = ({
  recipientName,
  recipientEmail,
  signatureLevel,
  onSign8Complete,
  onSign8Error,
}: DocumentSigningSign8QESProps) => {
  const { t } = useLingui();
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const { sign8FlowState, setSign8FlowState } = useRequiredEnvelopeSigningContext();

  // Refs to prevent double-processing and capture initial params
  const processedCallbackRef = useRef(false);
  const initialParamsRef = useRef<{
    sign8Success: string | null;
    sign8Signature: string | null;
    sign8SignedPdf: string | null;
    sign8Credential: string | null;
    sign8PendingId: string | null;
    sign8ErrorParam: string | null;
    sign8ErrorMessage: string | null;
  } | null>(null);

  // Capture params on mount
  if (initialParamsRef.current === null) {
    initialParamsRef.current = {
      sign8Success: searchParams.get('sign8_success'),
      sign8Signature: searchParams.get('sign8_signature'),
      sign8SignedPdf: searchParams.get('sign8_signed_pdf'),
      sign8Credential: searchParams.get('sign8_credential'),
      sign8PendingId: searchParams.get('sign8_pending_id'),
      sign8ErrorParam: searchParams.get('sign8_error'),
      sign8ErrorMessage: searchParams.get('sign8_error_message'),
    };
  }

  // Check if we're in the middle of a Sign8 callback (used for early loading state)
  const isSign8CallbackPending = useMemo(() => {
    const params = initialParamsRef.current;
    if (!params || processedCallbackRef.current) return false;

    const hasSignature = params.sign8Signature !== null;
    const hasSignedPdf = params.sign8SignedPdf === 'true';

    return (
      (params.sign8Success === 'true' &&
        (hasSignature || hasSignedPdf) &&
        params.sign8Credential &&
        params.sign8PendingId) ||
      params.sign8ErrorParam === 'true'
    );
  }, []);

  // Handle Sign8 callback parameters - runs once on mount
  useEffect(() => {
    if (processedCallbackRef.current) {
      return;
    }

    const params = initialParamsRef.current;
    if (!params) {
      return;
    }

    const {
      sign8Success,
      sign8Signature,
      sign8SignedPdf,
      sign8Credential,
      sign8PendingId,
      sign8ErrorParam,
      sign8ErrorMessage,
    } = params;

    const hasSignature = sign8Signature !== null;
    const hasSignedPdf = sign8SignedPdf === 'true';

    if (
      sign8Success === 'true' &&
      (hasSignature || hasSignedPdf) &&
      sign8Credential &&
      sign8PendingId
    ) {
      processedCallbackRef.current = true;

      // Create cleanup function but DON'T call yet
      const cleanupParams = () => {
        const newParams = new URLSearchParams(window.location.search);
        newParams.delete('sign8_success');
        newParams.delete('sign8_signature');
        newParams.delete('sign8_signed_pdf');
        newParams.delete('sign8_credential');
        newParams.delete('sign8_pending_id');
        setSearchParams(newParams, { replace: true });
      };

      // Start the unified flow
      setSign8FlowState({
        step: 'verifying',
        progress: 10,
        fieldsCompleted: 0,
        fieldsTotal: 0,
        error: null,
      });

      const executeFlow = async () => {
        try {
          await onSign8Complete({
            signature: sign8Signature || '',
            credentialId: sign8Credential,
            pendingSignatureId: sign8PendingId,
            hasSignedPdf,
          });

          // Success state will be set by the complete dialog after document completion
          // Clean up params only after successful completion
          cleanupParams();
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : t`Failed to sign fields`;

          setSign8FlowState({
            step: 'error',
            progress: 0,
            fieldsCompleted: 0,
            fieldsTotal: 0,
            error: errorMsg,
          });

          toast({
            title: t`Sign8 Error`,
            description: errorMsg,
            variant: 'destructive',
          });

          // Clean up params on error too
          cleanupParams();
        }
      };

      void executeFlow();
    } else if (sign8ErrorParam === 'true') {
      processedCallbackRef.current = true;

      const errorMsg = sign8ErrorMessage || t`Failed to sign with Sign8`;

      // Clean the URL parameters for error case
      const newParams = new URLSearchParams(window.location.search);
      newParams.delete('sign8_error');
      newParams.delete('sign8_error_message');
      setSearchParams(newParams, { replace: true });

      setSign8FlowState({
        step: 'error',
        progress: 0,
        fieldsCompleted: 0,
        fieldsTotal: 0,
        error: errorMsg,
      });

      onSign8Error?.(errorMsg);

      toast({
        title: t`Sign8 Error`,
        description: errorMsg,
        variant: 'destructive',
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Only show for QES and AES recipients (both use Sign8)
  if (signatureLevel !== SignatureLevel.QES && signatureLevel !== SignatureLevel.AES) {
    return null;
  }

  const isQES = signatureLevel === SignatureLevel.QES;

  // When flow is active (not idle and not error), the overlay handles display
  // Also hide if we're waiting for Sign8 callback to be processed (prevents hopping)
  if (sign8FlowState.step !== 'idle' && sign8FlowState.step !== 'error') {
    return null;
  }

  // If Sign8 callback is pending (params in URL but not yet processed), show nothing
  // The overlay will show once the useEffect processes the params
  if (isSign8CallbackPending && sign8FlowState.step === 'idle') {
    return null;
  }

  // Show error state if there was an error
  if (sign8FlowState.step === 'error') {
    return (
      <div className="space-y-4">
        <Alert className="border-blue-500 bg-blue-50 dark:bg-blue-950">
          <BadgeCheckIcon className="h-5 w-5 text-blue-600" />
          <AlertTitle className="text-blue-800 dark:text-blue-200">
            {isQES ? (
              <Trans>Qualified Electronic Signature (QES) Required</Trans>
            ) : (
              <Trans>Advanced Electronic Signature (AES) Required</Trans>
            )}
          </AlertTitle>
          <AlertDescription className="text-blue-700 dark:text-blue-300">
            {isQES ? (
              <Trans>
                This document requires a qualified electronic signature. Click "Complete" to be
                redirected to Sign8 where you will authenticate with your qualified certificate.
              </Trans>
            ) : (
              <Trans>
                This document requires an advanced electronic signature. Click "Complete" to be
                redirected to Sign8 where you will authenticate securely.
              </Trans>
            )}
          </AlertDescription>
        </Alert>

        <Alert variant="destructive">
          <ShieldAlertIcon className="h-5 w-5" />
          <AlertTitle>
            <Trans>Sign8 Authentication Failed</Trans>
          </AlertTitle>
          <AlertDescription>{sign8FlowState.error}</AlertDescription>
        </Alert>

        <div className="rounded-lg border bg-card p-4">
          <h3 className="text-sm font-medium text-muted-foreground">
            <Trans>Signing as</Trans>
          </h3>
          <p className="text-base font-semibold">{recipientName}</p>
          <p className="text-sm text-muted-foreground">{recipientEmail}</p>
        </div>
      </div>
    );
  }

  // Default idle state - show info about signature requirement
  return (
    <div className="space-y-4">
      <Alert className="border-blue-500 bg-blue-50 dark:bg-blue-950">
        <BadgeCheckIcon className="h-5 w-5 text-blue-600" />
        <AlertTitle className="text-blue-800 dark:text-blue-200">
          {isQES ? (
            <Trans>Qualified Electronic Signature (QES) Required</Trans>
          ) : (
            <Trans>Advanced Electronic Signature (AES) Required</Trans>
          )}
        </AlertTitle>
        <AlertDescription className="text-blue-700 dark:text-blue-300">
          {isQES ? (
            <Trans>
              This document requires a qualified electronic signature. Click "Complete" to be
              redirected to Sign8 where you will authenticate with your qualified certificate.
            </Trans>
          ) : (
            <Trans>
              This document requires an advanced electronic signature. Click "Complete" to be
              redirected to Sign8 where you will authenticate securely.
            </Trans>
          )}
        </AlertDescription>
      </Alert>

      <div className="rounded-lg border bg-card p-4">
        <h3 className="text-sm font-medium text-muted-foreground">
          <Trans>Signing as</Trans>
        </h3>
        <p className="text-base font-semibold">{recipientName}</p>
        <p className="text-sm text-muted-foreground">{recipientEmail}</p>
      </div>
    </div>
  );
};
