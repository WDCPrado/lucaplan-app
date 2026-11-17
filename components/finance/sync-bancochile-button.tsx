"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Landmark, Plus } from "lucide-react"
import { toast } from "sonner"
import { ResponsiveModal } from "@/components/ui/responsive-modal"
import { SectionAction } from "./blocks"
import {
  OutlookBankConnection,
  type OutlookStatus,
} from "./outlook-bank-connection"

// Conectar el correo del banco. Sin cuentas conectadas es un tile en tono que llena la celda de una
// cuenta en el carrusel (`tile`; el ancho lo pone la celda); con alguna ya conectada, la acción de
// texto del encabezado de la tarjeta (`row`, la de SectionAction).
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
        <SectionAction onClick={openModal}>
          <Plus aria-hidden />
          Conectar banco
        </SectionAction>
      ) : (
        <button
          type="button"
          onClick={openModal}
          data-card
          className="press flex min-h-40 w-full flex-col items-center justify-center gap-2 rounded-lg bg-secondary p-(--pad-card) text-primary hover:bg-surface-3"
        >
          <Landmark aria-hidden className="size-6" />
          <span className="font-semibold">Conectar correo del banco</span>
          <span className="text-center text-callout text-ink-2">
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
        <div>
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
