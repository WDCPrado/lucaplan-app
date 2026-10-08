"use client"

import { useState } from "react"
import { Controller, useForm, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import {
  transactionSchema,
  type TransactionFormValues,
} from "@/lib/finance-form-schemas"
import { FinanceField, MoneyFormInput } from "./finance-form-field"
import { useRouter } from "next/navigation"
import { Check, CreditCard, Landmark } from "lucide-react"
import { ModalFooter, ResponsiveModal } from "@/components/ui/responsive-modal"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { MovementScanPanel } from "./movement-scan-panel"
import { cn } from "@/lib/utils"
import { haptic } from "@/lib/haptics"
import { CategoryIcon } from "./category-icons"
import {
  Chip,
  DatePicker,
  DirectionToggle,
  toISODate,
} from "./transaction-modal"
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

  const [channel, setChannel] = useState("manual")
  const [scanAccountId, setScanAccountId] = useState(bankAccounts[0]?.id ?? "")
  const scanAccount =
    bankAccounts.find((a) => a.id === scanAccountId) ?? bankAccounts[0]
  const manualForm = (
    <ManualTransactionForm
      accounts={manualAccounts}
      categories={categories}
      onClose={() => onOpenChange(false)}
    />
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
                "flex items-center gap-3 rounded-lg border p-3 text-left transition-colors",
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
            Agrega una cuenta para registrar tu primer movimiento.
          </p>
          <Button onClick={onCreateAccount} className="h-12">
            Agregar cuenta
          </Button>
        </div>
      ) : bankAccounts.length === 0 ? (
        // Sin cuentas conectadas no hay nada que leer de una cartola: la pestaña sobraría.
        <div className="flex flex-col gap-8 px-5">{manualForm}</div>
      ) : manualAccounts.length === 0 ? (
        <div className="flex flex-col gap-8 px-5">{bankTab}</div>
      ) : (
        <Tabs value={channel} onValueChange={setChannel} className="gap-8 px-5">
          {/* "Del banco" es una vía aparte, no una excepción escondida en el alta normal: ahí un
              cargo en cuenta conectada se duplicaría cuando llegue el correo. Acá se lee de la foto
              y se contrasta contra lo ya registrado antes de proponer nada. */}
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="manual">Manual</TabsTrigger>
            <TabsTrigger value="bank">Del banco</TabsTrigger>
          </TabsList>

          <TabsContent
            value="manual"
            forceMount
            hidden={channel !== "manual"}
            className={cn(
              "flex-col gap-8",
              channel === "manual" ? "flex" : "hidden"
            )}
          >
            {manualForm}
          </TabsContent>

          <TabsContent value="bank" className="flex flex-col gap-8">
            {bankTab}
          </TabsContent>
        </Tabs>
      )}
    </ResponsiveModal>
  )
}

