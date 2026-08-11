"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { ModalFooter, ResponsiveModal } from "@/components/ui/responsive-modal"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { haptic } from "@/lib/haptics"
import { useMoneyInput } from "@/hooks/use-money-input"
import { CategoryIcon } from "./category-icons"
import {
  Chip,
  DatePicker,
  DirectionToggle,
  toISODate,
} from "./transaction-modal"
import type { CurrencyCode } from "@/arch/v1/domain/finance/money"
import type { Direction } from "@/arch/v1/domain/finance/finance.domain"
import type {
  AccountDTO,
  CategoryDTO,
} from "@/arch/v1/application/finance-use-cases/finance-read"

export function AddTransactionSheet({
  open,
  onOpenChange,
  accounts,
  categories,
  onCreateAccount,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  accounts: AccountDTO[]
  categories: CategoryDTO[]
  onCreateAccount: () => void
}) {
  const router = useRouter()
  const [description, setDescription] = useState("")
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "")
  const [side, setSide] = useState<Direction>("debit")
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [date, setDate] = useState(() => toISODate(new Date()))
  const [saving, setSaving] = useState(false)

  // Cuenta activa: la seleccionada o la primera (cubre el caso de crear una cuenta recién).
  const account = accounts.find((a) => a.id === accountId) ?? accounts[0]
  const money = useMoneyInput((account?.currency as CurrencyCode) ?? "CLP")
  const amountNum = money.value
  const canSave = amountNum > 0 && !!account && !saving

  // Cuenta conectada: el backend solo acepta abonos ahí (los cargos llegan por correo), así que
  // el lado queda fijo en ingreso. Derivado, no sincronizado: cambiar de cuenta ya lo corrige.
  const connected = !!account && account.provider !== "manual"
  const direction = connected ? "credit" : side
  const income = direction === "credit"
  const visibleCategories = categories.filter(
    (c) => c.type === (income ? "income" : "expense")
  )
  // La categoría elegida solo vale para el lado actual; si se cambió de lado (o de cuenta), se
  // ignora sin tener que limpiarla a mano.
  const validCategoryId = visibleCategories.some((c) => c.id === categoryId)
    ? categoryId
    : null

  async function save() {
    if (!canSave || !account) return
    setSaving(true)
    const res = await fetch("/api/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accountId: account.id,
        categoryId: validCategoryId,
        amount: amountNum,
        currency: account.currency,
        direction,
        description: description || (income ? "Ingreso" : "Gasto"),
        date,
      }),
    })
    setSaving(false)
    haptic(res.ok ? "success" : "error")
    // Sin esto, un fallo era invisible: el sheet quedaba abierto "sin pasar nada".
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      toast.error(
        data.error ?? `No se pudo registrar el ${income ? "ingreso" : "gasto"}`
      )
      return
    }
    money.reset()
    setDescription("")
    setCategoryId(null)
    setDate(toISODate(new Date()))
    onOpenChange(false)
    router.refresh()
  }

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title="Nuevo movimiento"
    >
      {accounts.length === 0 ? (
        <div className="flex flex-col items-center gap-4 px-4 py-10 text-center">
          <p className="text-sm text-muted-foreground">
            Necesitas una tarjeta para registrar movimientos a mano.
          </p>
          <Button onClick={onCreateAccount} className="h-12 rounded-full">
            Nueva tarjeta
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-5 px-4">
          <Input
            placeholder="Descripción"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="h-12 border-0 bg-transparent px-0 text-2xl font-bold shadow-none focus-visible:ring-0"
          />
          <div className="flex items-center gap-3">
            <DirectionToggle
              value={direction}
              onChange={setSide}
              disabled={connected}
            />
            <Input
              inputMode="numeric"
              placeholder="0"
              value={money.display}
              onChange={(e) => money.onChange(e.target.value)}
              aria-label="Monto del movimiento"
              className={cn(
                // Misma regla que el resto: ingreso verde, gasto neutro.
                "tabular h-12 border-0 bg-transparent px-0 text-3xl font-bold shadow-none focus-visible:ring-0",
                income ? "text-success" : "text-foreground"
              )}
            />
          </div>
          {connected && (
            <p className="-mt-2 text-xs text-muted-foreground">
              Cuenta conectada: aquí registras abonos e ingresos — los cargos
              llegan solos desde el correo del banco.
            </p>
          )}

          <DatePicker value={date} onChange={setDate} />

          {accounts.length > 1 && (
            <div className="-mx-4 flex scrollbar-none gap-2 overflow-x-auto px-4 pb-1">
              {accounts.map((a) => (
                <Chip
                  key={a.id}
                  active={a.id === account?.id}
                  onClick={() => setAccountId(a.id)}
                >
                  {a.name}
                </Chip>
              ))}
            </div>
          )}

          <div className="-mx-4 flex scrollbar-none gap-2 overflow-x-auto px-4 pb-1">
            {visibleCategories.length === 0 ? (
              <span className="text-sm text-muted-foreground">
                Sin categorías de {income ? "ingreso" : "gasto"}.
              </span>
            ) : (
              visibleCategories.map((c) => (
                <Chip
                  key={c.id}
                  active={c.id === validCategoryId}
                  onClick={() =>
                    setCategoryId(c.id === validCategoryId ? null : c.id)
                  }
                >
                  <CategoryIcon icon={c.icon} size={16} /> {c.name}
                </Chip>
              ))
            )}
          </div>

          <ModalFooter>
            <Button
              onClick={save}
              disabled={!canSave}
              className="h-12 flex-1 rounded-full text-base"
            >
              {saving ? "Guardando…" : "Guardar"}
            </Button>
          </ModalFooter>
        </div>
      )}
    </ResponsiveModal>
  )
}

