"use client"

import { ResponsiveModal } from "@/components/ui/responsive-modal"
import { formatCLP } from "@/lib/finance-format"
import type { AccountDTO } from "@/arch/v1/application/finance-use-cases/finance-read"

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
      <div className="flex flex-col gap-5 px-5 pb-6">
        <div className="space-y-1">
          <p className="text-subheadline text-muted-foreground">Posición neta registrada</p>
          <p className={`tabular text-title-1 font-bold ${net < 0 ? "text-destructive" : ""}`}>{formatCLP(net)}</p>
          <p className="text-footnote text-muted-foreground">Saldo de caja menos deuda de sobregiro. No incluye cupos de tarjetas como dinero disponible.</p>
        </div>
        <dl className="sheet-group inset-list px-4">
          <div className="flex min-h-11 items-center justify-between gap-3 py-3 text-body"><dt>Caja registrada</dt><dd className="tabular font-medium">{formatCLP(cash)}</dd></div>
          <div className="flex min-h-11 items-center justify-between gap-3 py-3 text-body"><dt>Sobregiro utilizado</dt><dd className="tabular font-medium">{formatCLP(overdraftDebt)}</dd></div>
        </dl>
        <div className="space-y-2">
          <h3 className="text-subheadline font-semibold">Cuentas y líneas</h3>
          <div className="sheet-group inset-list px-4">
            {accounts.filter((account) => account.accountType !== "credit_card").map((account) => {
              const cashBucket = account.buckets?.find((bucket) => bucket.kind === "cash")
              const overdraft = account.buckets?.find((bucket) => bucket.kind === "overdraft")
              const balance = cashBucket?.available ?? account.balance
              return (
                <div key={account.id} className="flex flex-col gap-1 py-3 text-body">
                  <div className="flex items-center justify-between gap-3"><span className="min-w-0 truncate">{account.name}</span><span className={`tabular shrink-0 font-medium ${balance < 0 ? "text-destructive" : ""}`}>{account.currency === "CLP" ? formatCLP(balance) : `${balance.toFixed(2)} ${account.currency}`}</span></div>
                  {overdraft && <p className="text-footnote text-muted-foreground">Línea utilizada: {formatCLP(overdraft.used)} · Disponible: {formatCLP(overdraft.available)}</p>}
                </div>
              )
            })}
          </div>
        </div>
        <p className="text-footnote text-muted-foreground">Los valores corresponden al último saldo registrado en Luca Plan y pueden diferir del banco si aún no se concilian.</p>
      </div>
    </ResponsiveModal>
  )
}
