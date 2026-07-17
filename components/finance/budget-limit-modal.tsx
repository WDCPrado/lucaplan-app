"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { haptic } from "@/lib/haptics"
import { ResponsiveModal } from "@/components/ui/responsive-modal"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useMoneyInput } from "@/hooks/use-money-input"
import { monthName } from "@/lib/finance-format"

// Define/edita el límite global del presupuesto del mes (POST /api/budgets, upsert). Los meses
// siguientes lo heredan (carry-forward) hasta que se cambie; 0 es presupuesto cero, no "sin límite".
export function BudgetLimitModal({
  open,
  onOpenChange,
  period,
  current,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  period: { year: number; month: number }
  current: number | null
}) {
  const router = useRouter()
  const limit = useMoneyInput("CLP", current ?? 0)
  const [saving, setSaving] = useState(false)

  async function save() {
    if (saving) return
    setSaving(true)
    const res = await fetch("/api/budgets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        year: period.year,
        month: period.month,
        globalLimit: limit.value,
      }),
    })
    setSaving(false)
    if (!res.ok) {
      haptic("error")
      toast.error("No se pudo guardar el presupuesto del mes")
      return
    }
    haptic("success")
    onOpenChange(false)
    router.refresh()
  }

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title={`Presupuesto de ${monthName(period.month)}`}
    >
      <div className="flex flex-col gap-4 px-4 pb-6 sm:px-6">
        <div>
          <Label className="mb-1 block text-xs">
            Límite global del mes (CLP)
          </Label>
          <Input
            inputMode="numeric"
            value={limit.display}
            onChange={(e) => limit.onChange(e.target.value)}
            placeholder="500.000"
            className="tabular h-11 text-base"
            autoFocus
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Controla cuánto puedes repartir entre tus categorías. Los meses
            siguientes heredan este límite hasta que lo cambies.
          </p>
        </div>
        <Button
          onClick={save}
          disabled={saving}
          className="h-12 rounded-full text-base"
        >
          {saving ? "Guardando…" : "Guardar"}
        </Button>
      </div>
    </ResponsiveModal>
  )
}
