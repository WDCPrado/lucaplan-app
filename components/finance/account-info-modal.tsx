"use client"

import * as React from "react"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { Camera, Unlink } from "lucide-react"
import { ResponsiveModal } from "@/components/ui/responsive-modal"
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
  // "scan" reemplaza el contenido del modal en vez de abrir otro encima: un diálogo dentro de otro
  // en móvil deja al usuario sin saber qué cierra cada gesto.
  const [mode, setMode] = useState<"info" | "scan">("info")
  // Conectada = importada por un banco, cualquiera sea (ver account-card.tsx).
  const connected = !!account && account.provider !== "manual"
  const buckets = account?.buckets ?? []
  const nat = buckets.find((b) => b.kind === "credit_national")
  const intl = buckets.find((b) => b.kind === "credit_international")
  // Tarjeta de crédito: el "saldo" útil es el CUPO DISPONIBLE, no la deuda (account.balance negativo).
  const isCreditCupo = account?.accountType === "credit_card" && !!nat

  async function disconnect() {
    if (!account) return
    setDisconnecting(true)
    const res = await fetch("/api/email-connection/disconnect", {
      method: "POST",
    })
    setDisconnecting(false)
    if (res.ok) {
      onOpenChange(false)
      router.refresh()
    }
  }

  const scannable =
    account?.accountType === "checking" || account?.accountType === "credit_card"

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
        <div className="flex flex-col gap-4 px-4 pb-6">
          <BalanceScanPanel account={account} onDone={() => onOpenChange(false)} />
          <Button variant="ghost" onClick={() => setMode("info")}>
            Volver al detalle
          </Button>
        </div>
      )}

      {account && mode === "info" && (
        <div className="flex flex-col gap-5 px-4 pb-6">
          <AccountCard account={account} />

          <dl className="flex flex-col">
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
            ) : (
              <Row label="Saldo" value={formatCLP(account.balance)} />
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
            <Button
              variant="outline"
              onClick={() => setMode("scan")}
              className="h-12 rounded-full"
            >
              <Camera className="size-4" />
              Actualizar saldo
            </Button>
          )}

          {connected && (
            <div className="flex flex-col gap-1.5">
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="outline"
                    disabled={disconnecting}
                    className="h-12 rounded-full text-destructive hover:text-destructive"
                  >
                    <Unlink className="size-4" />
                    {disconnecting ? "Desconectando…" : "Desconectar banco"}
                  </Button>
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
              <p className="text-center text-xs text-muted-foreground">
                Elimina la conexión, sus credenciales y todos sus datos de Luca
                Plan.
              </p>
            </div>
          )}
        </div>
      )}
    </ResponsiveModal>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/50 py-3 last:border-0">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-right text-sm font-medium">{value}</dd>
    </div>
  )
}
