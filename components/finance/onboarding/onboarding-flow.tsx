"use client"

import type { IncomeSource } from "@/arch/v1/domain/finance/income.domain"

import {
  startTransition,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  ViewTransition,
  type ReactNode,
} from "react"
import { useRouter } from "next/navigation"
import {
  ArrowRight,
  CalendarSync,
  Check,
  ExternalLink,
  Loader,
  Mail,
  Plus,
  ShieldCheck,
  Sparkles,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { formatMoney } from "@/lib/finance-format"
import { cn } from "@/lib/utils"
import {
  SCAN_LOOKBACK_MONTHS,
  type OnboardingStatus,
} from "@/lib/onboarding-schemas"
import type { CurrencyCode } from "@/arch/v1/domain/finance/money"
import {
  OutlookBankConnection,
  type OutlookStatus,
} from "../outlook-bank-connection"
import { CategoryModal } from "../category-modal"
import { IncomeModal } from "../income-modal"
import { CategoryIcon } from "../category-icons"
import { MovementRow } from "../movement-row"
import type {
  AccountDTO,
  CategoryDTO,
  IncomeDTO,
  TransactionDTO,
} from "@/arch/v1/application/finance-use-cases/finance-read"
import { CategoriesStep } from "./categories-step"
import { completeOnboarding } from "./http"

const STEPS = [
  "welcome",
  "categories",
  "connect",
  "preview",
  "income",
  "done",
] as const
type Step = (typeof STEPS)[number]

// El paso sobrevive al ida y vuelta de Microsoft (OAuth sale de la app y vuelve con ?outlook=setup).
const STORAGE_KEY = "lucaplan:onboarding-step"
const README_OUTLOOK =
  "https://github.com/WDCPrado/lucaplan-app#-conectar-outlook-banco-de-chile-paso-a-paso"

const noopSubscribe = () => () => {}
function readStoredStep(): Step | null {
  const v = sessionStorage.getItem(STORAGE_KEY)
  return STEPS.includes(v as Step) ? (v as Step) : null
}

// Onboarding de pantalla completa de una cuenta nueva. Orquesta los pasos reutilizando los
// componentes existentes (OutlookBankConnection, IncomeModal, MovementRow). El shell no se desmonta
// hasta onFinish, así que el estado sobrevive a los router.refresh() y lee props frescas.
export function OnboardingFlow({
  status,
  accounts,
  categories,
  incomes,
  availableIncomeSources,
  period,
  globalLimit,
  totalSpent,
  remainingToAllocate,
  transactions,
  outlookResult,
  outlookReason,
  onFinish,
}: {
  status: OnboardingStatus
  accounts: AccountDTO[]
  categories: CategoryDTO[]
  incomes: IncomeDTO[]
  availableIncomeSources: IncomeSource[]
  period: { year: number; month: number; mode: "calendar" | "card_cycle" }
  globalLimit: number | null
  totalSpent: number
  remainingToAllocate: number | null
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
  const [incomeOpen, setIncomeOpen] = useState(false)
  const [catOpen, setCatOpen] = useState(false)

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
      className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-background p-[env(safe-area-inset-top)_env(safe-area-inset-right)_env(safe-area-inset-bottom)_env(safe-area-inset-left)]"
    >
      <header className="mx-auto flex w-full max-w-5xl items-center gap-4 px-5 pt-4 pb-3 lg:px-10 lg:pt-8">
        <Progress index={index} />
        {!locked && step !== "done" && (
          <button
            type="button"
            onClick={finish}
            disabled={finishing}
            className="press min-h-11 shrink-0 px-2 text-subheadline text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            Omitir por ahora
          </button>
        )}
      </header>

      <ViewTransition key={step} enter="nav" exit="nav" default="none">
        <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-5 pt-4 pb-8 lg:px-10 lg:pt-10">
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
                <NotConfigured onContinue={() => go("income")} />
              )}
            </Split>
          )}

          {step === "preview" && (
            <Split
              eyebrow="Así se ve"
              title="Tus movimientos ya llegaron ordenados"
              body="Cada movimiento cae en su categoría. Si alguno queda mal, lo corriges con un toque y Luca Plan aprende."
            >
              <Preview
                transactions={transactions}
                onContinue={() => go("income")}
              />
            </Split>
          )}

          {step === "income" && (
            <Split
              eyebrow="Ingresos"
              title="¿Cuánto ingresas al mes?"
              body="Agrega tus fuentes de ingreso (sueldo, arriendo…). Con eso armamos tu presupuesto."
            >
              <IncomeStep
                incomes={incomes}
                onAdd={() => setIncomeOpen(true)}
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
        </main>
      </ViewTransition>

      <IncomeModal
        availableSources={availableIncomeSources}
        open={incomeOpen}
        onOpenChange={setIncomeOpen}
        accounts={accounts}
        categories={categories}
        income={null}
        period={period}
        onCreateCategory={() => {
          setCatOpen(true)
        }}
      >
        <CategoryModal
          open={catOpen}
          onOpenChange={setCatOpen}
          period={period}
          category={null}
          lockedType="income"
          remainingToAllocate={remainingToAllocate}
        />
      </IncomeModal>
    </div>
  )
}

