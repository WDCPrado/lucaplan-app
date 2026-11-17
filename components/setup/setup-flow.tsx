"use client"

import {
  startTransition,
  Suspense,
  use,
  useState,
  useSyncExternalStore,
  ViewTransition,
} from "react"
import Link from "next/link"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { ArrowRight, Check, Loader } from "lucide-react"
import {
  setupVerifyInput,
  type IntegrationKey,
  type IntegrationsStatus,
  type SetupStatus,
} from "@/lib/integration-settings-schemas"
import { haptic } from "@/lib/haptics"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { FinanceField } from "../finance/finance-form-field"
import {
  FLOW_COLUMN,
  focusOnMount,
  Progress,
  Split,
  StepActions,
  TITLE_ID,
} from "../finance/onboarding/step-layout"
import { ApiError } from "../finance/onboarding/http"
import {
  catchLoad,
  IntegrationsList,
  isLoadFailure,
  LoadError,
  type IntegrationGroup,
  type LoadFailure,
} from "../finance/integrations/integrations-groups"
import { KEY_LABEL } from "../finance/integrations/integration-modal"
import { getSetupStatus, saveSetupIntegrations, verifySetupCode } from "./http"

const STEPS = ["code", "email", "openai", "outlook", "done"] as const
type Step = (typeof STEPS)[number]

const GROUP_KEYS: Record<IntegrationGroup, IntegrationKey[]> = {
  resend: ["RESEND_API_KEY", "RESEND_FROM"],
  openai: ["OPENAI_API_KEY", "OPENAI_MODEL"],
  outlook: ["OUTLOOK_CLIENT_ID", "OUTLOOK_CLIENT_SECRET", "OUTLOOK_TENANT"],
}

const noop = () => () => {}

// Instalación inicial de pantalla completa, con el lenguaje y las transiciones del onboarding.
// El estado se pide en el cliente: hasta hidratar se ve el esqueleto.
export function SetupFlow({
  outlookRedirectUri,
}: {
  outlookRedirectUri: string
}) {
  const hydrated = useSyncExternalStore(
    noop,
    () => true,
    () => false
  )
  // La promesa vive aquí, que sí se monta (si la creara el hijo que suspende, se repetiría).
  // Un GET que falla vuelve como valor; Reintentar la reemplaza por una nueva.
  const [request, setRequest] = useState(() =>
    typeof window === "undefined" ? null : catchLoad(getSetupStatus())
  )
  return (
    <main className="flex min-h-dvh flex-col bg-background p-[env(safe-area-inset-top)_env(safe-area-inset-right)_env(safe-area-inset-bottom)_env(safe-area-inset-left)]">
      {hydrated && request ? (
        <Suspense fallback={<FlowSkeleton />}>
          <Resolve
            request={request}
            redirectUri={outlookRedirectUri}
            onRetry={() => setRequest(catchLoad(getSetupStatus()))}
          />
        </Suspense>
      ) : (
        <FlowSkeleton />
      )}
    </main>
  )
}

function FlowSkeleton() {
  return (
    <div
      aria-busy
      className={`${FLOW_COLUMN} flex flex-col gap-4 pt-6 md:pt-14`}
    >
      <Skeleton className="h-1 w-full rounded-full" />
      <Skeleton className="mt-4 h-6 w-2/3 rounded-sm" />
      <Skeleton className="h-40 rounded-xl" />
    </div>
  )
}

function Resolve({
  request,
  redirectUri,
  onRetry,
}: {
  request: Promise<SetupStatus | LoadFailure>
  redirectUri: string
  onRetry: () => void
}) {
  const result = use(request)
  if (isLoadFailure(result))
    return (
      <div className={`${FLOW_COLUMN} flex flex-col pt-6 md:pt-14`}>
        <LoadError message={result.loadError} onRetry={onRetry} />
      </div>
    )
  return <Flow initial={result} redirectUri={redirectUri} />
}

