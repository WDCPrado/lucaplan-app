"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { ModalFooter, ResponsiveModal } from "@/components/ui/responsive-modal"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { haptic } from "@/lib/haptics"
import { useMoneyInput } from "@/hooks/use-money-input"
import { CategoryIcon } from "./category-icons"
import { Chip, DatePicker, toISODate } from "./transaction-modal"
import type { CurrencyCode } from "@/arch/v1/domain/finance/money"
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
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [date, setDate] = useState(() => toISODate(new Date()))
  const [saving, setSaving] = useState(false)

  // Cuenta activa: la seleccionada o la primera (cubre el caso de crear una cuenta recién).
  const account = accounts.find((a) => a.id === accountId) ?? accounts[0]
  const money = useMoneyInput((account?.currency as CurrencyCode) ?? "CLP")
  const amountNum = money.value
  const canSave = amountNum > 0 && !!account && !saving

  // ponytail: el formulario crea SOLO ingresos por ahora — los gastos llegan solos por el correo
  // del banco; reponer el toggle de lado si algún día vuelve el gasto manual.
  const connected = !!account && account.provider !== "manual"
  const visibleCategories = categories.filter((c) => c.type === "income")

  async function save() {
    if (!canSave || !account) return
    setSaving(true)
    const res = await fetch("/api/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accountId: account.id,
        categoryId,
        amount: amountNum,
        currency: account.currency,
        direction: "credit",
        description: description || "Ingreso",
        date,
      }),
    })
    setSaving(false)
    haptic(res.ok ? "success" : "error")
    // Sin esto, un fallo era invisible: el sheet quedaba abierto "sin pasar nada".
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      toast.error(data.error ?? "No se pudo registrar el ingreso")
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
      title="Nuevo ingreso"
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
          {/* Sin la insignia "+": imitaba el toggle ± del form de movimiento sin ser un control.
              El verde del monto ya dice "entra dinero". */}
          <Input
            inputMode="numeric"
            placeholder="0"
            value={money.display}
            onChange={(e) => money.onChange(e.target.value)}
            aria-label="Monto del ingreso"
            className="tabular h-12 border-0 bg-transparent px-0 text-3xl font-bold text-success shadow-none focus-visible:ring-0"
          />
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
                Sin categorías de ingreso.
              </span>
            ) : (
              visibleCategories.map((c) => (
                <Chip
                  key={c.id}
                  active={c.id === categoryId}
                  onClick={() =>
                    setCategoryId(c.id === categoryId ? null : c.id)
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

