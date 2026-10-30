"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Landmark, Plus } from "lucide-react"
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

// Conectar el correo del banco. Sin cuentas conectadas es un tile del tamaño de una cuenta en el
// carrusel (`tile`); con alguna ya conectada, una fila de texto al pie de la sección (`row`).
export function SyncBancoChileButton({
  variant = "tile",
  accounts = [],
  outlookResult,
  outlookReason,
}: {
  variant?: "tile" | "row"
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
      {variant === "row" ? (
        <button
          type="button"
          onClick={openModal}
          className="press flex min-h-11 items-center gap-1 text-body text-primary"
        >
          <Plus className="size-4" />
          Conectar correo del banco
        </button>
      ) : (
        <button
          type="button"
          onClick={openModal}
          data-card
          className="press flex min-h-40 w-72 shrink-0 snap-center snap-always flex-col items-center justify-center gap-2 rounded-xl bg-card text-primary hover:bg-accent lg:w-auto lg:snap-start"
        >
          <Landmark className="size-6" />
          <span className="text-body font-medium">Conectar correo del banco</span>
          <span className="px-4 text-center text-footnote text-muted-foreground">
            Trae cuentas y movimientos
          </span>
        </button>
      )}

      <ResponsiveModal
        open={open}
        onOpenChange={setOpen}
        dismissible={!locked}
        title="Conectar banco"
      >
        <div className="flex flex-col gap-6 px-5 pb-6">
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
            <span className="text-footnote font-medium text-muted-foreground">
              Próximamente
            </span>
            {COMING_SOON.map((name) => (
              <div
                key={name}
                className="flex h-12 cursor-not-allowed items-center gap-3 rounded-lg border border-border px-4 text-left opacity-50"
              >
                <Landmark className="size-5 shrink-0 text-muted-foreground" />
                <span className="font-medium">{name}</span>
                <span className="ml-auto text-footnote text-muted-foreground">
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