function ManualTransactionForm({
  accounts,
  categories,
  onClose,
}: {
  accounts: AccountDTO[]
  categories: CategoryDTO[]
  onClose: () => void
}) {
  const router = useRouter()
  const [apiError, setApiError] = useState<string | null>(null)
  const form = useForm<TransactionFormValues>({
    resolver: zodResolver(transactionSchema),
    defaultValues: {
      description: "",
      accountId: accounts[0]?.id ?? "",
      currency: (accounts[0]?.currency as CurrencyCode) ?? "CLP",
      direction: accounts[0]?.provider !== "manual" ? "credit" : "debit",
      categoryId: null,
      amount: 0,
      date: toISODate(new Date()),
    },
  })
  const [accountId, direction, categoryId, currency] = useWatch({
    control: form.control,
    name: ["accountId", "direction", "categoryId", "currency"],
  })
  const account = accounts.find((a) => a.id === accountId) ?? accounts[0]
  const connected = !!account && account.provider !== "manual"
  const income = direction === "credit"
  const visibleCategories = categories.filter(
    (c) => c.type === (income ? "income" : "expense")
  )
  const saving = form.formState.isSubmitting
  function chooseDirection(direction: "debit" | "credit") {
    form.setValue("direction", direction, { shouldDirty: true })
    if (
      categories.find((c) => c.id === categoryId)?.type !==
      (direction === "credit" ? "income" : "expense")
    )
      form.setValue("categoryId", null, { shouldDirty: true })
  }
  async function save(input: TransactionFormValues) {
    if (!account) return
    setApiError(null)
    try {
      const res = await fetch("/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...input,
          description: input.description || (income ? "Ingreso" : "Gasto"),
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(
          data.error ??
            "No se pudo registrar el movimiento. Inténtalo otra vez."
        )
      }
      haptic("success")
      form.reset()
      onClose()
      router.refresh()
    } catch (error) {
      haptic("error")
      setApiError(
        error instanceof Error
          ? error.message
          : "No se pudo registrar el movimiento. Inténtalo otra vez."
      )
    }
  }
  return (
    <form
      id="new-manual-transaction"
      onSubmit={form.handleSubmit(save)}
      className="flex flex-col gap-6"
      noValidate
    >
      {apiError && (
        <p
          role="alert"
          className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive"
        >
          {apiError}
        </p>
      )}
      <FinanceField
        id="new-transaction-description"
        label="Descripción"
        error={form.formState.errors.description?.message}
      >
        <Input
          id="new-transaction-description"
          {...form.register("description")}
          inputMode="text"
          placeholder={income ? "Ej. Sueldo" : "Ej. Compra supermercado"}
          className="h-12 text-base"
        />
      </FinanceField>
      <div className="flex flex-col gap-3">
        <span className="text-sm font-medium">Tipo de movimiento</span>
        <DirectionToggle
          value={direction}
          onChange={chooseDirection}
          disabled={connected || saving}
        />
        {connected && (
          <p className="text-sm text-muted-foreground">
            En esta cuenta conectada puedes registrar abonos. Los cargos llegan
            desde el correo del banco; si falta uno, usa Del banco.
          </p>
        )}
      </div>
      <Controller
        name="amount"
        control={form.control}
        render={({ field, fieldState }) => (
          <FinanceField
            id="new-transaction-amount"
            label={`Monto (${currency})`}
            error={fieldState.error?.message}
            required
          >
            <MoneyFormInput
              id="new-transaction-amount"
              value={field.value}
              onValueChange={field.onChange}
              currency={currency}
              aria-invalid={!!fieldState.error}
              aria-describedby={
                fieldState.error ? "new-transaction-amount-error" : undefined
              }
              required
            />
          </FinanceField>
        )}
      />
      <Controller
        name="date"
        control={form.control}
        render={({ field, fieldState }) => (
          <FinanceField
            id="new-transaction-date"
            label="Fecha"
            error={fieldState.error?.message}
            required
          >
            <DatePicker
              id="new-transaction-date"
              value={field.value}
              onChange={field.onChange}
              invalid={!!fieldState.error}
              describedBy={
                fieldState.error ? "new-transaction-date-error" : undefined
              }
            />
          </FinanceField>
        )}
      />
      <div className="flex flex-col gap-3">
        <span className="text-sm font-medium">Cuenta</span>
        <div className="-mx-5 flex scrollbar-none gap-2 overflow-x-auto px-5 pb-1">
          {accounts.map((a) => (
            <Chip
              key={a.id}
              active={a.id === account?.id}
              disabled={saving}
              onClick={() => {
                form.setValue("accountId", a.id, { shouldDirty: true })
                form.setValue("currency", a.currency as CurrencyCode, {
                  shouldDirty: true,
                })
                if (a.provider !== "manual") chooseDirection("credit")
              }}
            >
              {a.bankName} · {a.name}
              {a.cardLast4 ? ` ···· ${a.cardLast4}` : ""}
            </Chip>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-3">
        <span className="text-sm font-medium">Categoría</span>
        <div className="-mx-5 flex scrollbar-none gap-2 overflow-x-auto px-5 pb-1">
          {visibleCategories.map((c) => (
            <Chip
              key={c.id}
              active={c.id === categoryId}
              disabled={saving}
              onClick={() =>
                form.setValue("categoryId", c.id === categoryId ? null : c.id, {
                  shouldDirty: true,
                })
              }
            >
              <CategoryIcon icon={c.icon} size={16} />
              {c.name}
            </Chip>
          ))}
        </div>
        {visibleCategories.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Sin categorías de {income ? "ingreso" : "gasto"}. Puedes
            clasificarlo después.
          </p>
        )}
      </div>
      <ModalFooter>
        <Button
          type="button"
          variant="outline"
          onClick={onClose}
          disabled={saving}
          className="h-12 flex-1"
        >
          Cancelar
        </Button>
        <Button
          type="submit"
          form="new-manual-transaction"
          disabled={!account || saving}
          className="h-12 flex-1 text-base"
        >
          {saving ? "Guardando…" : "Guardar movimiento"}
        </Button>
      </ModalFooter>
    </form>
  )
}
