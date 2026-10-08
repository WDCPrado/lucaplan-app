"use client"

import { useCallback, useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowRight, Check, Mail, Sparkles, Wallet } from "lucide-react"
import { Button } from "@/components/ui/button"
import { formatMoney } from "@/lib/finance-format"
import type { CurrencyCode } from "@/arch/v1/domain/finance/money"
import {
  OutlookBankConnection,
  type OutlookStatus,
} from "../outlook-bank-connection"
import { UncategorizedTriage } from "../uncategorized-triage"
import { CategoryModal } from "../category-modal"
import { IncomeModal } from "../income-modal"
import { CategoryIcon } from "../category-icons"
import type {
  AccountDTO,
  CategoryDTO,
  IncomeDTO,
  TransactionDTO,
} from "@/arch/v1/application/finance-use-cases/finance-read"

type Step = "welcome" | "connect" | "triage" | "income" | "budget"

// Cuántos grupos de comercio más frecuentes se preguntan en el onboarding (el resto queda para el
// triage normal del dashboard).
const MAX_TRIAGE_GROUPS = 8

// Normaliza la descripción para agrupar variantes del mismo comercio (recorta dígitos/ruido).
const groupKey = (desc: string) =>
  desc
    .toLowerCase()
    .replace(/[0-9]+/g, " ")
    .replace(/[^a-záéíóúñ ]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim()

// Deja solo los movimientos de los ~8 grupos de comercio más frecuentes.
function topGroups(txs: TransactionDTO[]): TransactionDTO[] {
  const groups = new Map<string, TransactionDTO[]>()
  for (const t of txs) {
    const k = groupKey(t.description) || t.description
    const arr = groups.get(k) ?? []
    arr.push(t)
    groups.set(k, arr)
  }
  return [...groups.values()]
    .sort((a, b) => b.length - a.length)
    .slice(0, MAX_TRIAGE_GROUPS)
    .flat()
}

// Onboarding fullscreen de la primera conexión. Orquesta pasos reutilizando los componentes
// existentes; el estado del paso vive en el cliente y sobrevive a los router.refresh() (el shell no
// se desmonta hasta onFinish). Lee props frescas del dashboard tras cada refresh.
export function OnboardingFlow({
  accounts,
  categories,
  uncategorized,
  incomes,
  period,
  globalLimit,
  totalSpent,
  remainingToAllocate,
  onFinish,
}: {
  accounts: AccountDTO[]
  categories: CategoryDTO[]
  uncategorized: { transactions: TransactionDTO[]; hasMore: boolean }
  incomes: IncomeDTO[]
  period: { year: number; month: number }
  globalLimit: number | null
  totalSpent: number
  remainingToAllocate: number | null
  onFinish: () => void
}) {
  const router = useRouter()
  const [step, setStep] = useState<Step>("welcome")
  const [status, setStatus] = useState<OutlookStatus | null>(null)
  const [locked, setLocked] = useState(false) // import en curso: no permitir cerrar
  const [incomeOpen, setIncomeOpen] = useState(false)
  const [catOpen, setCatOpen] = useState(false)
  // Snapshot ESTABLE de los movimientos a categorizar: se arma al terminar el import (datos frescos,
  // no del prop que llega atrasado) y no cambia mientras el triage está abierto, para que corregir la
  // última categoría no lo desmonte.
  const [triageTxs, setTriageTxs] = useState<TransactionDTO[] | null>(null)

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/email-connection/status", {
        cache: "no-store",
      })
      setStatus(await res.json())
    } catch {
      setStatus({ providers: [], mailboxes: [], availableBanks: [] })
    }
  }, [])

  // Import terminado (OutlookBankConnection llama onReload): refresca datos y arma el triage con los
  // sin-categoría FRESCOS (traídos por API, no del prop que puede ir atrasado tras el import). Si no
  // hay nada que categorizar, salta al paso de ingresos.
  async function afterImport() {
    await loadStatus()
    router.refresh()
    try {
      const res = await fetch("/api/transactions/search?uncategorized=1", {
        cache: "no-store",
      })
      const txs = (await res.json()) as TransactionDTO[]
      const top = topGroups(Array.isArray(txs) ? txs : [])
      setTriageTxs(top)
      setStep(top.length > 0 ? "triage" : "income")
    } catch {
      setStep("income")
    }
  }

  // El triage trae su propio Dialog fullscreen; se monta en vez del shell. Usa el snapshot estable
  // (no el prop) para que corregir la última categoría no lo desmonte.
  if (step === "triage" && triageTxs && triageTxs.length > 0) {
    return (
      <>
        <UncategorizedTriage
          transactions={triageTxs}
          hasMore={uncategorized.hasMore}
          accounts={accounts}
          categories={categories}
          onClose={() => setStep("income")}
          onCreateCategory={() => setCatOpen(true)}
        />
        <CategoryModal
          open={catOpen}
          onOpenChange={setCatOpen}
          period={period}
          category={null}
          remainingToAllocate={remainingToAllocate}
        />
      </>
    )
  }

  // Fuera del triage, la vista es el paso actual (si quedó en "triage" sin movimientos, muestra ingresos).
  const view: Step = step === "triage" ? "income" : step

  return (
    <div className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-background p-[env(safe-area-inset-top)_env(safe-area-inset-right)_env(safe-area-inset-bottom)_env(safe-area-inset-left)]">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col px-5 py-8">
        <StepDots step={view} />
        <div
          key={view}
          className="flex flex-1 animate-in flex-col duration-300 fade-in-0 slide-in-from-right-4 motion-reduce:slide-in-from-right-0"
        >
          {view === "welcome" && (
            <Welcome
              onStart={() => {
                setStep("connect")
                void loadStatus()
              }}
            />
          )}

          {view === "connect" && (
            <div className="flex flex-1 flex-col gap-8">
              <Header
                icon={Mail}
                title="Revisemos tus correos"
                subtitle="Detectamos tus cuentas y tarjetas desde las notificaciones del banco."
              />
              <div className="flex items-start gap-2 rounded-xl border border-primary/25 bg-primary/5 p-3 text-sm text-muted-foreground">
                <Wallet className="mt-0.5 size-4 shrink-0 text-primary" />
                <span>
                  Ingresa el{" "}
                  <span className="font-medium text-foreground">
                    saldo actual
                  </span>{" "}
                  de cada cuenta y tarjeta. Los movimientos que detectamos los{" "}
                  <span className="font-medium text-foreground">
                    revisarás y validarás
                  </span>{" "}
                  en el paso siguiente.
                </span>
              </div>
              <OutlookBankConnection
                status={status}
                accounts={accounts.filter(
                  (a) => a.connectionMethod === "email"
                )}
                onReload={afterImport}
                onImportingChange={setLocked}
              />
            </div>
          )}

          {view === "income" && (
            <IncomeStep
              incomes={incomes}
              onAdd={() => setIncomeOpen(true)}
              onContinue={() => setStep("budget")}
            />
          )}

          {view === "budget" && (
            <BudgetReady
              globalLimit={globalLimit}
              spent={totalSpent}
              onFinish={onFinish}
            />
          )}
        </div>

        {!locked && view !== "welcome" && view !== "budget" && (
          <button
            onClick={onFinish}
            className="mt-6 min-h-11 self-center px-4 text-sm text-muted-foreground hover:text-foreground"
          >
            Omitir por ahora
          </button>
        )}
      </div>

      <IncomeModal
        open={incomeOpen}
        onOpenChange={setIncomeOpen}
        accounts={accounts}
        categories={categories}
        income={null}
        period={period}
        onCreateCategory={() => {
          setIncomeOpen(false)
          setCatOpen(true)
        }}
      />
      <CategoryModal
        open={catOpen}
        onOpenChange={setCatOpen}
        period={period}
        category={null}
        remainingToAllocate={remainingToAllocate}
      />
    </div>
  )
}

