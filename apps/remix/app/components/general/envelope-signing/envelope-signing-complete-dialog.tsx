import { useCallback, useEffect, useMemo, useRef } from 'react';

import { useLingui } from '@lingui/react/macro';
import { FieldType, SignatureLevel, SigningStatus } from '@prisma/client';
import { useLocation, useNavigate, useRevalidator, useSearchParams } from 'react-router';

import { useAnalytics } from '@documenso/lib/client-only/hooks/use-analytics';
import { useCurrentEnvelopeRender } from '@documenso/lib/client-only/providers/envelope-render-provider';
import { isBase64Image } from '@documenso/lib/constants/signatures';
import { AppError, AppErrorCode } from '@documenso/lib/errors/app-error';
import type { TRecipientAccessAuth } from '@documenso/lib/types/document-auth';
import { mapSecondaryIdToDocumentId } from '@documenso/lib/utils/envelope';
import { trpc } from '@documenso/trpc/react';
import { useToast } from '@documenso/ui/primitives/use-toast';

import { useEmbedSigningContext } from '~/components/embed/embed-signing-context';

import { DocumentSigningCompleteDialog } from '../document-signing/document-signing-complete-dialog';
import { useRequiredEnvelopeSigningContext } from '../document-signing/envelope-signing-provider';
import { INITIAL_SIGN8_FLOW_STATE } from '../document-signing/sign8-flow-types';

