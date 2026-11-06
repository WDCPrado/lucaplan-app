"use client"

import { useEffect, useRef, useState } from "react"
import { useForm, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { ChevronRight, Eye, EyeOff } from "lucide-react"
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
import { cn } from "@/lib/utils"
import {
  buildSender,
  cleanDomain,
  cleanLocal,
  cleanName,
  nameFromDomain,
  parseSender,
  senderSchema,
  type Sender,
} from "@/lib/resend-sender"
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
  OUTLOOK_TENANT:
    "«consumers» para cuentas personales (lo normal); «common» solo si registraste la app también para organizaciones.",
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
      {entry?.key === "RESEND_FROM" ? (
        <SenderForm
          entry={entry}
          onCancel={() => onOpenChange(false)}
          onSaved={onSaved}
          save={save}
        />
      ) : entry && (
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
                {...form.register(
                  "value",
                  // Una clave no lleva espacios: el que se cuela al pegar (o un salto) se descarta.
                  // El remitente sí («Luca Plan <codigos@…>»).
                  KEYS_WITH_SPACES.includes(entry.key)
                    ? undefined
                    : sanitized((v) => v.replace(/\s/g, ""))
                )}
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
          {entry.source === "app" && (
            <RemoveControl
              formId={formId}
              label={KEY_LABEL[entry.key].toLowerCase()}
              confirm={confirmRemove}
              setConfirm={setConfirmRemove}
              removing={removing}
              onRemove={remove}
            />
          )}
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

// Saneo en vivo que también llega al formulario: RHF lee el valor ANTES de llamar al onChange de
// `register`, así que cambiar solo `e.target.value` deja guardado lo que se tecleó. `setValueAs`
// pasa el mismo saneo al valor que guarda.
function sanitized(clean: (value: string) => string) {
  return {
    setValueAs: (value: unknown) => clean(String(value ?? "")),
    onChange: (e: { target: { value: string } }) => {
      e.target.value = clean(e.target.value)
    },
  }
}

// --- Remitente (RESEND_FROM) en dos pasos: Dominio → Nombre y dirección ----------------------------
// Lo que viaja sigue siendo un solo string («Lucaplan <notificaciones@lucaplan.cl>») por el mismo
// PUT; la API lo vuelve a validar con `valueFor("RESEND_FROM")`. Estas reglas son solo de la UI que
// lo arma.

function SenderForm({
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
  const formId = "integration-RESEND_FROM-form"
  const ids = {
    domain: "integration-RESEND_FROM-domain",
    name: "integration-RESEND_FROM-name",
    local: "integration-RESEND_FROM-local",
  }
  const saved = parseSender(entry.display)
  // dir: de qué lado entra el paso (1 avanza, -1 vuelve); 0 al abrir, sin animación.
  const [step, setStep] = useState<{ n: 1 | 2; dir: -1 | 0 | 1 }>({ n: 1, dir: 0 })
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [removing, setRemoving] = useState(false)
  const form = useForm({
    resolver: zodResolver(senderSchema),
    defaultValues: saved ?? { domain: "", name: "", local: "notificaciones" },
  })
  const { errors, isSubmitting, dirtyFields } = form.formState
  const busy = isSubmitting || removing
  const values = useWatch({ control: form.control })
  const preview = buildSender({ domain: "", name: "", local: "", ...values })
  // Se compara con lo guardado ya armado en forma canónica: «"Luca Plan" <a@b.cl>» y
  // «Luca Plan <a@b.cl>» son lo mismo.
  const unchanged = preview === (saved ? buildSender(saved) : (entry.display ?? ""))
  // Se anuncia al cambiar de paso, y el foco va al contenedor del paso (el botón que lo cambió
  // puede quedar deshabilitado o desaparecer).
  const stepRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (step.dir !== 0) stepRef.current?.focus({ preventScroll: true })
  }, [step])

  async function next() {
    if (!(await form.trigger("domain"))) return
    // El nombre se propone desde el dominio mientras la persona no lo haya escrito a mano, y solo si
    // el dominio cambió o no había nada guardado: con el guardado se queda su nombre, aunque esté
    // vacío.
    if (!dirtyFields.name && (dirtyFields.domain || !saved))
      form.setValue("name", nameFromDomain(form.getValues("domain")))
    setStep({ n: 2, dir: 1 })
  }

  async function send(value: string | null) {
    form.clearErrors()
    try {
      const status = await save({ RESEND_FROM: value })
      haptic("success")
      toast.success(value === null ? "Remitente quitado" : "Remitente guardado")
      onSaved(status)
    } catch (error) {
      haptic("error")
      form.setError("root", {
        message:
          error instanceof Error
            ? error.message
            : "No se pudo guardar. Vuelve a intentarlo.",
      })
      setConfirmRemove(false)
    }
  }

  async function remove() {
    setRemoving(true)
    await send(null)
    setRemoving(false)
  }

  // Cada input lleva su error o su ayuda en aria-describedby, con el id del campo.
  const described = (field: keyof Sender, hint?: boolean) =>
    errors[field] ? `${ids[field]}-error` : hint ? `${ids[field]}-hint` : undefined
  const noAuto = {
    autoComplete: "off",
    autoCapitalize: "off",
    autoCorrect: "off",
    spellCheck: false,
  } as const

  return (
    <>
      <form
        id={formId}
        onSubmit={(e) => {
          if (step.n === 1) {
            e.preventDefault()
            void next()
          } else void form.handleSubmit((v) => send(buildSender(v)))(e)
        }}
        className="flex flex-col gap-7 px-5"
      >
        <fieldset disabled={busy} className="contents">
          <ol aria-label="Pasos" className="grid grid-cols-2 gap-2">
            {(["Dominio", "Remitente"] as const).map((label, i) => {
              const n = (i + 1) as 1 | 2
              const current = step.n === n
              return (
                <li key={label}>
                  <button
                    type="button"
                    aria-current={current ? "step" : undefined}
                    onClick={() =>
                      n === 1 ? step.n === 2 && setStep({ n: 1, dir: -1 }) : step.n === 1 && void next()
                    }
                    className={cn(
                      "press flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-subheadline",
                      current ? "font-semibold text-foreground" : "text-muted-foreground hover:bg-accent/60"
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "tabular grid size-6 shrink-0 place-items-center rounded-full text-footnote font-semibold transition-colors",
                        current ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                      )}
                    >
                      {n}
                    </span>
                    {label}
                  </button>
                </li>
              )
            })}
          </ol>

          <p className="sr-only" aria-live="polite">
            {step.dir === 0
              ? ""
              : step.n === 1
                ? "Paso 1 de 2: Dominio"
                : "Paso 2 de 2: Remitente"}
          </p>

          {errors.root && (
            <p role="alert" className="text-subheadline text-destructive">
              {errors.root.message}
            </p>
          )}

          {/* Lo guardado que no se pudo descomponer: se muestra para saber qué se reemplaza. */}
          {!saved && entry.display && (
            <p className="text-footnote text-muted-foreground">
              Ahora:{" "}
              <span className="font-mono break-all text-foreground">
                {entry.display}
              </span>
            </p>
          )}

          {/* El paso entra desde el lado hacia el que se avanza; con «reducir movimiento», quieto
              (las clases month-in-* ya lo respetan en globals.css). */}
          <div className="-mx-5 -my-1 overflow-hidden px-5 py-1">
            <div
              key={step.n}
              ref={stepRef}
              tabIndex={-1}
              className={cn(
                "flex flex-col gap-7 outline-none",
                step.dir === 1 && "month-in-next",
                step.dir === -1 && "month-in-prev"
              )}
            >
              {step.n === 1 ? (
                <FinanceField
                  id={ids.domain}
                  label="Dominio"
                  error={errors.domain?.message}
                  hint="El mismo que verificaste en Resend."
                >
                  <Input
                   
                    id={ids.domain}
                    {...form.register("domain", sanitized(cleanDomain))}
                    {...noAuto}
                    inputMode="url"
                    maxLength={253}
                    placeholder="lucaplan.cl"
                    autoFocus={!isMobile}
                    aria-invalid={!!errors.domain}
                    aria-describedby={described("domain", true)}
                  />
                </FinanceField>
              ) : (
                <>
                  <div className="flex flex-col gap-2">
                    <span className="text-footnote text-muted-foreground">
                      Así lo verá quien reciba el correo
                    </span>
                    <p className="self-start rounded-full bg-muted px-3 py-1.5 font-mono text-footnote break-all">
                      {preview}
                    </p>
                  </div>
                  <FinanceField
                    id={ids.name}
                    label="Nombre que se ve"
                    error={errors.name?.message}
                  >
                    <Input
                     
                      id={ids.name}
                      {...form.register("name", sanitized(cleanName))}
                      autoComplete="off"
                      maxLength={100}
                      placeholder={nameFromDomain(values.domain ?? "")}
                      aria-invalid={!!errors.name}
                      aria-describedby={described("name")}
                    />
                  </FinanceField>
                  <FinanceField
                    id={ids.local}
                    label="Dirección"
                    error={errors.local?.message}
                    hint={`Lo que va antes de @${values.domain}.`}
                  >
                    <Input
                     
                      id={ids.local}
                      {...form.register("local", sanitized(cleanLocal))}
                      {...noAuto}
                      inputMode="email"
                      maxLength={64}
                      placeholder="notificaciones"
                      aria-invalid={!!errors.local}
                      aria-describedby={described("local", true)}
                    />
                  </FinanceField>
                </>
              )}
            </div>
          </div>

          {entry.source === "app" && (
            <RemoveControl
              formId={formId}
              label="remitente"
              confirm={confirmRemove}
              setConfirm={setConfirmRemove}
              removing={removing}
              onRemove={remove}
            />
          )}
        </fieldset>
      </form>
      <ModalActions
        cancel={{ label: "Cancelar", onClick: onCancel, disabled: busy }}
        primary={
          step.n === 1
            ? { label: "Siguiente", plain: true, icon: ChevronRight, form: formId, disabled: busy }
            : {
                label: isSubmitting ? "Guardando…" : "Guardar",
                form: formId,
                busy: isSubmitting,
                disabled: busy || unchanged,
              }
        }
        className="px-5"
      />
    </>
  )
}

function RemoveControl({
  formId,
  label,
  confirm,
  setConfirm,
  removing,
  onRemove,
}: {
  formId: string
  label: string
  confirm: boolean
  setConfirm: (confirm: boolean) => void
  removing: boolean
  onRemove: () => void
}) {
  if (!confirm)
    return <ModalDangerRow onClick={() => setConfirm(true)}>Quitar</ModalDangerRow>
  return (
    <div
      role="group"
      aria-labelledby={`${formId}-remove-title`}
      className="flex flex-col gap-3"
    >
      <p id={`${formId}-remove-title`} className="px-1 text-subheadline">
        ¿Quitar {label}? Lo que depende de esto deja de funcionar hasta que guardes otro valor.
      </p>
      <ModalDangerRow onClick={onRemove} aria-busy={removing || undefined}>
        {removing ? "Quitando…" : "Sí, quitar"}
      </ModalDangerRow>
      <Button
        type="button"
        variant="ghost"
        onClick={() => setConfirm(false)}
        className="min-h-11"
      >
        No, conservar
      </Button>
    </div>
  )
}
