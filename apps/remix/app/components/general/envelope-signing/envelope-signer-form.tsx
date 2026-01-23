import { useMemo } from 'react';

import { Plural, Trans } from '@lingui/react/macro';
import { FieldType, RecipientRole, SignatureLevel } from '@prisma/client';

import { Input } from '@documenso/ui/primitives/input';
import { Label } from '@documenso/ui/primitives/label';
import { RadioGroup, RadioGroupItem } from '@documenso/ui/primitives/radio-group';
import { SignaturePadDialog } from '@documenso/ui/primitives/signature-pad/signature-pad-dialog';

import { useEmbedSigningContext } from '~/components/embed/embed-signing-context';

import { DocumentSigningSign8QES } from '../document-signing/document-signing-sign8-qes';
import { useRequiredEnvelopeSigningContext } from '../document-signing/envelope-signing-provider';

export default function EnvelopeSignerForm() {
  const {
    fullName,
    signature,
    setFullName,
    setSignature,
    envelope,
    recipientFields,
    recipient,
    assistantFields,
    assistantRecipients,
    selectedAssistantRecipient,
    setSelectedAssistantRecipientId,
    sign8SignatureData,
    setSign8SignatureData,
  } = useRequiredEnvelopeSigningContext();

  const { isNameLocked, isEmailLocked } = useEmbedSigningContext() || {};

  const hasSignatureField = useMemo(() => {
    return recipientFields.some((field) => field.type === FieldType.SIGNATURE);
  }, [recipientFields]);

  const isSubmitting = false;

  // Check if recipient requires QES signing
  const isQESRecipient = recipient.signatureLevel === SignatureLevel.QES;

  const handleSign8Complete = (signatureData: { signature: string; credentialId: string }) => {
    setSign8SignatureData?.(signatureData);
  };

  if (recipient.role === RecipientRole.VIEWER) {
    return null;
  }

  if (recipient.role === RecipientRole.ASSISTANT) {
    return (
      <fieldset className="embed--DocumentWidgetForm rounded-2xl border-border sm:border sm:p-3 dark:bg-background">
        <RadioGroup
          className="gap-0 space-y-2 shadow-none sm:space-y-3"
          value={selectedAssistantRecipient?.id?.toString()}
          onValueChange={(value) => {
            setSelectedAssistantRecipientId(Number(value));
          }}
        >
          {assistantRecipients
            .filter((r) => r.fields.length > 0)
            .map((r) => (
              <div
                key={r.id}
                className="relative flex flex-col gap-4 rounded-lg border border-border bg-widget p-4"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <RadioGroupItem
                      id={r.id.toString()}
                      value={r.id.toString()}
                      className="after:absolute after:inset-0"
                    />

                    <div className="grid grow gap-1">
                      <Label className="inline-flex items-start" htmlFor={r.id.toString()}>
                        {r.name}

                        {r.id === recipient.id && (
                          <span className="ml-2 text-muted-foreground">
                            <Trans>(You)</Trans>
                          </span>
                        )}
                      </Label>
                      <p className="text-xs text-muted-foreground">{r.email}</p>
                    </div>
                  </div>
                  <div className="text-xs leading-[inherit] text-muted-foreground">
                    <Plural
                      value={assistantFields.filter((field) => field.recipientId === r.id).length}
                      one="# field"
                      other="# fields"
                    />
                  </div>
                </div>
              </div>
            ))}
        </RadioGroup>
      </fieldset>
    );
  }

  // For QES recipients, show the Sign8 signing component
  if (isQESRecipient && hasSignatureField) {
    return (
      <fieldset disabled={isSubmitting} className="flex flex-1 flex-col gap-4">
        <div className="flex flex-1 flex-col gap-y-4">
          <div>
            <Label htmlFor="full-name">
              <Trans>Full Name</Trans>
            </Label>

            <Input
              type="text"
              id="full-name"
              className="mt-2 bg-background"
              value={fullName}
              disabled={isNameLocked}
              onChange={(e) => !isNameLocked && setFullName(e.target.value.trimStart())}
            />
          </div>

          <DocumentSigningSign8QES
            recipientToken={recipient.token}
            recipientName={recipient.name}
            recipientEmail={recipient.email}
            signatureLevel={recipient.signatureLevel}
            onSign8Complete={handleSign8Complete}
            disabled={isSubmitting}
          />
        </div>
      </fieldset>
    );
  }

  return (
    <fieldset disabled={isSubmitting} className="flex flex-1 flex-col gap-4">
      <div className="flex flex-1 flex-col gap-y-4">
        <div>
          <Label htmlFor="full-name">
            <Trans>Full Name</Trans>
          </Label>

          <Input
            type="text"
            id="full-name"
            className="mt-2 bg-background"
            value={fullName}
            disabled={isNameLocked}
            onChange={(e) => !isNameLocked && setFullName(e.target.value.trimStart())}
          />
        </div>

        {hasSignatureField && (
          <div>
            <Label htmlFor="Signature">
              <Trans>Signature</Trans>
            </Label>

            <SignaturePadDialog
              className="mt-2"
              disabled={isSubmitting}
              fullName={fullName}
              value={signature ?? ''}
              onChange={(v) => setSignature(v ?? '')}
              typedSignatureEnabled={envelope.documentMeta.typedSignatureEnabled}
              uploadSignatureEnabled={envelope.documentMeta.uploadSignatureEnabled}
              drawSignatureEnabled={envelope.documentMeta.drawSignatureEnabled}
            />
          </div>
        )}
      </div>
    </fieldset>
  );
}
