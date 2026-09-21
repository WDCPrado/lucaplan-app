"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Landmark } from "lucide-react"
import { toast } from "sonner"
import { ResponsiveModal } from "@/components/ui/responsive-modal"
import type { AccountDTO } from "@/arch/v1/application/finance-use-cases/finance-read"
import {
  OutlookBankConnection,
  type OutlookStatus,
} from "./outlook-bank-connection"

// Bancos aún no soportados (se muestran como "Próximamente" abajo). Los soportados los ofrece
// OutlookBankConnection desde el catálogo del servidor, junto al correo donde se conectan.
const COMING_SOON = [
  "Santander",
  "BCI",
  "Banco Estado",
  "Itaú",
  "Banco Falabella",
  "Scotiabank",
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
  const [outlookStatus, setOutlookStatus] = useState<OutlookStatus | null>(null)
  const [locked, setLocked] = useState(false) // importación inicial en curso: no cerrar el modal
  const callbackHandled = useRef(false)

  async function openModal() {
    setOpen(true)
    try {
      const res = await fetch("/api/email-connection/status", {
        cache: "no-store",
      })
      setOutlookStatus(await res.json())
    } catch {
      setOutlookStatus({
        providers: [],
        mailboxes: [],
        availableBanks: [],
      })
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
        className="flex min-h-40 w-72 shrink-0 snap-center snap-always flex-col items-center justify-center gap-2 rounded-xl border-2 border-primary/40 bg-primary/5 text-primary transition-colors hover:bg-primary/10 lg:w-auto lg:snap-start"
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
        dismissible={!locked}
        title="Conectar banco"
        className="sm:max-w-2xl"
      >
        <div className="flex flex-col gap-5 px-4 pb-6">
          <OutlookBankConnection
            status={outlookStatus}
            accounts={accounts.filter(
              (account) => account.connectionMethod === "email"
            )}
            onReload={reloadOutlook}
            onImportingChange={setLocked}
          />

          {/* Otros bancos, aún no soportados */}
          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              Próximamente
            </span>
            {COMING_SOON.map((name) => (
              <div
                key={name}
                className="flex h-12 cursor-not-allowed items-center gap-3 rounded-lg border border-border px-4 text-left opacity-50"
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
