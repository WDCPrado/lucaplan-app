"use client"

import type { ReactNode, ComponentProps } from "react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { groupByCurrency } from "@/lib/finance-format"
import {
  CURRENCY_DECIMALS,
  type CurrencyCode,
} from "@/arch/v1/domain/finance/money"

export function FinanceField({
  id,
  label,
  error,
  hint,
  required,
  children,
}: {
  id: string
  label: string
  error?: string
  hint?: ReactNode
  required?: boolean
  children: ReactNode
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="text-sm font-medium">
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </Label>
      {children}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {hint && (
        <p
          id={`${id}-hint`}
          className="text-sm leading-relaxed text-muted-foreground"
        >
          {hint}
        </p>
      )}
    </div>
  )
}

export function MoneyFormInput({
  value,
  onValueChange,
  currency = "CLP",
  allowNegative = false,
  ...props
}: Omit<ComponentProps<typeof Input>, "value" | "onChange"> & {
  value: number
  onValueChange: (value: number) => void
  currency?: CurrencyCode
  allowNegative?: boolean
}) {
  const scale = 10 ** CURRENCY_DECIMALS[currency]
  return (
    <Input
      {...props}
      inputMode="numeric"
      maxLength={22}
      value={
        Object.is(value, -0)
          ? "-"
          : value === 0
            ? ""
            : groupByCurrency(value, currency)
      }
      onChange={(event) =>
        onValueChange(
          ((allowNegative && event.target.value.trim().startsWith("-")
            ? -1
            : 1) *
            Number(event.target.value.replace(/\D/g, "").slice(0, 15) || "0")) /
            scale
        )
      }
      className={`tabular h-12 text-base ${props.className ?? ""}`}
    />
  )
}

export async function financeResponseError(
  response: Response,
  fallback: string
) {
  const body = await response.json().catch(() => null)
  return typeof body?.error === "string" ? body.error : fallback
}