const STEPS: Step[] = ["welcome", "connect", "triage", "income", "budget"]

function StepDots({ step }: { step: Step }) {
  const idx = STEPS.indexOf(step)
  return (
    <div className="mb-8 flex justify-center gap-1.5" aria-hidden>
      {STEPS.map((s, i) => (
        <span
          key={s}
          className={
            i <= idx
              ? "h-1.5 w-6 rounded-full bg-primary transition-all"
              : "h-1.5 w-1.5 rounded-full bg-border transition-all"
          }
        />
      ))}
    </div>
  )
}

function Header({
  icon: Icon,
  title,
  subtitle,
}: {
  icon: typeof Mail
  title: string
  subtitle: string
}) {
  return (
    <div className="flex flex-col gap-3">
      <span className="grid size-12 place-items-center rounded-full bg-primary/10 text-primary">
        <Icon className="size-6" />
      </span>
      <div>
        <h1 className="font-heading text-2xl font-bold text-balance">
          {title}
        </h1>
        <p className="mt-1 text-sm text-pretty text-muted-foreground">
          {subtitle}
        </p>
      </div>
    </div>
  )
}

function Welcome({ onStart }: { onStart: () => void }) {
  return (
    <div className="flex flex-1 flex-col justify-center gap-8 text-center">
      <div className="flex flex-col items-center gap-4">
        <span className="grid size-16 place-items-center rounded-full bg-primary/10 text-primary">
          <Sparkles className="size-8" />
        </span>
        <div>
          <h1 className="font-heading text-3xl font-bold text-balance">
            Armemos tu presupuesto
          </h1>
          <p className="mx-auto mt-2 max-w-xs text-sm text-pretty text-muted-foreground">
            Leemos los correos de tu banco, ordenamos tus movimientos y creamos
            tu presupuesto del mes. Toma un minuto.
          </p>
        </div>
      </div>
      <Button onClick={onStart} className="h-12 w-full text-base">
        Comenzar <ArrowRight className="size-4" />
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
    <div className="flex flex-1 flex-col gap-8">
      <Header
        icon={Wallet}
        title="¿Cuánto ingresas al mes?"
        subtitle="Agrega tus fuentes de ingreso (sueldo, arriendo…). Con eso armamos tu presupuesto."
      />
      {incomes.length > 0 && (
        <ul className="flex flex-col gap-2">
          {incomes.map((i) => (
            <li
              key={i.id}
              className="flex items-center gap-3 rounded-xl bg-secondary/40 p-3"
            >
              <CategoryIcon
                icon={i.categoryIcon}
                size={20}
                color={i.categoryColor ?? undefined}
              />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {i.name}
              </span>
              <span className="tabular text-sm font-semibold text-success">
                +{formatMoney(i.amount, i.currency as CurrencyCode)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <Button
        variant="outline"
        onClick={onAdd}
        className="h-12 w-full border-dashed"
      >
        + Agregar ingreso
      </Button>
      <div className="flex-1" />
      <Button
        onClick={onContinue}
        disabled={incomes.length === 0}
        className="h-12 w-full text-base"
      >
        Continuar <ArrowRight className="size-4" />
      </Button>
    </div>
  )
}

function BudgetReady({
  globalLimit,
  spent,
  onFinish,
}: {
  globalLimit: number | null
  spent: number
  onFinish: () => void
}) {
  return (
    <div className="flex flex-1 flex-col justify-center gap-8 text-center">
      <div className="flex flex-col items-center gap-4">
        <span className="grid size-16 place-items-center rounded-full bg-success/15 text-success">
          <Check className="size-8" />
        </span>
        <div>
          <h1 className="font-heading text-2xl font-bold">¡Todo listo!</h1>
          {globalLimit !== null ? (
            <p className="mt-2 text-sm text-pretty text-muted-foreground">
              Tu presupuesto del mes es de{" "}
              <span className="font-semibold text-foreground">
                {formatMoney(globalLimit, "CLP")}
              </span>
              . Ya llevas {formatMoney(spent, "CLP")} en gastos.
            </p>
          ) : (
            <p className="mt-2 text-sm text-pretty text-muted-foreground">
              Puedes definir tu presupuesto cuando quieras desde el dashboard.
            </p>
          )}
        </div>
      </div>
      <Button onClick={onFinish} className="h-12 w-full text-base">
        Ir al dashboard <ArrowRight className="size-4" />
      </Button>
    </div>
  )
}
