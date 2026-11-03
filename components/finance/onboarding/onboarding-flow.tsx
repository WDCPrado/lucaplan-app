"use client"

import { Button } from "glisse"
import { Portal } from "radix-ui"

import type { IncomeSource } from "@/arch/v1/domain/finance/income.domain"

import { useCallback, useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowRight, Check, Plus, Wallet } from "lucide-react"

import { formatMoney } from "@/lib/finance-format"
import type { CurrencyCode } from "@/arch/v1/domain/finance/money"
import {
  OutlookBankConnection,
  type OutlookStatus,
} from "../outlook-bank-connection"
import { CategoryModal } from "../category-modal"
import { IncomeModal } from "../income-modal"
import { CategoryIcon } from "../category-icons"
import type {
  AccountDTO,
  CategoryDTO,
  IncomeDTO,
} from "@/arch/v1/application/finance-use-cases/finance-read"

type Step = "welcome" | "connect" | "income" | "budget"

// Onboarding fullscreen de la primera conexión. Orquesta pasos reutilizando los componentes
// existentes; el estado del paso vive en el cliente y sobrevive a los router.refresh() (el shell no
// se desmonta hasta onFinish). Lee props frescas del dashboard tras cada refresh.
export function OnboardingFlow({
  accounts,
  categories,
  incomes,
  availableIncomeSources,
  period,
  globalLimit,
  totalSpent,
  remainingToAllocate,
  onFinish,
}: {
  accounts: AccountDTO[]
  categories: CategoryDTO[]
  incomes: IncomeDTO[]
  availableIncomeSources: IncomeSource[]
  period: { year: number; month: number; mode: "calendar" | "card_cycle" }
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

  // Import terminado (OutlookBankConnection llama onReload): refresca datos y sigue a ingresos.
  async function afterImport() {
    await loadStatus()
    router.refresh()
    setStep("income")
  }

  const view = step

  return (
    <Portal.Root>
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
                  title="Revisemos tus correos"
                  subtitle="Detectamos tus cuentas y tarjetas desde las notificaciones del banco."
                />
                <div className="flex items-start gap-2 rounded-xl border border-primary/25 bg-primary/5 p-3 text-subheadline text-muted-foreground">
                  <Wallet className="mt-0.5 size-4 shrink-0 text-primary" />
                  <span>
                    Ingresa el{" "}
                    <span className="font-medium text-foreground">
                      saldo actual
                    </span>{" "}
                    de cada cuenta y tarjeta.
                  </span>
                </div>
                <OutlookBankConnection
                  status={status}
                  onReload={afterImport}
                  onImportingChange={setLocked}
                  inline
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
            <Button
              onClick={onFinish}
              className="mt-6 min-h-11 self-center px-4 text-subheadline text-muted-foreground hover:text-foreground"
            >
              Omitir por ahora
            </Button>
          )}
        </div>

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
    </Portal.Root>
  )
}

const STEPS: Step[] = ["welcome", "connect", "income", "budget"]

function StepDots({ step }: { step: Step }) {
  const idx = STEPS.indexOf(step)
  return (
    <div
      role="progressbar"
      aria-valuemin={1}
      aria-valuemax={STEPS.length}
      aria-valuenow={idx + 1}
      aria-valuetext={`Paso ${idx + 1} de ${STEPS.length}`}
      aria-label={`Paso ${idx + 1} de ${STEPS.length}`}
      className="mb-8 flex justify-center gap-1.5"
    >
      {STEPS.map((s, i) => (
        <span
          key={s}
          aria-hidden
          className={
            i <= idx
              ? "h-1.5 w-6 rounded-full bg-primary transition-all motion-reduce:transition-none"
              : "h-1.5 w-1.5 rounded-full bg-border transition-all motion-reduce:transition-none"
          }
        />
      ))}
    </div>
  )
}

function Header({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div>
      <h1 className="text-title-1 font-bold text-balance">{title}</h1>
      <p className="mt-1 text-body text-pretty text-muted-foreground">
        {subtitle}
      </p>
    </div>
  )
}

function Welcome({ onStart }: { onStart: () => void }) {
  return (
    <div className="flex flex-1 flex-col justify-center gap-8 text-center">
      <div className="flex flex-col items-center gap-4">
        <div>
          <h1 className="text-large-title font-bold text-balance">
            Armemos tu presupuesto
          </h1>
          <p className="mx-auto mt-2 max-w-xs text-subheadline text-pretty text-muted-foreground">
            Leemos los correos de tu banco, ordenamos tus movimientos y creamos
            tu presupuesto del mes. Toma un minuto.
          </p>
        </div>
      </div>
      <Button
        variant="filled"
        onClick={onStart}
        className="h-12 w-full text-body"
      >
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
              <span className="min-w-0 flex-1 truncate text-subheadline font-medium">
                {i.name}
              </span>
              <span className="tabular text-subheadline font-semibold text-success">
                +{formatMoney(i.amount, i.currency as CurrencyCode)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <Button onClick={onAdd} className="h-12 w-full text-body">
        <Plus className="size-4" />
        Agregar ingreso
      </Button>
      <div className="flex-1" />
      <Button
        variant="filled"
        onClick={onContinue}
        disabled={incomes.length === 0}
        className="h-12 w-full text-body"
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
          <h1 className="text-title-1 font-bold">¡Todo listo!</h1>
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
              Puedes definir tu presupuesto cuando quieras desde el dashboard.
            </p>
          )}
        </div>
      </div>
      <Button
        variant="filled"
        onClick={onFinish}
        className="h-12 w-full text-body"
      >
        Ir al dashboard <ArrowRight className="size-4" />
      </Button>
    </div>
  )
}
