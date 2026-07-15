"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Landmark } from "lucide-react"
import { toast } from "sonner"
import { ResponsiveModal } from "@/components/ui/responsive-modal"
import { cn } from "@/lib/utils"
import type { AccountDTO } from "@/arch/v1/application/finance-use-cases/finance-read"
import {
  OutlookBankConnection,
  type OutlookStatus,
} from "./outlook-bank-connection"

// Método único de conexión: notificaciones de correo vía Outlook.
const BANKS: { id: string; name: string; available: boolean }[] = [
  { id: "bancochile", name: "Banco de Chile", available: true },
]

// Otros bancos aún no soportados (se muestran como "Próximamente" abajo).
const COMING_SOON = [
  "Santander",
  "BCI",
  "Banco Estado",
  "Itaú",
  "Banco Falabella",
  "Scotiabank",
  "BICE",
]

export function SyncBancoChileButton({
  accounts = [],
  outlookResult,
  outlookReason,
}: {
  accounts?: AccountDTO[]
  outlookResult?: string | null
  outlookReason?: string | null
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState("bancochile")
  const [outlookStatus, setOutlookStatus] = useState<OutlookStatus | null>(null)
  const callbackHandled = useRef(false)

  async function openModal() {
    setOpen(true)
    try {
      const res = await fetch("/api/email-connection/status", {
        cache: "no-store",
      })
      setOutlookStatus(await res.json())
    } catch {
      setOutlookStatus({ configured: false, activeMethod: null, connection: null })
    }
  }

  // El callback OAuth es un sistema externo a React: al volver, abre una sola vez el paso correcto
  // y limpia los parámetros para que un refresh posterior no reabra el modal.
  useEffect(() => {
    if (!outlookResult || callbackHandled.current) return
    callbackHandled.current = true
    void openModal()
    if (outlookResult === "error")
      toast.error(
        `No se pudo conectar Outlook${outlookReason ? ` (${outlookReason})` : ""}`
      )
    router.replace("/dashboard", { scroll: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- evento único del callback OAuth
  }, [outlookResult, outlookReason])

  async function reloadOutlook() {
    const res = await fetch("/api/email-connection/status", {
      cache: "no-store",
    })
    if (res.ok) setOutlookStatus(await res.json())
    router.refresh()
  }

  return (
    <>
      <button
        onClick={openModal}
        data-card
        className="flex min-h-40 w-72 shrink-0 snap-center snap-always flex-col items-center justify-center gap-2 rounded-2xl border-2 border-primary/40 bg-primary/5 text-primary transition-colors hover:bg-primary/10 lg:snap-start"
      >
        <Landmark className="size-6" />
        <span className="text-sm font-medium">Conectar banco</span>
        <span className="px-4 text-center text-xs text-muted-foreground">
          Trae cuentas y movimientos
        </span>
      </button>

      <ResponsiveModal
        open={open}
        onOpenChange={setOpen}
        title="Conectar banco"
        className="sm:max-w-2xl"
      >
        <div className="flex flex-col gap-5 px-4 pb-6">
          {/* Selección de banco */}
          <div className="flex flex-col gap-2">
            {BANKS.map((b) => (
              <button
                key={b.id}
                type="button"
                disabled={!b.available}
                onClick={() => setSelected(b.id)}
                className={cn(
                  "flex h-14 items-center gap-3 rounded-xl border px-4 text-left transition-colors",
                  selected === b.id
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border text-foreground",
                  !b.available && "opacity-60"
                )}
              >
                <Landmark className="size-5 shrink-0 text-primary" />
                <span className="font-medium">{b.name}</span>
                {!b.available && (
                  <span className="ml-auto text-xs text-muted-foreground">
                    Próximamente
                  </span>
                )}
              </button>
            ))}
          </div>

          <OutlookBankConnection
            status={outlookStatus}
            accounts={accounts.filter(
              (account) => account.connectionMethod === "email"
            )}
            onReload={reloadOutlook}
          />

          {/* Otros bancos, aún no soportados */}
          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              Próximamente
            </span>
            {COMING_SOON.map((name) => (
              <div
                key={name}
                className="flex h-12 cursor-not-allowed items-center gap-3 rounded-xl border border-border px-4 text-left opacity-50"
              >
                <Landmark className="size-5 shrink-0 text-muted-foreground" />
                <span className="font-medium">{name}</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  Próximamente
                </span>
              </div>
            ))}
          </div>
        </div>
      </ResponsiveModal>
    </>
  )
}