function Flow({
  initial,
  redirectUri,
}: {
  initial: SetupStatus
  redirectUri: string
}) {
  const [setup, setSetup] = useState(initial)
  // null hasta validar el código (contrato); después, lo último que respondió el servidor.
  const [integrations, setIntegrations] = useState<IntegrationsStatus>(
    setup.integrations ?? { entries: [] }
  )
  const [step, setStep] = useState<Step>(setup.verified ? "email" : "code")

  // Ya hay cuentas: la instalación terminó y aquí no queda nada que hacer.
  if (!setup.needed) return <AlreadyInstalled />

  function go(next: Step) {
    // Misma transición que el onboarding (clase `nav` de globals.css).
    document.documentElement.dataset.navDir =
      STEPS.indexOf(next) < STEPS.indexOf(step) ? "back" : "forward"
    startTransition(() => setStep(next))
  }

  const configured = (key: IntegrationKey) =>
    integrations.entries.some((e) => e.key === key && e.source !== "none")
  // Lo mínimo para entrar que sigue sin valor, según lo último que respondió el servidor.
  const missing = setup.missingRequired.filter((k) => !configured(k))

  const list = (group: IntegrationGroup) => (
    <IntegrationsList
      status={integrations}
      onStatus={setIntegrations}
      save={saveSetupIntegrations}
      redirectUri={redirectUri}
      groups={[group]}
    />
  )

  return (
    <>
      <header className={`${FLOW_COLUMN} flex min-h-14 items-center gap-4 pt-2 md:pt-8`}>
        <Progress
          index={STEPS.indexOf(step)}
          total={STEPS.length}
          label="Progreso de la instalación"
        />
      </header>

      <ViewTransition key={step} enter="nav" exit="nav" default="none">
        <div className={`${FLOW_COLUMN} flex flex-1 flex-col pt-4 md:pt-8 md:pb-12`}>
          {step === "code" && (
            <Split
              eyebrow="Instalación"
              title="Te damos la bienvenida a Luca Plan"
              body="Para proteger tu instalación, copia el código que aparece en la consola del servidor."
            >
              <CodeStep
                onVerified={(next) => {
                  setSetup(next)
                  if (next.integrations) setIntegrations(next.integrations)
                  go("email")
                }}
              />
            </Split>
          )}

          {step === "email" && (
            <Split
              eyebrow="Correo"
              title="Así llegan los códigos de acceso"
              body={
                setup.local
                  ? "Opcional. En local el código de acceso sale en la consola; puedes configurar Resend después en Ajustes."
                  : "Luca Plan entra con un código que llega por correo. Sin Resend no se puede enviar, así que es obligatorio."
              }
            >
              <div className="flex flex-1 flex-col gap-4">
                {list("resend")}
                <StepActions>
                  <Button
                    size="lg"
                    onClick={() => go("openai")}
                    disabled={missing.length > 0}
                    aria-describedby={
                      missing.length > 0 ? "setup-missing" : undefined
                    }
                    className="w-full"
                  >
                    Continuar <ArrowRight aria-hidden className="size-4" />
                  </Button>
                  {missing.length > 0 && (
                    <p
                      id="setup-missing"
                      className="text-center text-caption text-ink-3"
                    >
                      Falta {missing.map((k) => KEY_LABEL[k]).join(" y ")}.
                    </p>
                  )}
                </StepActions>
              </div>
            </Split>
          )}

          {step === "openai" && (
            <Split
              eyebrow="Inteligencia artificial"
              title="Ordena tus gastos con OpenAI"
              body="Opcional. Categoriza tus movimientos y propone categorías. Puedes agregarla después en Ajustes → Integraciones."
            >
              <OptionalStep
                done={GROUP_KEYS.openai.some(configured)}
                onNext={() => go("outlook")}
              >
                {list("openai")}
              </OptionalStep>
            </Split>
          )}

          {step === "outlook" && (
            <Split
              eyebrow="Tu banco"
              title="Lee los avisos de tu banco con Outlook"
              body="Opcional. Registra una app en Microsoft Entra con esta Redirect URI y pega aquí sus datos. Puedes hacerlo después en Ajustes → Integraciones."
            >
              <OptionalStep
                done={GROUP_KEYS.outlook.some(configured)}
                onNext={() => go("done")}
              >
                {list("outlook")}
              </OptionalStep>
            </Split>
          )}

          {step === "done" && <Done />}
        </div>
      </ViewTransition>
    </>
  )
}

// Continuar pide haber pegado algo; Omitir sigue sin nada. Lo guardado ya quedó al cerrar el modal.
function OptionalStep({
  done,
  onNext,
  children,
}: {
  done: boolean
  onNext: () => void
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-1 flex-col gap-4">
      {children}
      {/* Principal a la derecha desde sm; en móvil, Continuar arriba y Omitir debajo. */}
      <StepActions className="sm:flex-row-reverse">
        <Button size="lg" onClick={onNext} disabled={!done} className="sm:flex-1">
          Continuar <ArrowRight aria-hidden className="size-4" />
        </Button>
        <Button
          variant="secondary"
          size="lg"
          onClick={onNext}
          className="sm:flex-1"
        >
          Omitir
        </Button>
      </StepActions>
    </div>
  )
}

// ABCD-EFGH-JKLM mientras se escribe: solo letras y números, en mayúscula, con un guion cada 4.
function maskCode(raw: string) {
  const chars = raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 12)
  return chars.match(/.{1,4}/g)?.join("-") ?? ""
}

