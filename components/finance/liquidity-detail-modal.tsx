"use client"

import { ResponsiveModal } from "@/components/ui/responsive-modal"
import { formatCLP } from "@/lib/finance-format"
import { cn } from "@/lib/utils"
import type { AccountDTO } from "@/arch/v1/application/finance-use-cases/finance-read"

// Fila de datos etiqueta → valor (grupo de tono de la hoja).
const row = "flex min-h-11 items-center justify-between gap-4 py-2"

export function LiquidityDetailModal({
  open,
  onOpenChange,
  accounts,
  cash,
  overdraftDebt,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  accounts: AccountDTO[]
  cash: number
  overdraftDebt: number
}) {
  const net = cash - overdraftDebt
  return (
    <ResponsiveModal open={open} onOpenChange={onOpenChange} title="Detalle de cuentas">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <p className="text-callout text-ink-2">Posición neta registrada</p>
          <p className={cn("text-title font-semibold whitespace-nowrap", net < 0 && "text-destructive")}>
            {formatCLP(net)}
          </p>
          <p className="mt-2 rounded-lg bg-secondary px-4 py-3 text-callout text-ink-2">
            Saldo de caja menos deuda de sobregiro. No incluye cupos de tarjetas como dinero disponible.
          </p>
        </div>
        <dl className="rounded-lg bg-secondary px-4 py-1">
          <div className={row}>
            <dt className="text-callout text-ink-2">Caja registrada</dt>
            <dd className="font-semibold whitespace-nowrap">{formatCLP(cash)}</dd>
          </div>
          <div className={row}>
            <dt className="text-callout text-ink-2">Sobregiro utilizado</dt>
            <dd className="font-semibold whitespace-nowrap">{formatCLP(overdraftDebt)}</dd>
          </div>
        </dl>
        <section className="flex flex-col gap-2">
          <h3 className="text-callout font-semibold text-ink-2">Cuentas y líneas</h3>
          <dl className="rounded-lg bg-secondary px-4 py-1">
            {accounts.filter((account) => account.accountType !== "credit_card").map((account) => {
              const cashBucket = account.buckets?.find((bucket) => bucket.kind === "cash")
              const overdraft = account.buckets?.find((bucket) => bucket.kind === "overdraft")
              const balance = cashBucket?.available ?? account.balance
              return (
                <div key={account.id} className={cn(row, "items-start")}>
                  <dt className="min-w-0 truncate text-callout text-ink-2">{account.name}</dt>
                  <dd className="flex shrink-0 flex-col items-end text-right">
                    <span className={cn("font-semibold whitespace-nowrap", balance < 0 && "text-destructive")}>
                      {account.currency === "CLP" ? formatCLP(balance) : `${balance.toFixed(2)} ${account.currency}`}
                    </span>
                    {overdraft && (
                      <span className="text-caption text-ink-3">
                        Línea utilizada {formatCLP(overdraft.used)} · disponible {formatCLP(overdraft.available)}
                      </span>
                    )}
                  </dd>
                </div>
              )
            })}
          </dl>
        </section>
        <p className="text-caption text-ink-3">Los valores corresponden al último saldo registrado en Luca Plan y pueden diferir del banco si aún no se concilian.</p>
      </div>
    </ResponsiveModal>
  )
}