export const EnvelopeSignerCompleteDialog = () => {
  const navigate = useNavigate();
  const analytics = useAnalytics();

  const { t } = useLingui();
  const { toast } = useToast();
  const { revalidate } = useRevalidator();

  const [searchParams] = useSearchParams();

  const {
    isDirectTemplate,
    envelope,
    setShowPendingFieldTooltip,
    recipientFieldsRemaining,
    recipient,
    nextRecipient,
    email,
    fullName,
    signature,
    sign8SignatureData,
    sign8FlowState,
    setSign8FlowState,
  } = useRequiredEnvelopeSigningContext();

  const location = useLocation();
  const isQESRecipient = recipient.signatureLevel === SignatureLevel.QES;
  const isAESRecipient = recipient.signatureLevel === SignatureLevel.AES;
  const requiresSign8 = isQESRecipient || isAESRecipient;

  const { currentEnvelopeItem, setCurrentEnvelopeItem } = useCurrentEnvelopeRender();

  const { onDocumentCompleted, onDocumentError } = useEmbedSigningContext() || {};

  const { mutateAsync: completeDocument, isPending } =
    trpc.recipient.completeDocumentWithToken.useMutation();

  const { mutateAsync: createDocumentFromDirectTemplate } =
    trpc.template.createDocumentFromDirectTemplate.useMutation();

  // Ref to prevent double-triggering auto-completion
  const autoCompleteTriggeredRef = useRef(false);

  const handleOnCompleteClick = useCallback(
    async (
      nextSigner?: { name: string; email: string },
      accessAuthOptions?: TRecipientAccessAuth,
      recipientDetails?: { name: string; email: string },
    ) => {
      try {
        await completeDocument({
          token: recipient.token,
          documentId: mapSecondaryIdToDocumentId(envelope.secondaryId),
          accessAuthOptions,
          recipientOverride: recipientDetails,
          ...(nextSigner?.email && nextSigner?.name ? { nextSigner } : {}),
        });

        analytics.capture('App: Recipient has completed signing', {
          signerId: recipient.id,
          documentId: envelope.id,
          timestamp: new Date().toISOString(),
        });

        // Set success state for the overlay
        if (sign8FlowState.step !== 'idle') {
          setSign8FlowState({
            step: 'success',
            progress: 100,
            fieldsCompleted: sign8FlowState.fieldsTotal,
            fieldsTotal: sign8FlowState.fieldsTotal,
            error: null,
          });
        }

        if (onDocumentCompleted) {
          onDocumentCompleted({
            token: recipient.token,
            documentId: mapSecondaryIdToDocumentId(envelope.secondaryId),
            recipientId: recipient.id,
            envelopeId: envelope.id,
          });

          await revalidate();

          // Reset flow state after embed completion
          setSign8FlowState(INITIAL_SIGN8_FLOW_STATE);

          return;
        }

        if (envelope.documentMeta.redirectUrl) {
          window.location.href = envelope.documentMeta.redirectUrl;
        } else {
          await navigate(`/sign/${recipient.token}/complete`);
        }
      } catch (err) {
        const error = AppError.parseError(err);

        // Reset flow state on error
        if (sign8FlowState.step !== 'idle') {
          setSign8FlowState({
            step: 'error',
            progress: 0,
            fieldsCompleted: 0,
            fieldsTotal: 0,
            error: error.message,
          });
        }

        if (error.code !== AppErrorCode.TWO_FACTOR_AUTH_FAILED) {
          toast({
            title: t`Something went wrong`,
            description: t`We were unable to submit this document at this time. Please try again later.`,
            variant: 'destructive',
          });

          onDocumentError?.();
        }

        throw err;
      }
    },
    [
      completeDocument,
      recipient.token,
      recipient.id,
      envelope.secondaryId,
      envelope.id,
      envelope.documentMeta.redirectUrl,
      analytics,
      sign8FlowState,
      setSign8FlowState,
      onDocumentCompleted,
      revalidate,
      navigate,
      toast,
      t,
      onDocumentError,
    ],
  );

  // Auto-complete after Sign8 flow reaches 'completing' state
  useEffect(() => {
    if (
      requiresSign8 &&
      sign8FlowState.step === 'completing' &&
      recipientFieldsRemaining.length === 0 &&
      !autoCompleteTriggeredRef.current &&
      !isPending
    ) {
      autoCompleteTriggeredRef.current = true;

      void handleOnCompleteClick();
    }
  }, [
    requiresSign8,
    sign8FlowState.step,
    recipientFieldsRemaining.length,
    isPending,
    handleOnCompleteClick,
  ]);

  const handleSign8Required = useCallback(() => {
    const returnUrl = `${window.location.origin}${location.pathname}`;

    // Create a hidden form to POST the data (avoids URL length limits for base64 signatures)
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = '/api/sign8/authorize';
    form.style.display = 'none';

    const addField = (name: string, value: string) => {
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = name;
      input.value = value;
      form.appendChild(input);
    };

    addField('token', recipient.token);
    addField('returnUrl', returnUrl);

    if (fullName) {
      addField('fullName', fullName);
    }

    if (signature) {
      addField('signature', signature);
    }

    document.body.appendChild(form);
    form.submit();
  }, [location.pathname, recipient.token, fullName, signature]);

  const handleOnNextFieldClick = () => {
    const nextField = recipientFieldsRemaining[0];

    if (!nextField) {
      setShowPendingFieldTooltip(false);
      return;
    }

    const isEnvelopeItemSwitch = nextField.envelopeItemId !== currentEnvelopeItem?.id;

    if (isEnvelopeItemSwitch) {
      setCurrentEnvelopeItem(nextField.envelopeItemId);
    }

    setShowPendingFieldTooltip(true);

    setTimeout(
      () => {
        const fieldTooltip = document.querySelector(`#field-tooltip`);

        if (fieldTooltip) {
          fieldTooltip.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      },
      isEnvelopeItemSwitch ? 150 : 50,
    );
  };

  /**
   * Direct template completion flow.
   */
  const handleDirectTemplateCompleteClick = async (
    nextSigner?: { name: string; email: string },
    accessAuthOptions?: TRecipientAccessAuth,
    recipientDetails?: { name: string; email: string },
  ) => {
    try {
      let directTemplateExternalId = searchParams?.get('externalId') || undefined;

      if (directTemplateExternalId) {
        directTemplateExternalId = decodeURIComponent(directTemplateExternalId);
      }

      if (!recipient.directToken) {
        throw new Error('Recipient direct token is required');
      }

      const { token } = await createDocumentFromDirectTemplate({
        directTemplateToken: recipient.directToken, // The direct template token is inserted into the recipient token for ease of use.
        directTemplateExternalId,
        directRecipientName: recipientDetails?.name || fullName,
        directRecipientEmail: recipientDetails?.email || email,
        templateUpdatedAt: envelope.updatedAt,
        signedFieldValues: recipient.fields.map((field) => {
          let value = field.customText;
          let isBase64 = false;

          if (field.type === FieldType.SIGNATURE && field.signature) {
            value = field.signature.signatureImageAsBase64 || field.signature.typedSignature || '';
            isBase64 = isBase64Image(value);
          }

          return {
            token: '',
            fieldId: field.id,
            value,
            isBase64,
          };
        }),
        nextSigner,
      });

      const redirectUrl = envelope.documentMeta.redirectUrl;

      if (onDocumentCompleted) {
        await navigate({
          pathname: `/embed/sign/${token}`,
          search: window.location.search,
          hash: window.location.hash,
        });

        return;
      }

      if (redirectUrl) {
        window.location.href = redirectUrl;
      } else {
        await navigate(`/sign/${token}/complete`);
      }
    } catch (err) {
      console.log('err', err);
      toast({
        title: t`Something went wrong`,
        description: t`We were unable to submit this document at this time. Please try again later.`,
        variant: 'destructive',
      });

      onDocumentError?.();

      throw err;
    }
  };

  const recipientPayload = useMemo(() => {
    if (!isDirectTemplate) {
      return {
        name:
          recipient.name ||
          recipient.fields.find((field) => field.type === FieldType.NAME)?.customText ||
          '',
        email:
          recipient.email ||
          recipient.fields.find((field) => field.type === FieldType.EMAIL)?.customText ||
          '',
      };
    }

    return {
      name: fullName,
      email: email,
    };
  }, [email, fullName, isDirectTemplate, recipient.email, recipient.name, recipient.fields]);

  // Don't show the complete button if the recipient has already signed
  if (recipient.signingStatus === SigningStatus.SIGNED) {
    return null;
  }

  // When Sign8 flow is active (not idle), the overlay handles display - hide the button
  if (sign8FlowState.step !== 'idle' && sign8FlowState.step !== 'error') {
    return null;
  }

  return (
    <DocumentSigningCompleteDialog
      isSubmitting={isPending}
      recipientPayload={recipientPayload}
      onSignatureComplete={
        isDirectTemplate ? handleDirectTemplateCompleteClick : handleOnCompleteClick
      }
      documentTitle={envelope.title}
      fields={recipientFieldsRemaining}
      fieldsValidated={handleOnNextFieldClick}
      recipient={recipient}
      allowDictateNextSigner={Boolean(
        nextRecipient && envelope.documentMeta.allowDictateNextSigner,
      )}
      disableNameInput={!isDirectTemplate && recipient.name !== ''}
      defaultNextSigner={
        nextRecipient ? { name: nextRecipient.name, email: nextRecipient.email } : undefined
      }
      buttonSize="sm"
      position="center"
      requiresSign8={requiresSign8}
      sign8SignatureData={sign8SignatureData}
      onSign8Required={handleSign8Required}
    />
  );
};
