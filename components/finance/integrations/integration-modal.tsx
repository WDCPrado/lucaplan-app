"use client"

import { useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { Eye, EyeOff } from "lucide-react"
import { toast } from "sonner"
import {
  INTEGRATION_KEYS,
  KEYS_WITH_SPACES,
  valueFor,
  type IntegrationKey,
  type IntegrationsStatus,
  type UpdateIntegrationsInput,
} from "@/lib/integration-settings-schemas"
import { haptic } from "@/lib/haptics"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  ModalActions,
  ModalDangerRow,
  ResponsiveModal,
} from "@/components/ui/responsive-modal"
import { useIsMobile } from "@/hooks/use-mobile"
import { FinanceField } from "../finance-form-field"
import { ApiError } from "./http"

export const KEY_LABEL: Record<IntegrationKey, string> = {
  OPENAI_API_KEY: "Clave de API",
  OPENAI_MODEL: "Modelo",
  OUTLOOK_CLIENT_ID: "Client ID",
  OUTLOOK_CLIENT_SECRET: "Client secret",
  OUTLOOK_TENANT: "Tenant",
  RESEND_API_KEY: "Clave de API",
  RESEND_FROM: "Remitente",
}

// Quién guarda: Ajustes usa PUT /api/integrations; la instalación, PUT /api/setup/integrations.
export type SaveIntegrations = (
  values: UpdateIntegrationsInput["values"]
) => Promise<IntegrationsStatus>

type Entry = IntegrationsStatus["entries"][number]

const GROUP_NAME = { openai: "OpenAI", outlook: "Outlook", resend: "Resend" }

// Lo que ayuda a pegar el valor correcto; los secretos nunca muestran el actual.
const PLACEHOLDER: Partial<Record<IntegrationKey, string>> = {
  OPENAI_MODEL: "gpt-4o-mini",
  OUTLOOK_CLIENT_ID: "00000000-0000-0000-0000-000000000000",
  OUTLOOK_TENANT: "consumers",
  RESEND_FROM: "Luca Plan <codigos@tudominio.cl>",
}

const HINT: Partial<Record<IntegrationKey, string>> = {
  OPENAI_MODEL: "Si lo dejas sin configurar se usa gpt-4o-mini.",
  OUTLOOK_TENANT: "«consumers» para cuentas personales de Outlook o Hotmail.",
  RESEND_FROM:
    "Un correo de un dominio verificado en Resend, con o sin nombre.",
}

export function IntegrationModal({
  entry,
  onOpenChange,
  onSaved,
  save,
}: {
  entry: Entry | null
  onOpenChange: (open: boolean) => void
  onSaved: (status: IntegrationsStatus) => void
  save: SaveIntegrations
}) {
  return (
    <ResponsiveModal
      className="sm:max-w-md"
      open={entry !== null}
      onOpenChange={onOpenChange}
      title={
        entry
          ? `${KEY_LABEL[entry.key]} de ${GROUP_NAME[INTEGRATION_KEYS[entry.key].group]}`
          : ""
      }
    >
      {/* La key remonta el formulario por cada clave: parte limpio, sin el valor de otra. */}
      {entry && (
        <IntegrationForm
          key={entry.key}
          entry={entry}
          onCancel={() => onOpenChange(false)}
          onSaved={onSaved}
          save={save}
        />
      )}
    </ResponsiveModal>
  )
}

