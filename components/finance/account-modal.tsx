"use client"

import { useId } from "react"
import { useForm, Controller, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useRouter } from "next/navigation"
import { ModalFooter, ResponsiveModal } from "@/components/ui/responsive-modal"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  accountSchema,
  type AccountFormValues,
} from "@/lib/finance-form-schemas"
import {
  FinanceField,
  MoneyFormInput,
  financeResponseError,
} from "./finance-form-field"

const BANKS = [
  "Mercado Pago",
  "Tenpo",
  "MACH",
  "Racional",
  "Hapi",
  "Banco Falabella",
  "Banco Ripley",
  "Coopeuch",
  "Efectivo",
]
const DEFAULTS: AccountFormValues = {
  bankName: BANKS[0],
  name: "",
  accountType: "checking",
  currency: "CLP",
  balance: 0,
  color: "#1e3a8a",
  cardLast4: null,
}
export function AccountModal({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const formId = `account-${useId()}`
  const form = useForm({
    resolver: zodResolver(accountSchema),
    defaultValues: DEFAULTS,
  })
  const currency = useWatch({ control: form.control, name: "currency" })
  const { errors, isSubmitting } = form.formState
  async function save(values: AccountFormValues) {
    form.clearErrors("root")
    try {
      const res = await fetch("/api/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...values,
          bankName: values.bankName.trim(),
          name: values.name.trim(),
        }),
      })
      if (!res.ok)
        throw new Error(
          await financeResponseError(
            res,
            "No se pudo crear la cuenta. Vuelve a intentarlo."
          )
        )
      form.reset()
      onOpenChange(false)
      router.refresh()
    } catch (error) {
      form.setError("root", {
        message:
          error instanceof Error
            ? error.message
            : "No se pudo crear la cuenta.",
      })
    }
  }
  return (
    <ResponsiveModal
      open={open}
      onOpenChange={(next) => {
        if (!next) form.reset()
        onOpenChange(next)
      }}
      title="Nueva cuenta manual"
    >
      <form
        id={formId}
        onSubmit={form.handleSubmit(save)}
        className="flex flex-col gap-7 px-5"
      >
        <fieldset disabled={isSubmitting} className="contents">
          <p className="text-sm leading-relaxed text-muted-foreground">
            Para cuentas sin conexión automática. Si tu banco se conecta por
            correo, usa “Conectar banco”.
          </p>
          {errors.root && (
            <p role="alert" className="text-sm text-destructive">
              {errors.root.message}
            </p>
          )}
          <FinanceField
            id={`${formId}-bank`}
            label="Banco o medio"
            required
            error={errors.bankName?.message}
          >
            <Controller
              name="bankName"
              control={form.control}
              render={({ field }) => (
                <Select
                  required
                  value={field.value}
                  onValueChange={field.onChange}
                >
                  <SelectTrigger
                    id={`${formId}-bank`}
                    className="h-12! w-full text-base"
                    aria-invalid={!!errors.bankName}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-popover">
                    {BANKS.map((bank) => (
                      <SelectItem key={bank} value={bank}>
                        {bank}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </FinanceField>
          <FinanceField
            id={`${formId}-name`}
            label="Nombre de la cuenta"
            required
            error={errors.name?.message}
          >
            <Input
              id={`${formId}-name`}
              {...form.register("name")}
              required
              inputMode="text"
              placeholder="Ej. Débito CLP"
              className="h-12 text-base"
              aria-invalid={!!errors.name}
              aria-describedby={
                errors.name ? `${formId}-name-error` : undefined
              }
            />
          </FinanceField>
          <div className="grid gap-7 sm:grid-cols-2">
            <FinanceField
              id={`${formId}-type`}
              label="Tipo"
              required
              error={errors.accountType?.message}
            >
              <Controller
                name="accountType"
                control={form.control}
                render={({ field }) => (
                  <Select
                    required
                    value={field.value}
                    onValueChange={field.onChange}
                  >
                    <SelectTrigger
                      id={`${formId}-type`}
                      className="h-12! w-full text-base"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-popover">
                      <SelectItem value="checking">
                        Tarjeta de débito
                      </SelectItem>
                      <SelectItem value="credit_card">
                        Tarjeta de crédito
                      </SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </FinanceField>
            <FinanceField
              id={`${formId}-currency`}
              label="Moneda"
              required
              error={errors.currency?.message}
            >
              <Controller
                name="currency"
                control={form.control}
                render={({ field }) => (
                  <Select
                    required
                    value={field.value}
                    onValueChange={field.onChange}
                  >
                    <SelectTrigger
                      id={`${formId}-currency`}
                      className="h-12! w-full text-base"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-popover">
                      <SelectItem value="CLP">CLP · Peso chileno</SelectItem>
                      <SelectItem value="USD">USD · Dólar</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </FinanceField>
          </div>
          <FinanceField
            id={`${formId}-digits`}
            label="Últimos 4 dígitos"
            required
            error={errors.cardLast4?.message}
          >
            <Controller
              name="cardLast4"
              control={form.control}
              render={({ field }) => (
                <Input
                  id={`${formId}-digits`}
                  name={field.name}
                  ref={field.ref}
                  value={field.value ?? ""}
                  required
                  inputMode="numeric"
                  maxLength={4}
                  onChange={(event) =>
                    field.onChange(
                      event.target.value.replace(/\D/g, "").slice(0, 4) || null
                    )
                  }
                  onBlur={field.onBlur}
                  className="tabular h-12 text-base"
                  placeholder="8821"
                  aria-invalid={!!errors.cardLast4}
                  aria-describedby={
                    errors.cardLast4 ? `${formId}-digits-error` : undefined
                  }
                />
              )}
            />
          </FinanceField>
          <FinanceField
            id={`${formId}-balance`}
            label={`Saldo inicial (${currency})`}
            error={errors.balance?.message}
            hint="Usa el saldo en la moneda de esta cuenta. El crédito se muestra separado de tu dinero disponible."
          >
            <Controller
              name="balance"
              control={form.control}
              render={({ field }) => (
                <MoneyFormInput
                  allowNegative
                  id={`${formId}-balance`}
                  name={field.name}
                  ref={field.ref}
                  value={field.value}
                  currency={currency}
                  onValueChange={field.onChange}
                  onBlur={field.onBlur}
                  placeholder="0"
                  aria-invalid={!!errors.balance}
                  aria-describedby={`${formId}-balance-${errors.balance ? "error" : "hint"}`}
                />
              )}
            />
          </FinanceField>
          <FinanceField
            id={`${formId}-color`}
            label="Color de la cuenta"
            error={errors.color?.message}
          >
            <Controller
              name="color"
              control={form.control}
              render={({ field }) => (
                <input
                  id={`${formId}-color`}
                  type="color"
                  name={field.name}
                  ref={field.ref}
                  value={field.value ?? "#1e3a8a"}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  className="h-12 w-full rounded-lg border border-input bg-background"
                />
              )}
            />
          </FinanceField>
        </fieldset>
      </form>
      <ModalFooter className="px-5">
        <Button
          type="button"
          variant="outline"
          className="h-12"
          disabled={isSubmitting}
          onClick={() => {
            form.reset()
            onOpenChange(false)
          }}
        >
          Cancelar
        </Button>
        <Button
          type="submit"
          form={formId}
          disabled={isSubmitting}
          className="h-12 flex-1 text-base"
        >
          {isSubmitting ? "Guardando…" : "Crear cuenta"}
        </Button>
      </ModalFooter>
    </ResponsiveModal>
  )
}
