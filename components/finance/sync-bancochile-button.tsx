"use client"

import { Button } from "glisse"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Landmark, Plus } from "lucide-react"
import { toast } from "sonner"
import { ResponsiveModal } from "@/components/ui/responsive-modal"
import {
  OutlookBankConnection,
  type OutlookStatus,
} from "./outlook-bank-connection"

// Conectar el correo del banco. Sin cuentas conectadas es un tile del tamaño de una cuenta en el
// carrusel (`tile`); con alguna ya conectada, una fila de texto al pie de la sección (`row`).
export function SyncBancoChileButton({
  variant = "tile",
  outlookResult,
  outlookReason,
}: {
  variant?: "tile" | "row"
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
        <Button
          type="button"
          onClick={openModal}
          className="press flex min-h-11 items-center gap-1 text-body text-primary"
        >
          <Plus className="size-4" />
          Conectar banco
        </Button>
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
        {/* Los bancos que aún no se pueden conectar los nombra OutlookBankConnection al pie de su
            lista de bancos, junto a los que sí. */}
        <div className="px-5 pt-2 pb-6">
          <OutlookBankConnection
            status={outlookStatus}
            onReload={reloadOutlook}
            onImportingChange={setLocked}
          />
        </div>
      </ResponsiveModal>
    </>
  )
}