function Progress({ index }: { index: number }) {
  return (
    <div
      role="progressbar"
      aria-valuemin={1}
      aria-valuemax={STEPS.length}
      aria-valuenow={index + 1}
      aria-valuetext={`Paso ${index + 1} de ${STEPS.length}`}
      aria-label="Progreso del inicio"
      className="flex flex-1 gap-1.5"
    >
      {STEPS.map((s, i) => (
        <span
          key={s}
          aria-hidden
          className="h-1 flex-1 overflow-hidden rounded-full bg-border"
        >
          <span
            className={cn(
              "block h-full origin-left rounded-full bg-primary transition-transform duration-500 ease-out motion-reduce:transition-none",
              i <= index ? "scale-x-100" : "scale-x-0"
            )}
          />
        </span>
      ))}
    </div>
  )
}

// Escritorio: la explicación a un lado y la acción al otro. Móvil: una columna.
function Split({
  eyebrow,
  title,
  body,
  points,
  children,
}: {
  eyebrow: string
  title: string
  body: string
  points?: { icon: typeof Mail; text: string }[]
  children: ReactNode
}) {
  return (
    <div className="grid flex-1 content-start gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-16">
      <div className="lg:sticky lg:top-10 lg:self-start">
        <p className="text-footnote font-semibold tracking-wide text-primary uppercase">
          {eyebrow}
        </p>
        <h1 className="mt-2 text-title-1 font-bold text-balance lg:text-large-title">
          {title}
        </h1>
        <p className="mt-3 text-body text-pretty text-muted-foreground">
          {body}
        </p>
        {points && (
          <ul className="mt-6 flex flex-col gap-3">
            {points.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-start gap-3">
                <Icon
                  aria-hidden
                  className="mt-0.5 size-5 shrink-0 text-primary"
                />
                <span className="text-subheadline text-pretty">{text}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="min-w-0">{children}</div>
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
    <div className="grid flex-1 content-center gap-10 lg:grid-cols-2 lg:gap-16">
      <div className="lg:self-center">
        <h1 className="text-large-title font-bold text-balance">
          Tu plata en orden, sin anotar nada
        </h1>
        <p className="mt-3 text-body text-pretty text-muted-foreground">
          En unos minutos dejamos listos tus categorías, tu banco y tus
          ingresos.
        </p>
        <Button
          onClick={onStart}
          className="mt-8 hidden h-12 px-8 text-body lg:inline-flex"
        >
          Comenzar <ArrowRight aria-hidden className="size-4" />
        </Button>
      </div>
      <ol className="flex flex-col gap-3">
        {IDEAS.map(({ icon: Icon, title, text }, i) => (
          <li
            key={title}
            style={{ animationDelay: `${150 + i * 140}ms` }}
            className="sheet-group flex animate-in items-start gap-4 rounded-xl p-4 duration-500 fill-mode-both fade-in-0 slide-in-from-bottom-3 motion-reduce:animate-none"
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
              <Icon aria-hidden className="size-5" />
            </span>
            <div className="min-w-0">
              <h2 className="text-headline font-semibold">{title}</h2>
              <p className="mt-0.5 text-subheadline text-pretty text-muted-foreground">
                {text}
              </p>
            </div>
          </li>
        ))}
      </ol>
      <Button onClick={onStart} className="h-12 w-full text-body lg:hidden">
        Comenzar <ArrowRight aria-hidden className="size-4" />
      </Button>
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
    if (outlookResult) router.replace("/dashboard", { scroll: false })
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
    <div className="flex flex-col gap-4">
      <div className="sheet-group rounded-xl p-4">
        <h2 className="text-headline font-semibold">Falta configurar Outlook</h2>
        <p className="mt-1 text-subheadline text-pretty text-muted-foreground">
          Esta instalación no tiene{" "}
          <code className="text-footnote">OUTLOOK_CLIENT_ID</code> ni{" "}
          <code className="text-footnote">OUTLOOK_CLIENT_SECRET</code>. Sin
          ellos no se puede leer el correo del banco; puedes seguir y conectarlo
          después desde Ajustes.
        </p>
        <a
          href={README_OUTLOOK}
          target="_blank"
          rel="noreferrer"
          className="press mt-2 inline-flex min-h-11 items-center gap-1.5 text-body text-primary"
        >
          Cómo configurarlo
          <ExternalLink aria-hidden className="size-4" />
        </a>
      </div>
      <Button onClick={onContinue} className="h-12 w-full text-body">
        Continuar <ArrowRight aria-hidden className="size-4" />
      </Button>
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
    <div className="flex flex-col gap-6">
      {sample.length > 0 ? (
        <ul className="sheet-group inset-list overflow-hidden rounded-xl">
          {sample.map((tx, i) => (
            <li
              key={tx.id}
              style={{ animationDelay: `${i * 80}ms` }}
              className="animate-in duration-300 fill-mode-both fade-in-0 slide-in-from-bottom-2 motion-reduce:animate-none"
            >
              <MovementRow tx={tx} className="px-4" />
            </li>
          ))}
        </ul>
      ) : (
        <p className="sheet-group rounded-xl p-4 text-subheadline text-pretty text-muted-foreground">
          Aún no hay movimientos de este mes. Llegarán con el próximo aviso de
          tu banco.
        </p>
      )}
      <Button onClick={onContinue} className="h-12 w-full text-body">
        Continuar <ArrowRight aria-hidden className="size-4" />
      </Button>
    </div>
  )
}

function IncomeStep({
  incomes,
  onAdd,
  onContinue,
}: {
  incomes: IncomeDTO[]
  onAdd: () => void
  onContinue: () => void
}) {
  return (
    <div className="flex flex-col gap-6">
      {incomes.length > 0 && (
        <ul className="sheet-group inset-list overflow-hidden rounded-xl">
          {incomes.map((i) => (
            <li
              key={i.id}
              className="flex min-h-11 items-center gap-3 px-4 py-3"
            >
              <CategoryIcon
                icon={i.categoryIcon}
                size={20}
                color={i.categoryColor ?? undefined}
              />
              <span className="min-w-0 flex-1 truncate text-body">
                {i.name}
              </span>
              <span className="tabular text-body font-semibold text-success">
                +{formatMoney(i.amount, i.currency as CurrencyCode)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <Button
        variant="outline"
        onClick={onAdd}
        className="h-12 w-full text-body"
      >
        <Plus aria-hidden className="size-4" />
        Agregar ingreso
      </Button>
      {incomes.length === 0 && (
        <p className="text-footnote text-pretty text-muted-foreground">
          Si prefieres, sigue sin ingresos: los agregas después en «Ajustar
          plan».
        </p>
      )}
      <Button onClick={onContinue} className="h-12 w-full text-body">
        Continuar <ArrowRight aria-hidden className="size-4" />
      </Button>
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
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-8 text-center">
      <div className="flex flex-col items-center gap-4">
        <span className="grid size-16 animate-in place-items-center rounded-full bg-success/15 text-success duration-500 zoom-in-75 motion-reduce:animate-none">
          <Check aria-hidden className="size-8" />
        </span>
        <div>
          <h1 className="text-title-1 font-bold">Todo listo</h1>
          {globalLimit !== null ? (
            <p className="mt-2 text-subheadline text-pretty text-muted-foreground">
              Tu presupuesto del mes es de{" "}
              <span className="font-semibold text-foreground">
                {formatMoney(globalLimit, "CLP")}
              </span>
              . Ya llevas {formatMoney(spent, "CLP")} en gastos.
            </p>
          ) : (
            <p className="mt-2 text-subheadline text-pretty text-muted-foreground">
              Puedes definir tu presupuesto cuando quieras desde el Inicio.
            </p>
          )}
        </div>
      </div>
      <Button
        onClick={onFinish}
        disabled={busy}
        aria-busy={busy || undefined}
        className="h-12 w-full text-body"
      >
        {busy && (
          <Loader
            aria-hidden
            className="size-4 animate-spin motion-reduce:animate-none"
          />
        )}
        Ir al Inicio <ArrowRight aria-hidden className="size-4" />
      </Button>
    </div>
  )
}
