"use client"

import * as React from "react"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { Camera } from "lucide-react"
import {
  ModalDangerRow,
  ModalSection,
  ResponsiveModal,
} from "@/components/ui/responsive-modal"
import { Button } from "@/components/ui/button"
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
import { BalanceScanPanel } from "./balance-scan-panel"
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
  const [disconnecting, setDisconnecting] = useState(false)
  const [disconnectError, setDisconnectError] = useState<string | null>(null)
  // "scan" reemplaza el contenido del modal en vez de abrir otro encima: un diálogo dentro de otro
  // en móvil deja al usuario sin saber qué cierra cada gesto.
  const [mode, setMode] = useState<"info" | "scan">("info")
  // Conectada = importada por un banco, cualquiera sea (ver account-card.tsx).
  const connected = !!account && account.provider !== "manual"
  const buckets = account?.buckets ?? []
  const cash = buckets.find((b) => b.kind === "cash")
  const overdraft = buckets.find((b) => b.kind === "overdraft")
  const nat = buckets.find((b) => b.kind === "credit_national")
  const intl = buckets.find((b) => b.kind === "credit_international")
  // Tarjeta de crédito: el "saldo" útil es el CUPO DISPONIBLE, no la deuda (account.balance negativo).
  const isCreditCupo = account?.accountType === "credit_card" && !!nat

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

  const scannable =
    account?.accountType === "checking" ||
    account?.accountType === "credit_card"

  return (
    <ResponsiveModal
      open={account !== null}
      onOpenChange={(open) => {
        if (!open) setMode("info") // al reabrir siempre parte en el detalle
        onOpenChange(open)
      }}
      title={mode === "scan" ? "Actualizar saldo" : "Detalle de la cuenta"}
    >
      {account && mode === "scan" && (
        <div className="flex flex-col gap-7 px-5 pb-6">
          <BalanceScanPanel
            account={account}
            onDone={() => onOpenChange(false)}
          />
          <Button
            variant="ghost"
            className="press h-11 text-body text-primary hover:bg-transparent hover:text-primary"
            onClick={() => setMode("info")}
          >
            Volver al detalle
          </Button>
        </div>
      )}

      {account && mode === "info" && (
        <div className="flex flex-col gap-8 px-5 pb-6">
          <AccountCard account={account} />

          <dl className="sheet-group flex flex-col px-4">
            <Row label="Banco" value={account.bankName} />
            <Row label="Nombre" value={account.name} />
            <Row
              label="Tipo"
              value={TYPE_LABEL[account.accountType] ?? account.accountType}
            />
            <Row label="Moneda" value={account.currency} />
            {isCreditCupo && nat ? (
              <>
                {/* Crédito: cupo disponible de total (el usado ya se ve en la tarjeta de arriba). */}
                <Row
                  label="Cupo nacional"
                  value={`${formatCLP(nat.available)} de ${formatCLP(nat.limit)}`}
                />
                {intl && (
                  <Row
                    label="Cupo internacional"
                    value={`${formatMoney(intl.available, "USD")} de ${formatMoney(intl.limit, "USD")}`}
                  />
                )}
              </>
            ) : !cash ? (
              <Row
                label={account.balance < 0 ? "Deuda" : "Saldo disponible"}
                value={formatMoney(
                  Math.abs(account.balance),
                  account.currency as CurrencyCode
                )}
              />
            ) : null}
            {cash && (
              <Row
                label="Caja disponible"
                value={formatMoney(
                  cash.available,
                  cash.currency as CurrencyCode
                )}
              />
            )}
            {overdraft && overdraft.used > 0 && (
              <Row
                label="Deuda de sobregiro"
                value={formatMoney(
                  overdraft.used,
                  overdraft.currency as CurrencyCode
                )}
              />
            )}
            {account.cardLast4 && (
              <Row label="Tarjeta" value={`•••• ${account.cardLast4}`} />
            )}
            <Row
              label="Origen"
              value={connected ? "Conectado al banco" : "Manual"}
            />
            {account.connectionMethod === "email" && (
              <Row
                label="Cobertura"
                value={`Saldo estimado desde ${account.buckets?.find((bucket) => bucket.asOf)?.asOf ? new Date(account.buckets.find((bucket) => bucket.asOf)!.asOf!).toLocaleString("es-CL") : "sin fecha"}`}
              />
            )}
          </dl>

          {scannable && (
            <ModalSection>
              <button
                type="button"
                onClick={() => setMode("scan")}
                className="press flex min-h-11 w-full items-center gap-3 px-4 py-2.5 text-left text-body text-primary"
              >
                <Camera className="size-5 shrink-0" />
                Actualizar saldo
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
                  className="text-center text-subheadline text-destructive"
                >
                  {disconnectError}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </ResponsiveModal>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-5 border-b border-border py-4 last:border-0">
      <dt className="text-subheadline text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right text-body font-medium break-words">
        {value}
      </dd>
    </div>
  )
}
