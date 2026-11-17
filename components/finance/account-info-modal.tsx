"use client"

import { cn } from "@/lib/utils"
import * as React from "react"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { FileCheck } from "lucide-react"
import {
  ModalDangerRow,
  ModalDataRow,
  ModalSection,
  modalActionRow,
  ResponsiveModal,
} from "@/components/ui/responsive-modal"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { AccountCard } from "./account-card"
import {
  ReconcileStatementModal,
  snapshotLabel,
} from "./reconciliation/reconcile-statement-modal"
import { formatCLP, formatMoney } from "@/lib/finance-format"
import type { CurrencyCode } from "@/arch/v1/domain/finance/money"
import type { AccountDTO } from "@/arch/v1/application/finance-use-cases/finance-read"

const TYPE_LABEL: Record<string, string> = {
  checking: "Cuenta corriente / débito",
  savings: "Ahorro",
  credit_card: "Tarjeta de crédito",
  credit_line: "Línea de crédito",
  wallet: "Billetera",
  investment: "Inversión",
}

// Detalle de una cuenta/banco. Para las conectadas ofrece "Desconectar", que elimina el banco,
// sus movimientos y las credenciales guardadas en Luca Plan.
export function AccountInfoModal({
  account,
  onOpenChange,
}: {
  account: AccountDTO | null
  onOpenChange: (o: boolean) => void
}) {
  const router = useRouter()
  const [reconciling, setReconciling] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [disconnectError, setDisconnectError] = useState<string | null>(null)
  // Conectada = importada por un banco, cualquiera sea (ver account-card.tsx).
  const connected = !!account && account.provider !== "manual"
  const buckets = account?.buckets ?? []
  const cash = buckets.find((b) => b.kind === "cash")
  const overdraft = buckets.find((b) => b.kind === "overdraft")
  const nat = buckets.find((b) => b.kind === "credit_national")
  const intl = buckets.find((b) => b.kind === "credit_international")
  // Tarjeta de crédito: el "saldo" útil es el CUPO DISPONIBLE, no la deuda (account.balance negativo).
  const isCreditCupo = account?.accountType === "credit_card" && !!nat
  // La conciliación existe solo para corriente y tarjeta conectadas.
  const canReconcile =
    connected &&
    (account?.accountType === "checking" ||
      account?.accountType === "credit_card")

  async function disconnect() {
    if (!account) return
    setDisconnecting(true)
    setDisconnectError(null)
    try {
      // El banco de ESTA cuenta: la conexión es multi-banco y multi-buzón, así que el endpoint
      // necesita saber cuál desconectar. Sin esto no borraba nada y respondía igual.
      const res = await fetch("/api/email-connection/disconnect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bankId: account.bankId }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        error?: string
      }
      if (!res.ok || data.ok !== true) {
        setDisconnectError(data.error ?? "No se pudo desconectar el banco")
        return
      }
      onOpenChange(false)
      router.refresh()
    } catch {
      setDisconnectError("No se pudo desconectar el banco")
    } finally {
      setDisconnecting(false)
    }
  }

  return (
    <ResponsiveModal
      open={account !== null}
      onOpenChange={onOpenChange}
      title="Detalle de la cuenta"
    >
      {account && (
        <div className="flex flex-col gap-6">
          <AccountCard account={account} />

          <dl className="sheet-group px-4 py-1">
            <ModalDataRow label="Banco" value={account.bankName} />
            <ModalDataRow label="Nombre" value={account.name} />
            <ModalDataRow
              label="Tipo"
              value={TYPE_LABEL[account.accountType] ?? account.accountType}
            />
            <ModalDataRow label="Moneda" value={account.currency} />
            {isCreditCupo && nat ? (
              <>
                {/* Crédito: cupo disponible de total (el usado ya se ve en la tarjeta de arriba). */}
                <ModalDataRow
                  label="Cupo nacional"
                  value={`${formatCLP(nat.available)} de ${formatCLP(nat.limit)}`}
                />
                {intl && (
                  <ModalDataRow
                    label="Cupo internacional"
                    value={`${formatMoney(intl.available, "USD")} de ${formatMoney(intl.limit, "USD")}`}
                  />
                )}
              </>
            ) : !cash ? (
              <ModalDataRow
                label={account.balance < 0 ? "Deuda" : "Saldo disponible"}
                value={formatMoney(
                  Math.abs(account.balance),
                  account.currency as CurrencyCode
                )}
              />
            ) : null}
            {cash && (
              <ModalDataRow
                label="Caja disponible"
                value={formatMoney(
                  cash.available,
                  cash.currency as CurrencyCode
                )}
              />
            )}
            {overdraft && overdraft.used > 0 && (
              <ModalDataRow
                label="Deuda de sobregiro"
                value={formatMoney(
                  overdraft.used,
                  overdraft.currency as CurrencyCode
                )}
              />
            )}
            {account.cardLast4 && (
              <ModalDataRow label="Tarjeta" value={`•••• ${account.cardLast4}`} />
            )}
            <ModalDataRow
              label="Origen"
              value={connected ? "Conectado al banco" : "Manual"}
            />
            {account.connectionMethod === "email" && (
              <ModalDataRow
                label="Cobertura"
                value={`Saldo estimado desde ${account.buckets?.find((bucket) => bucket.asOf)?.asOf ? new Date(account.buckets.find((bucket) => bucket.asOf)!.asOf!).toLocaleString("es-CL") : "sin fecha"}`}
              />
            )}
            {canReconcile && (
              <ModalDataRow
                label="Conciliada hasta"
                value={
                  account.reconciledUntil
                    ? snapshotLabel(account.reconciledUntil)
                    : "Sin conciliar"
                }
              />
            )}
          </dl>

          {canReconcile && (
            <ModalSection footer="Sube la cartola del banco: agrega lo que falta, corrige lo que difiere y anula las retenciones.">
              <button
                type="button"
                onClick={() => setReconciling(true)}
                className={cn(modalActionRow, "font-semibold text-primary")}
              >
                <FileCheck aria-hidden className="size-5 shrink-0" />
                Conciliar cartola
              </button>
            </ModalSection>
          )}

          {connected && (
            <div className="flex flex-col gap-1.5">
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <ModalDangerRow disabled={disconnecting}>
                    {disconnecting ? "Desconectando…" : "Desconectar banco"}
                  </ModalDangerRow>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      ¿Desconectar {account.bankName}?
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      Se elimina la conexión y sus credenciales, y se borran sus
                      cuentas y todos sus movimientos de Luca Plan. No se puede
                      deshacer.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction
                      variant="destructive"
                      onClick={disconnect}
                    >
                      Desconectar
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              {disconnectError && (
                <p
                  role="alert"
                  className="text-center text-callout text-destructive"
                >
                  {disconnectError}
                </p>
              )}
            </div>
          )}
        </div>
      )}
      {account && (
        <ReconcileStatementModal
          accountId={account.id}
          open={reconciling}
          onOpenChange={setReconciling}
        />
      )}
    </ResponsiveModal>
  )
}

