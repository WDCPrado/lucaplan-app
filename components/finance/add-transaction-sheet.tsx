"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Check, CreditCard, Landmark } from "lucide-react"
import { ModalFooter, ResponsiveModal } from "@/components/ui/responsive-modal"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { MovementScanPanel } from "./movement-scan-panel"
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
  // Cuentas que aceptan movimientos a mano: manuales (todo) y corrientes conectadas por correo
  // (solo abonos: el banco no notifica ingresos por correo; los cargos llegan solos).
  const manualAccounts = accounts.filter(
    (a) =>
      a.provider === "manual" ||
      (a.connectionMethod === "email" && a.accountType === "checking")
  )
  // "Del banco" acepta cualquier cuenta conectada, incluida la tarjeta de crédito: ahí es donde más
  // se pierden los cargos que el aviso no trajo, y el alta a mano ni siquiera la ofrece.
  const bankAccounts = accounts.filter((a) => a.provider !== "manual")

  const [description, setDescription] = useState("")
  const [accountId, setAccountId] = useState(manualAccounts[0]?.id ?? "")
  const [scanAccountId, setScanAccountId] = useState(bankAccounts[0]?.id ?? "")
  const [side, setSide] = useState<Direction>("debit")
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [date, setDate] = useState(() => toISODate(new Date()))
  const [saving, setSaving] = useState(false)

  // Cuenta activa: la seleccionada o la primera (cubre el caso de crear una cuenta recién).
  const account =
    manualAccounts.find((a) => a.id === accountId) ?? manualAccounts[0]
  const scanAccount =
    bankAccounts.find((a) => a.id === scanAccountId) ?? bankAccounts[0]
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

  const manualForm = (
    <>
      <Input
        placeholder="Descripción"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        // md:text-2xl: el Input trae md:text-sm y en escritorio dejaba el título en 14 px.
        className="h-12 border-0 bg-transparent px-0 text-2xl font-bold shadow-none placeholder:font-normal focus-visible:ring-0 md:text-2xl"
      />
      <div className="flex items-center gap-3">
        <DirectionToggle
          value={direction}
          onChange={setSide}
          disabled={connected}
        />
        <span
          className="text-2xl font-semibold text-muted-foreground"
          aria-hidden
        >
          $
        </span>
        <Input
          inputMode="numeric"
          placeholder="0"
          value={money.display}
          onChange={(e) => money.onChange(e.target.value)}
          aria-label="Monto del movimiento"
          className={cn(
            // Misma regla que el resto: ingreso verde, gasto neutro.
            "tabular h-12 border-0 bg-transparent px-0 text-3xl font-bold shadow-none focus-visible:ring-0 md:text-3xl",
            income ? "text-success" : "text-foreground"
          )}
        />
      </div>
      {connected && (
        <p className="-mt-2 text-xs text-muted-foreground">
          Cuenta conectada: aquí registras abonos e ingresos — los cargos llegan
          solos desde el correo del banco.
        </p>
      )}

      <DatePicker value={date} onChange={setDate} />

      {manualAccounts.length > 1 && (
        <div className="-mx-4 flex scrollbar-none gap-2 overflow-x-auto px-4 pb-1">
          {manualAccounts.map((a) => (
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
    </>
  )

  // De qué instrumento es la foto. Se elige la TARJETA o la cuenta, no el banco: dos bancos pueden
  // tener una "Cuenta corriente" y el nombre solo no distingue, así que cada opción muestra su banco
  // y sus últimos 4. Se ve siempre, incluso con una sola: hay que saber dónde va a quedar el gasto.
  const bankTab = scanAccount && (
    <>
      <div className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">¿De cuál es la foto?</p>
        {bankAccounts.map((a) => {
          const active = a.id === scanAccount.id
          const Icon = a.accountType === "credit_card" ? CreditCard : Landmark
          return (
            <button
              key={a.id}
              type="button"
              onClick={() => {
                haptic("light")
                setScanAccountId(a.id)
              }}
              aria-pressed={active}
              className={cn(
                "flex items-center gap-3 rounded-xl border p-3 text-left transition-colors",
                active ? "border-primary bg-accent" : "border-border/60"
              )}
            >
              <span
                className="grid size-9 shrink-0 place-items-center rounded-lg text-white"
                style={{ backgroundColor: a.color ?? "var(--color-primary)" }}
              >
                <Icon className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {a.name}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {a.bankName}
                  {a.cardLast4 && ` ···· ${a.cardLast4}`}
                </span>
              </span>
              {active && <Check className="size-4 shrink-0 text-primary" />}
            </button>
          )
        })}
      </div>
      {/* key: cambiar de cuenta descarta las fotos y los candidatos, que eran de la otra. */}
      <MovementScanPanel
        key={scanAccount.id}
        account={scanAccount}
        onDone={() => onOpenChange(false)}
      />
    </>
  )

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
      ) : bankAccounts.length === 0 ? (
        // Sin cuentas conectadas no hay nada que leer de una cartola: la pestaña sobraría.
        <div className="flex flex-col gap-5 px-4">{manualForm}</div>
      ) : manualAccounts.length === 0 ? (
        <div className="flex flex-col gap-5 px-4">{bankTab}</div>
      ) : (
        <Tabs defaultValue="manual" className="gap-5 px-4">
          {/* "Del banco" es una vía aparte, no una excepción escondida en el alta normal: ahí un
              cargo en cuenta conectada se duplicaría cuando llegue el correo. Acá se lee de la foto
              y se contrasta contra lo ya registrado antes de proponer nada. */}
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="manual">A mano</TabsTrigger>
            <TabsTrigger value="bank">Del banco</TabsTrigger>
          </TabsList>

          <TabsContent value="manual" className="flex flex-col gap-5">
            {manualForm}
          </TabsContent>

          <TabsContent value="bank" className="flex flex-col gap-5">
            {bankTab}
          </TabsContent>
        </Tabs>
      )}
    </ResponsiveModal>
  )
}