function IntegrationForm({
  entry,
  onCancel,
  onSaved,
  save,
}: {
  entry: Entry
  onCancel: () => void
  onSaved: (status: IntegrationsStatus) => void
  save: SaveIntegrations
}) {
  const isMobile = useIsMobile()
  const secret = INTEGRATION_KEYS[entry.key].secret
  const formId = `integration-${entry.key}-form`
  const fieldId = `integration-${entry.key}-value`
  const [reveal, setReveal] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [removing, setRemoving] = useState(false)
  const form = useForm({
    resolver: zodResolver(z.object({ value: valueFor(entry.key) })),
    // Un secreto nunca se precarga: el campo parte vacío. Lo que no es secreto sí se ve.
    defaultValues: { value: secret ? "" : (entry.display ?? "") },
  })
  const { errors, isSubmitting, isDirty } = form.formState
  const busy = isSubmitting || removing

  async function send(value: string | null) {
    form.clearErrors()
    try {
      const status = await save({ [entry.key]: value })
      haptic("success")
      toast.success(value === null ? "Clave quitada" : "Clave guardada")
      onSaved(status)
    } catch (error) {
      haptic("error")
      const message =
        error instanceof Error
          ? error.message
          : "No se pudo guardar. Vuelve a intentarlo."
      // 422 es del valor: va al campo. 409 (viene del entorno), 403 y el resto, arriba.
      if (error instanceof ApiError && error.status === 422)
        form.setError("value", { message })
      else form.setError("root", { message })
      setConfirmRemove(false)
    }
  }

  async function remove() {
    setRemoving(true)
    await send(null)
    setRemoving(false)
  }

  const describedBy = errors.value
    ? `${fieldId}-error`
    : HINT[entry.key]
      ? `${fieldId}-hint`
      : undefined

  return (
    <>
      <form
        id={formId}
        onSubmit={form.handleSubmit(({ value }) => send(value))}
        className="flex flex-col gap-7 px-5"
      >
        <fieldset disabled={busy} className="contents">
          {errors.root && (
            <p role="alert" className="text-subheadline text-destructive">
              {errors.root.message}
            </p>
          )}
          <FinanceField
            id={fieldId}
            label={KEY_LABEL[entry.key]}
            error={errors.value?.message}
            hint={HINT[entry.key]}
          >
            <div className="relative">
              <Input
                id={fieldId}
                {...form.register("value", {
                  // Una clave no lleva espacios: el que se cuela al pegar (o un salto) se descarta.
                  // El remitente sí («Luca Plan <codigos@…>»).
                  onChange: (e) => {
                    if (!KEYS_WITH_SPACES.includes(entry.key))
                      e.target.value = e.target.value.replace(/\s/g, "")
                  },
                })}
                type={secret && !reveal ? "password" : "text"}
                maxLength={500}
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                autoFocus={!isMobile}
                placeholder={
                  secret ? "Pega la nueva clave" : PLACEHOLDER[entry.key]
                }
                aria-invalid={!!errors.value}
                aria-describedby={describedBy}
                className={secret ? "pr-12" : undefined}
              />
              {secret && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setReveal((r) => !r)}
                  aria-label={reveal ? "Ocultar clave" : "Mostrar clave"}
                  aria-pressed={reveal}
                  aria-controls={fieldId}
                  className="absolute inset-y-0 right-0 my-auto size-11 text-muted-foreground"
                >
                  {reveal ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
                </Button>
              )}
            </div>
          </FinanceField>

          {/* Quitar solo existe para lo guardado en Ajustes; se confirma aquí mismo, sin confirm(). */}
          {entry.source === "app" &&
            (confirmRemove ? (
              <div
                role="group"
                aria-labelledby={`${formId}-remove-title`}
                className="flex flex-col gap-3"
              >
                <p
                  id={`${formId}-remove-title`}
                  className="px-1 text-subheadline"
                >
                  ¿Quitar {KEY_LABEL[entry.key].toLowerCase()}? Lo que la usa
                  deja de funcionar hasta que pegues otra.
                </p>
                <ModalDangerRow
                  onClick={remove}
                  aria-busy={removing || undefined}
                >
                  {removing ? "Quitando…" : "Sí, quitar"}
                </ModalDangerRow>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setConfirmRemove(false)}
                  className="min-h-11"
                >
                  No, conservarla
                </Button>
              </div>
            ) : (
              <ModalDangerRow onClick={() => setConfirmRemove(true)}>
                Quitar
              </ModalDangerRow>
            ))}
        </fieldset>
      </form>
      <ModalActions
        cancel={{ label: "Cancelar", onClick: onCancel, disabled: busy }}
        primary={{
          label: isSubmitting ? "Guardando…" : "Guardar",
          form: formId,
          busy: isSubmitting,
          disabled: busy || !isDirty,
        }}
        className="px-5"
      />
    </>
  )
}
