"use client"


import {
  startTransition,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  ViewTransition,
} from "react"
import { useRouter } from "next/navigation"
import {
  ArrowRight,
  CalendarSync,
  Check,
  ExternalLink,
  Loader,
  Mail,
  ShieldCheck,
  Sparkles,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { formatMoney } from "@/lib/finance-format"
import {
  SCAN_LOOKBACK_MONTHS,
  type OnboardingStatus,
} from "@/lib/onboarding-schemas"
import {
  OutlookBankConnection,
  type OutlookStatus,
} from "../outlook-bank-connection"
import { MovementRow } from "../movement-row"
import type {
  TransactionDTO,
} from "@/arch/v1/application/finance-use-cases/finance-read"
import { CategoriesStep } from "./categories-step"
import { completeOnboarding } from "./http"
import { IconTile } from "../blocks"
import {
  FLOW_COLUMN,
  focusOnMount,
  Progress,
  Split,
  StepActions,
  TITLE_ID,
} from "./step-layout"

const STEPS = [
  "welcome",
  "categories",
  "connect",
  "preview",
  "done",
] as const
type Step = (typeof STEPS)[number]

// El paso sobrevive al ida y vuelta de Microsoft (OAuth sale de la app y vuelve con ?outlook=setup).
const STORAGE_KEY = "lucaplan:onboarding-step"
const README_OUTLOOK =
  "https://github.com/WDCPrado/lucaplan-app#-conectar-outlook-banco-de-chile-paso-a-paso"


// El onboarding se monta dentro del shell (SidebarInset): mientras dura, todo lo que no es él queda
// inert, hermano por hermano hasta la raíz del shell. Función estable: corre al montar y limpia al salir.
function isolate(el: HTMLElement | null) {
  if (!el) return
  const root = el.closest('[data-slot="sidebar-wrapper"]') ?? document.body
  const inerted: Element[] = []
  for (let node: Element = el; node !== root && node.parentElement; node = node.parentElement)
    for (const sibling of node.parentElement.children)
      if (sibling !== node && !sibling.hasAttribute("inert")) {
        sibling.setAttribute("inert", "")
        inerted.push(sibling)
      }
  return () => inerted.forEach((s) => s.removeAttribute("inert"))
}

const noopSubscribe = () => () => {}
function readStoredStep(): Step | null {
  const v = sessionStorage.getItem(STORAGE_KEY)
  return STEPS.includes(v as Step) ? (v as Step) : null
}

// Onboarding de pantalla completa de una cuenta nueva. Orquesta los pasos reutilizando los
// componentes existentes (OutlookBankConnection, MovementRow). El shell no se desmonta
// hasta onFinish, así que el estado sobrevive a los router.refresh() y lee props frescas.
export function OnboardingFlow({
  status,
  globalLimit,
  totalSpent,
  transactions,
  outlookResult,
  outlookReason,
  onFinish,
}: {
  status: OnboardingStatus
  globalLimit: number | null
  totalSpent: number
  transactions: TransactionDTO[]
  outlookResult: string | null
  outlookReason: string | null
  onFinish: () => void
}) {
  const router = useRouter()
  // Lo guardado se lee después de hidratar (getServerSnapshot = null): sin mismatch ni useEffect.
  const stored = useSyncExternalStore(noopSubscribe, readStoredStep, () => null)
  const [picked, setPicked] = useState<Step | null>(null)
  const step: Step =
    picked ?? (outlookResult === "setup" ? "connect" : stored) ?? "welcome"
  const [locked, setLocked] = useState(false) // importación en curso: no salir del paso
  const [finishing, setFinishing] = useState(false)

  function go(next: Step) {
    const dir = STEPS.indexOf(next) < STEPS.indexOf(step) ? "back" : "forward"
    // Misma transición que el cambio de pantalla (clase `nav` de globals.css): la dirección va en
    // <html> antes del cambio; una transición nueva corta la anterior.
    document.documentElement.dataset.navDir = dir
    sessionStorage.setItem(STORAGE_KEY, next)
    startTransition(() => setPicked(next))
  }

  async function finish() {
    setFinishing(true)
    try {
      await completeOnboarding()
      sessionStorage.removeItem(STORAGE_KEY)
      onFinish()
    } catch {
      toast.error("No pudimos terminar. Vuelve a intentarlo.")
      setFinishing(false)
    }
  }

  const index = STEPS.indexOf(step)

  return (
    <div
      ref={isolate}
      role="dialog"
      aria-modal="true"
      aria-labelledby={TITLE_ID}
      className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-background p-[env(safe-area-inset-top)_env(safe-area-inset-right)_env(safe-area-inset-bottom)_env(safe-area-inset-left)]"
    >
      <header className={`${FLOW_COLUMN} flex min-h-14 items-center gap-4 pt-2 md:pt-8`}>
        <Progress index={index} total={STEPS.length} />
        {!locked && step !== "done" && (
          <button
            type="button"
            onClick={finish}
            disabled={finishing}
            className="press -mr-2 min-h-11 shrink-0 rounded-md px-2 text-callout text-ink-2 hover:bg-secondary hover:text-foreground disabled:opacity-45"
          >
            Omitir por ahora
          </button>
        )}
      </header>

      <ViewTransition key={step} enter="nav" exit="nav" default="none">
        <div className={`${FLOW_COLUMN} flex flex-1 flex-col pt-4 md:pt-8 md:pb-12`}>
          {step === "welcome" && <Welcome onStart={() => go("categories")} />}

          {step === "categories" && (
            <Split
              eyebrow="Tu día a día"
              title="Ordenemos tus gastos a tu manera"
              body="Cuéntanos dónde compras, cómo te mueves y qué pagas cada mes. Con eso proponemos categorías que reconocen los comercios de tu banco."
            >
              <CategoriesStep
                aiAvailable={status.aiAvailable}
                onSaved={() => {
                  router.refresh()
                  go("connect")
                }}
              />
            </Split>
          )}

          {step === "connect" && (
            <Split
              eyebrow="Tu banco"
              title="Conecta el correo donde te avisa tu banco"
              body="Cada compra con tu tarjeta llega como aviso a tu correo. Luca Plan lee esos avisos y arma tus movimientos."
              points={[
                {
                  icon: ShieldCheck,
                  text: "Solo lectura (Mail.Read): no puede enviar ni borrar correos.",
                },
                {
                  icon: Mail,
                  text: "Solo lee los correos que envía tu banco, nada más.",
                },
                {
                  icon: CalendarSync,
                  text: `Parte con los avisos de los últimos ${SCAN_LOOKBACK_MONTHS} meses.`,
                },
              ]}
            >
              {status.outlookAvailable ? (
                <ConnectStep
                  outlookResult={outlookResult}
                  outlookReason={outlookReason}
                  onImportingChange={setLocked}
                  onImported={() => {
                    router.refresh()
                    go("preview")
                  }}
                />
              ) : (
                <NotConfigured onContinue={() => go("done")} />
              )}
            </Split>
          )}

          {step === "preview" && (
            <Split
              eyebrow="Así se ve"
              title="Tus movimientos ya llegaron ordenados"
              body="Cada movimiento cae en su categoría. Si alguno queda mal, lo corriges después desde Movimientos."
            >
              <Preview
                transactions={transactions}
                onContinue={() => go("done")}
              />
            </Split>
          )}

          {step === "done" && (
            <Done
              globalLimit={globalLimit}
              spent={totalSpent}
              busy={finishing}
              onFinish={finish}
            />
          )}
        </div>
      </ViewTransition>

    </div>
  )
}

const IDEAS = [
  {
    icon: CalendarSync,
    title: "Cada mes parte limpio",
    text: "Un presupuesto que se reinicia contigo, con lo que te queda para hoy.",
  },
  {
    icon: Mail,
    title: "Tu banco ya te avisa por correo",
    text: "Luca Plan lee esos avisos y registra cada movimiento por ti.",
  },
  {
    icon: Sparkles,
    title: "La IA ordena tus gastos",
    text: "Cada compra cae en su categoría, y aprende cuando la corriges.",
  },
]

function Welcome({ onStart }: { onStart: () => void }) {
  return (
    <div className="flex flex-1 flex-col gap-6">
      <div>
        <h1
          id={TITLE_ID}
          ref={focusOnMount}
          tabIndex={-1}
          className="text-screen-title font-semibold text-balance outline-none"
        >
          Tu plata en orden, sin anotar nada
        </h1>
        <p className="mt-2 text-callout text-pretty text-ink-2">
          En unos minutos dejamos listos tus categorías, tu banco y tus
          ingresos.
        </p>
      </div>
      <ol className="flex flex-col gap-4 rounded-xl bg-card p-(--pad-card)">
        {IDEAS.map(({ icon: Icon, title, text }, i) => (
          <li
            key={title}
            style={{ animationDelay: `${100 + i * 80}ms` }}
            className="flex animate-in items-start gap-3 duration-300 fill-mode-both fade-in-0 slide-in-from-bottom-2 motion-reduce:animate-none"
          >
            <IconTile>
              <Icon aria-hidden />
            </IconTile>
            <div className="min-w-0">
              <h2 className="font-semibold">{title}</h2>
              <p className="text-callout text-pretty text-ink-2">{text}</p>
            </div>
          </li>
        ))}
      </ol>
      <StepActions>
        <Button size="lg" onClick={onStart} className="w-full">
          Comenzar <ArrowRight aria-hidden className="size-4" />
        </Button>
      </StepActions>
    </div>
  )
}

// Paso del banco: carga el estado del correo al montar (también al volver de Microsoft, cuando el
// paso se retoma desde sessionStorage) y deja que OutlookBankConnection siga su flujo.
function ConnectStep({
  outlookResult,
  outlookReason,
  onImportingChange,
  onImported,
}: {
  outlookResult: string | null
  outlookReason: string | null
  onImportingChange: (v: boolean) => void
  onImported: () => void
}) {
  const router = useRouter()
  const [status, setStatus] = useState<OutlookStatus | null>(null)
  const handled = useRef(false)

  async function loadStatus() {
    try {
      const res = await fetch("/api/email-connection/status", {
        cache: "no-store",
      })
      setStatus(await res.json())
    } catch {
      setStatus({ providers: [], mailboxes: [], availableBanks: [] })
    }
  }

  // Entrar al paso es asomarse a un sistema externo (el correo): una sola carga, y el retorno de
  // OAuth se atiende una vez y se limpia de la URL para que un refresh no lo repita.
  useEffect(() => {
    if (handled.current) return
    handled.current = true
    void loadStatus()
    if (outlookResult === "error")
      toast.error(
        `No se pudo conectar Outlook${outlookReason ? ` (${outlookReason})` : ""}`
      )
    // Sin el paso guardado (otra pestaña, sesión nueva), limpiar la URL dejaría la bienvenida.
    if (outlookResult) {
      sessionStorage.setItem(STORAGE_KEY, "connect")
      router.replace("/dashboard", { scroll: false })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- evento único al entrar al paso
  }, [])

  return (
    <OutlookBankConnection
      status={status}
      onReload={async () => {
        await loadStatus()
        onImported()
      }}
      onImportingChange={onImportingChange}
      inline
    />
  )
}

function NotConfigured({ onContinue }: { onContinue: () => void }) {
  return (
    <div className="flex flex-1 flex-col gap-4">
      <section
        aria-labelledby="onb-outlook-missing"
        className="rounded-xl bg-card p-(--pad-card)"
      >
        <h2 id="onb-outlook-missing" className="font-semibold">
          Falta configurar Outlook
        </h2>
        <p className="mt-1 text-callout text-pretty text-ink-2">
          Esta instalación no tiene{" "}
          <code className="text-caption">OUTLOOK_CLIENT_ID</code> ni{" "}
          <code className="text-caption">OUTLOOK_CLIENT_SECRET</code>. Sin
          ellos no se puede leer el correo del banco; puedes seguir y conectarlo
          después desde Ajustes.
        </p>
        <a
          href={README_OUTLOOK}
          target="_blank"
          rel="noreferrer"
          className="press -mx-2 mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-callout font-semibold text-primary hover:bg-primary-soft"
        >
          Cómo configurarlo
          <ExternalLink aria-hidden className="size-4" />
        </a>
      </section>
      <StepActions>
        <Button size="lg" onClick={onContinue} className="w-full">
          Continuar <ArrowRight aria-hidden className="size-4" />
        </Button>
      </StepActions>
    </div>
  )
}

function Preview({
  transactions,
  onContinue,
}: {
  transactions: TransactionDTO[]
  onContinue: () => void
}) {
  const sample = transactions.filter((t) => t.categoryId).slice(0, 5)
  return (
    <div className="flex flex-1 flex-col gap-4">
      {sample.length > 0 ? (
        // Solo muestra: las filas no abren nada, así que el grupo no recibe foco ni clics.
        <ul inert className="flex flex-col rounded-xl bg-card px-(--pad-card) py-2">
          {sample.map((tx, i) => (
            <li
              key={tx.id}
              style={{ animationDelay: `${i * 80}ms` }}
              className="animate-in duration-300 fill-mode-both fade-in-0 slide-in-from-bottom-2 motion-reduce:animate-none"
            >
              <MovementRow tx={tx} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-xl bg-card p-(--pad-card) text-callout text-pretty text-ink-2">
          Aún no hay movimientos de este mes. Llegarán con el próximo aviso de
          tu banco.
        </p>
      )}
      <StepActions>
        <Button size="lg" onClick={onContinue} className="w-full">
          Continuar <ArrowRight aria-hidden className="size-4" />
        </Button>
      </StepActions>
    </div>
  )
}

function Done({
  globalLimit,
  spent,
  busy,
  onFinish,
}: {
  globalLimit: number | null
  spent: number
  busy: boolean
  onFinish: () => void
}) {
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
          Todo listo
        </h1>
        {globalLimit !== null ? (
          // La cifra protagonista de este paso: el tope del mes (CLP).
          <div>
            <p className="text-callout text-ink-2">Tu presupuesto del mes</p>
            <p className="text-display font-semibold whitespace-nowrap">
              {formatMoney(globalLimit, "CLP")}
            </p>
            <p className="mt-1 text-callout text-ink-2">
              Ya llevas{" "}
              <span className="font-semibold whitespace-nowrap text-foreground">
                {formatMoney(spent, "CLP")}
              </span>{" "}
              en gastos.
            </p>
          </div>
        ) : (
          <p className="text-callout text-pretty text-ink-2">
            Puedes definir tu presupuesto cuando quieras desde el Inicio.
          </p>
        )}
      </div>
      <StepActions>
        <Button
          size="lg"
          onClick={onFinish}
          disabled={busy}
          aria-busy={busy || undefined}
          className="w-full"
        >
          {busy && (
            <Loader
              aria-hidden
              className="size-4 animate-spin motion-reduce:animate-none"
            />
          )}
          Ir al Inicio <ArrowRight aria-hidden className="size-4" />
        </Button>
      </StepActions>
    </div>
  )
}
