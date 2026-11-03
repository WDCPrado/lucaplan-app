"use client"

import { useEffect, useState, useSyncExternalStore } from "react"
import { MonitorDown, Share, SquarePlus } from "lucide-react"
import { DropdownMenuItem } from "@/components/ui/dropdown-menu"
import { ResponsiveModal } from "@/components/ui/responsive-modal"
import { haptic } from "@/lib/haptics"

// Evento no tipado por TS DOM: prompt de instalación de Chromium.
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
}

// ¿Corre ya como app instalada? External store sobre display-mode + appinstalled: en SSR e
// hidratación responde true (item oculto) y tras montar refleja el estado real del navegador.
let installedInSession = false
function subscribeStandalone(onChange: () => void): () => void {
  const media = window.matchMedia("(display-mode: standalone)")
  const onInstalled = () => {
    installedInSession = true
    onChange()
  }
  media.addEventListener("change", onChange)
  window.addEventListener("appinstalled", onInstalled)
  return () => {
    media.removeEventListener("change", onChange)
    window.removeEventListener("appinstalled", onInstalled)
  }
}
function getStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean }
  return (
    installedInSession ||
    window.matchMedia("(display-mode: standalone)").matches ||
    nav.standalone === true
  )
}

// "Instalar Luca Plan" en el menú de usuario. Progresivo según capacidad:
// - Chromium: guarda el beforeinstallprompt y abre el prompt nativo desde el click.
// - iOS/iPadOS (sin prompt programable): instrucciones de Compartir → Agregar a inicio.
// - Ya instalada (standalone) o sin vía de instalación: no se muestra nada.
// Con `rowClassName` se dibuja como fila de una lista agrupada (Ajustes en móvil) en vez de ítem de menú.
export function InstallAppItem({
  rowClassName,
}: { rowClassName?: string } = {}) {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(
    null
  )
  const [iosHelp, setIosHelp] = useState(false)
  const standalone = useSyncExternalStore(
    subscribeStandalone,
    getStandalone,
    () => true
  )
  // iPadOS se reporta como Mac pero es táctil. No afecta la hidratación: con standalone=true
  // (snapshot de servidor) el primer render es null en servidor y cliente por igual.
  const isIOS =
    typeof navigator !== "undefined" &&
    (/iPhone|iPad|iPod/.test(navigator.userAgent) ||
      (navigator.userAgent.includes("Mac") && navigator.maxTouchPoints > 1))

  // useEffect justificado: beforeinstallprompt es un evento externo del navegador; el estado se
  // setea solo desde su handler (asíncrono), nunca síncrono en el cuerpo del efecto.
  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault() // el prompt se abre desde la acción del usuario, no solo
      setDeferred(e as BeforeInstallPromptEvent)
    }
    window.addEventListener("beforeinstallprompt", onPrompt)
    return () => window.removeEventListener("beforeinstallprompt", onPrompt)
  }, [])

  if (standalone || (!deferred && !isIOS)) return null

  function install() {
    haptic("light")
    if (deferred) void deferred.prompt()
    else setIosHelp(true)
  }

  return (
    <>
      {rowClassName ? (
        <button type="button" onClick={install} className={rowClassName}>
          Instalar Luca Plan
        </button>
      ) : (
        <DropdownMenuItem
          onSelect={(e) => {
            haptic("light")
            if (deferred) {
              void deferred.prompt()
              return
            }
            // El modal vive dentro del item: cerrar el menú lo desmontaría (mismo patrón que el
            // toggle de tema de este menú).
            e.preventDefault()
            setIosHelp(true)
          }}
        >
          <MonitorDown className="size-4" />
          Instalar Luca Plan
        </DropdownMenuItem>
      )}

      {iosHelp && (
        <ResponsiveModal
          className="sm:max-w-md"
          open
          onOpenChange={(o) => !o && setIosHelp(false)}
          title="Instalar Luca Plan"
        >
          <div className="flex flex-col gap-4 px-4 pb-8">
            <p className="text-subheadline text-muted-foreground">
              En iPhone y iPad la instalación se hace desde Safari, en dos
              pasos:
            </p>
            <ol className="flex flex-col gap-3">
              <li className="flex items-center gap-3 text-body">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-secondary">
                  <Share className="size-5" aria-hidden="true" />
                </span>
                Toca el botón <strong>Compartir</strong> en la barra de Safari.
              </li>
              <li className="flex items-center gap-3 text-body">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-secondary">
                  <SquarePlus className="size-5" aria-hidden="true" />
                </span>
                Elige <strong>Agregar a pantalla de inicio</strong>.
              </li>
            </ol>
            <p className="text-subheadline text-muted-foreground">
              Luca Plan quedará como app en tu pantalla de inicio, con su propio
              icono y ventana.
            </p>
          </div>
        </ResponsiveModal>
      )}
    </>
  )
}