function CodeStep({
  onVerified,
}: {
  onVerified: (status: SetupStatus) => void
}) {
  const formId = "setup-code-form"
  const fieldId = "setup-code"
  const form = useForm({
    resolver: zodResolver(setupVerifyInput),
    defaultValues: { code: "" },
  })
  const { errors, isSubmitting } = form.formState

  async function verify({ code }: { code: string }) {
    form.clearErrors()
    try {
      const status = await verifySetupCode(code)
      haptic("success")
      onVerified(status)
    } catch (error) {
      haptic("error")
      const message =
        error instanceof Error
          ? error.message
          : "No se pudo validar el código. Vuelve a intentarlo."
      // Código mal escrito o equivocado: en el campo. Demasiados intentos o ya instalado: arriba.
      if (
        error instanceof ApiError &&
        (error.status === 401 || error.status === 422)
      )
        form.setError("code", { message })
      else form.setError("root", { message })
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="rounded-xl bg-card p-(--pad-card) text-callout text-pretty">
        <p>Para verlo, en el servidor corre:</p>
        <code className="mt-2 block rounded-md bg-secondary px-3 py-2 font-mono text-caption break-all select-all">
          docker compose logs app | grep setup
        </code>
        <p className="mt-2 text-ink-2">
          En desarrollo aparece en la terminal donde corre{" "}
          <code className="font-mono text-caption">pnpm dev</code>.
        </p>
      </div>

      <form
        id={formId}
        onSubmit={form.handleSubmit(verify)}
        className="flex flex-col gap-4"
      >
        {errors.root && (
          <p
            role="alert"
            className="rounded-md bg-destructive-soft px-3 py-2.5 text-callout text-destructive"
          >
            {errors.root.message}
          </p>
        )}
        <FinanceField
          id={fieldId}
          label="Código de instalación"
          error={errors.code?.message}
        >
          <Input
            id={fieldId}
            {...form.register("code", {
              // RHF lee el valor antes de este onChange: setValueAs guarda lo mismo que se ve.
              setValueAs: maskCode,
              onChange: (e) => {
                e.target.value = maskCode(e.target.value)
              },
            })}
            inputMode="text"
            maxLength={14}
            autoComplete="off"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            placeholder="ABCD-EFGH-JKLM"
            disabled={isSubmitting}
            aria-invalid={!!errors.code}
            aria-describedby={errors.code ? `${fieldId}-error` : undefined}
            className="tabular h-12 text-center text-title tracking-widest uppercase"
          />
        </FinanceField>
      </form>
      <StepActions>
        <Button
          type="submit"
          form={formId}
          size="lg"
          disabled={isSubmitting}
          aria-busy={isSubmitting || undefined}
          className="w-full"
        >
          {isSubmitting && (
            <Loader
              aria-hidden
              className="size-4 animate-spin motion-reduce:animate-none"
            />
          )}
          Continuar <ArrowRight aria-hidden className="size-4" />
        </Button>
      </StepActions>
    </div>
  )
}

function Done() {
  return (
    <div className="flex flex-1 flex-col justify-center gap-8 py-8">
      <div className="flex flex-col items-center gap-4 text-center">
        <span className="grid size-14 animate-in place-items-center rounded-xl bg-primary-soft text-primary duration-300 zoom-in-90 motion-reduce:animate-none">
          <Check aria-hidden className="size-7" />
        </span>
        <h1
          id={TITLE_ID}
          ref={focusOnMount}
          tabIndex={-1}
          className="text-screen-title font-semibold text-balance outline-none"
        >
          Tu instalación está lista
        </h1>
        <p className="text-callout text-pretty text-ink-2">
          La primera cuenta que crees queda como administradora. Después te
          guiamos para armar tu plan.
        </p>
      </div>
      <StepActions>
        <Button asChild size="lg" className="w-full">
          <Link href="/login">
            Crea tu cuenta de administrador{" "}
            <ArrowRight aria-hidden className="size-4" />
          </Link>
        </Button>
      </StepActions>
    </div>
  )
}

function AlreadyInstalled() {
  return (
    <div className={`${FLOW_COLUMN} flex flex-1 flex-col justify-center gap-6 py-8 text-center`}>
      <h1
        id={TITLE_ID}
        ref={focusOnMount}
        tabIndex={-1}
        className="text-screen-title font-semibold text-balance outline-none"
      >
        Esta instalación ya está lista
      </h1>
      <Button asChild size="lg" className="w-full">
        <Link href="/login">
          Entrar <ArrowRight aria-hidden className="size-4" />
        </Link>
      </Button>
    </div>
  )
}
