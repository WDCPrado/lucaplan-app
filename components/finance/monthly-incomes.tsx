"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Check, Loader2, Plus } from "lucide-react"
import { toast } from "sonner"
import { haptic } from "@/lib/haptics"
import { formatMoney } from "@/lib/finance-format"
import { cn } from "@/lib/utils"
import type { CurrencyCode } from "@/arch/v1/domain/finance/money"
import { CategoryIcon } from "./category-icons"
import { IncomeModal } from "./income-modal"
import type {
  AccountDTO,
  CategoryDTO,
  IncomeDTO,
} from "@/arch/v1/application/finance-use-cases/finance-read"

// Sección "Ingresos del mes": fuentes de ingreso del usuario con su estado del mes (generado o no),
// botón para generar el movimiento, y CRUD vía IncomeModal. Si el presupuesto ya está definido y la
// suma de ingresos difiere, ofrece actualizar el límite global (acción explícita, nunca automática).
export function MonthlyIncomes({
  incomes,
  accounts,
  categories,
  period,
  globalLimit,
  onCreateCategory,
}: {
  incomes: IncomeDTO[]
  accounts: AccountDTO[]
  categories: CategoryDTO[]
  period: { year: number; month: number }
  globalLimit: number | null
  onCreateCategory: () => void
}) {
  const router = useRouter()
  const [modal, setModal] = useState<IncomeDTO | null | undefined>(undefined) // undefined=cerrado, null=crear
  const [generating, setGenerating] = useState<string | null>(null)
  const [applying, setApplying] = useState(false)

  const activeTotal = incomes
    .filter((i) => i.isActive && i.currency === "CLP")
    .reduce((s, i) => s + i.amount, 0)
  // Sugerir actualizar el presupuesto solo si ya hay límite definido y la suma difiere.
  const suggest =
    globalLimit !== null && activeTotal > 0 && activeTotal !== globalLimit

  async function generate(income: IncomeDTO) {
    setGenerating(income.id)
    const res = await fetch(
      `/api/incomes/${income.id}/generate?year=${period.year}&month=${period.month}`,
      { method: "POST" }
    )
    const data = await res.json().catch(() => ({}))
    setGenerating(null)
    if (!res.ok) {
      haptic("error")
      return toast.error(data.error ?? "No se pudo generar el ingreso")
    }
    haptic("success")
    toast.success(
      data.created ? "Ingreso generado" : "Ese ingreso ya estaba generado"
    )
    router.refresh()
  }

  async function applySuggestion() {
    setApplying(true)
    const res = await fetch("/api/budgets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        year: period.year,
        month: period.month,
        globalLimit: activeTotal,
      }),
    })
    setApplying(false)
    if (!res.ok) {
      haptic("error")
      return toast.error("No se pudo actualizar el presupuesto")
    }
    haptic("success")
    toast.success("Presupuesto actualizado")
    router.refresh()
  }

  return (
    <section id="ingresos" className="scroll-mt-20">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-heading text-lg font-bold">Ingresos del mes</h2>
        <button
          onClick={() => setModal(null)}
          className="flex items-center gap-1.5 text-sm text-primary"
        >
          <Plus className="size-4" /> Agregar
        </button>
      </div>

      <div className="glass rounded-2xl p-4">
        {suggest && (
          <div className="mb-4 flex flex-col gap-2 rounded-xl bg-secondary/50 p-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm">
              Tus ingresos suman{" "}
              <span className="tabular font-semibold">
                {formatMoney(activeTotal, "CLP")}
              </span>{" "}
              · presupuesto en {formatMoney(globalLimit ?? 0, "CLP")}
            </p>
            <button
              onClick={applySuggestion}
              disabled={applying}
              className="shrink-0 rounded-full bg-primary px-4 py-1.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {applying ? "Actualizando…" : "Actualizar presupuesto"}
            </button>
          </div>
        )}

        {incomes.length === 0 ? (
          <button
            onClick={() => setModal(null)}
            className="flex w-full flex-col items-center gap-2 py-6 text-muted-foreground"
          >
            <span className="grid size-16 place-items-center rounded-full border-2 border-dashed border-border text-2xl">
              +
            </span>
            <span className="text-sm">Agregar tu primer ingreso</span>
          </button>
        ) : (
          <ul className="flex flex-col gap-2">
            {incomes.map((income) => (
              <li
                key={income.id}
                className={cn(
                  "flex items-center gap-3 rounded-xl bg-secondary/40 p-3",
                  !income.isActive && "opacity-50"
                )}
              >
                <button
                  onClick={() => setModal(income)}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                  <CategoryIcon
                    icon={income.categoryIcon}
                    size={20}
                    color={income.categoryColor ?? undefined}
                  />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">
                      {income.name}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      Día {income.dayOfMonth} · {income.accountName}
                    </div>
                  </div>
                </button>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="tabular text-sm font-semibold text-success">
                    +{formatMoney(income.amount, income.currency as CurrencyCode)}
                  </span>
                  {income.generated ? (
                    <span className="flex items-center gap-1 text-xs font-medium text-success">
                      <Check className="size-3.5" /> Generado
                    </span>
                  ) : (
                    <button
                      onClick={() => generate(income)}
                      disabled={generating === income.id}
                      className="rounded-full border border-primary/40 px-3 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/10 disabled:opacity-60"
                    >
                      {generating === income.id ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        "Generar"
                      )}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {modal !== undefined && (
        <IncomeModal
          key={modal?.id ?? "new"}
          open
          onOpenChange={(o) => !o && setModal(undefined)}
          accounts={accounts}
          categories={categories}
          income={modal}
          period={period}
          onCreateCategory={onCreateCategory}
        />
      )}
    </section>
  )
}
