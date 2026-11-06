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
import { ArrowRight, Check, Loader, Terminal } from "lucide-react"
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
  focusOnMount,
  Progress,
  Split,
  TITLE_ID,
} from "../finance/onboarding/step-layout"
import { ApiError } from "../finance/onboarding/http"
import {
  IntegrationsList,
  type IntegrationGroup,
} from "../finance/integrations/integrations-groups"
import { KEY_LABEL } from "../finance/integrations/integration-modal"
import {
  getSetupIntegrations,
  getSetupStatus,
  saveSetupIntegrations,
  verifySetupCode,
} from "./http"

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
  const [request] = useState(() =>
    typeof window === "undefined"
      ? null
      : Promise.all([getSetupStatus(), getSetupIntegrations()])
  )
  return (
    <main className="flex min-h-dvh flex-col bg-background p-[env(safe-area-inset-top)_env(safe-area-inset-right)_env(safe-area-inset-bottom)_env(safe-area-inset-left)]">
      {hydrated && request ? (
        <Suspense fallback={<FlowSkeleton />}>
          <Flow request={request} redirectUri={outlookRedirectUri} />
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
      className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-5 pt-8 lg:px-10"
    >
      <Skeleton className="h-1 w-full rounded-full" />
      <Skeleton className="h-10 w-2/3 rounded-lg" />
      <Skeleton className="h-40 rounded-xl" />
    </div>
  )
}

function Flow({
  request,
  redirectUri,
}: {
  request: Promise<[SetupStatus, IntegrationsStatus]>
  redirectUri: string
}) {
  const [setup, initialIntegrations] = use(request)
  const [integrations, setIntegrations] = useState(initialIntegrations)
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
      <header className="mx-auto flex w-full max-w-5xl items-center gap-4 px-5 pt-4 pb-3 lg:px-10 lg:pt-8">
        <Progress
          index={STEPS.indexOf(step)}
          total={STEPS.length}
          label="Progreso de la instalación"
        />
      </header>

      <ViewTransition key={step} enter="nav" exit="nav" default="none">
        <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-5 pt-4 pb-8 lg:px-10 lg:pt-10">
          {step === "code" && (
            <Split
              eyebrow="Instalación"
              title="Te damos la bienvenida a Luca Plan"
              body="Para proteger tu instalación, copia el código que aparece en la consola del servidor."
            >
              <CodeStep onVerified={() => go("email")} />
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
              <div className="flex flex-col gap-6">
                {list("resend")}
                <div className="flex flex-col gap-2">
                  <Button
                    onClick={() => go("openai")}
                    disabled={missing.length > 0}
                    aria-describedby={
                      missing.length > 0 ? "setup-missing" : undefined
                    }
                    className="h-12 w-full text-body"
                  >
                    Continuar <ArrowRight aria-hidden className="size-4" />
                  </Button>
                  {missing.length > 0 && (
                    <p
                      id="setup-missing"
                      className="text-center text-footnote text-muted-foreground"
                    >
                      Falta {missing.map((k) => KEY_LABEL[k]).join(" y ")}.
                    </p>
                  )}
                </div>
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
    <div className="flex flex-col gap-6">
      {children}
      <div className="flex flex-col gap-3 sm:flex-row-reverse">
        <Button
          onClick={onNext}
          disabled={!done}
          className="h-12 flex-1 text-body"
        >
          Continuar <ArrowRight aria-hidden className="size-4" />
        </Button>
        <Button
          variant="secondary"
          onClick={onNext}
          className="h-12 flex-1 text-body"
        >
          Omitir
        </Button>
      </div>
    </div>
  )
}

// ABCD-1234 mientras se escribe: solo letras y números, en mayúscula, con el guion después de 4.
function maskCode(raw: string) {
  const chars = raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8)
  return chars.length > 4 ? `${chars.slice(0, 4)}-${chars.slice(4)}` : chars
}

function CodeStep({ onVerified }: { onVerified: () => void }) {
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
      await verifySetupCode(code)
      haptic("success")
      onVerified()
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
    <div className="flex flex-col gap-6">
      <div className="sheet-group flex items-start gap-3 rounded-xl p-4">
        <Terminal aria-hidden className="mt-0.5 size-5 shrink-0 text-primary" />
        <div className="min-w-0 text-subheadline text-pretty">
          <p>Para verlo, en el servidor corre:</p>
          <code className="mt-2 block rounded-lg bg-muted px-3 py-2 text-footnote break-all select-all">
            docker compose logs app | grep setup
          </code>
          <p className="mt-2 text-muted-foreground">
            En desarrollo aparece en la terminal donde corre{" "}
            <code className="text-footnote">pnpm dev</code>.
          </p>
        </div>
      </div>

      <form
        id={formId}
        onSubmit={form.handleSubmit(verify)}
        className="flex flex-col gap-6"
      >
        {errors.root && (
          <p role="alert" className="text-subheadline text-destructive">
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
              onChange: (e) => {
                e.target.value = maskCode(e.target.value)
              },
            })}
            inputMode="text"
            maxLength={9}
            autoComplete="off"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            placeholder="ABCD-1234"
            disabled={isSubmitting}
            aria-invalid={!!errors.code}
            aria-describedby={errors.code ? `${fieldId}-error` : undefined}
            className="tabular text-center tracking-widest uppercase"
          />
        </FinanceField>
      </form>
      <Button
        type="submit"
        form={formId}
        disabled={isSubmitting}
        aria-busy={isSubmitting || undefined}
        className="h-12 w-full text-body"
      >
        {isSubmitting && (
          <Loader
            aria-hidden
            className="size-4 animate-spin motion-reduce:animate-none"
          />
        )}
        Continuar <ArrowRight aria-hidden className="size-4" />
      </Button>
    </div>
  )
}

function Done() {
  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-8 text-center">
      <div className="flex flex-col items-center gap-4">
        <span className="grid size-16 animate-in place-items-center rounded-full bg-success/15 text-success duration-500 zoom-in-75 motion-reduce:animate-none">
          <Check aria-hidden className="size-8" />
        </span>
        <div>
          <h1
            id={TITLE_ID}
            ref={focusOnMount}
            tabIndex={-1}
            className="text-title-1 font-bold outline-none"
          >
            Tu instalación está lista
          </h1>
          <p className="mt-2 text-subheadline text-pretty text-muted-foreground">
            La primera cuenta que crees queda como administradora. Después te
            guiamos para armar tu plan.
          </p>
        </div>
      </div>
      <Button asChild className="h-12 w-full text-body">
        <Link href="/login">
          Crea tu cuenta de administrador{" "}
          <ArrowRight aria-hidden className="size-4" />
        </Link>
      </Button>
    </div>
  )
}

function AlreadyInstalled() {
  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-5 text-center">
      <h1
        id={TITLE_ID}
        ref={focusOnMount}
        tabIndex={-1}
        className="text-title-1 font-bold outline-none"
      >
        Esta instalación ya está lista
      </h1>
      <Button asChild className="h-12 w-full text-body">
        <Link href="/login">
          Entrar <ArrowRight aria-hidden className="size-4" />
        </Link>
      </Button>
    </div>
  )
}
