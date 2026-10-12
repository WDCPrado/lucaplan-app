"use client"

import * as React from "react"
import { X } from "lucide-react"
import { Drawer as DrawerPrimitive } from "vaul"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { haptic } from "@/lib/haptics"
import { useIsMobile } from "@/hooks/use-mobile"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"

export type ModalScopeInfo = {
  id: string
  parentId?: string
  depth: number
  kind: "dialog" | "drawer"
}

// React conserva el contexto a través de los portales: el hijo conoce a su padre incluso
// cuando sus superficies son hermanas en el DOM. Radix sigue gestionando foco, Esc y el fondo.
const ModalScopeContext = React.createContext<ModalScopeInfo | null>(null)

function useNewModalScope(kind: ModalScopeInfo["kind"]) {
  const parent = React.useContext(ModalScopeContext)
  const instanceId = React.useId()
  return {
    id: `modal-${instanceId}`,
    parentId: parent?.id,
    depth: parent ? parent.depth + 1 : 0,
    kind,
  }
}

function useModalFocus(scope: ModalScopeInfo) {
  const openerRef = React.useRef<HTMLElement | null>(null)
  return {
    onOpenAutoFocus(event: Event) {
      event.preventDefault()
      openerRef.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null
      // El panel recibe el foco sin seleccionar texto ni levantar el teclado del teléfono.
      ;(event.currentTarget as HTMLElement).focus({ preventScroll: true })
    },
    onCloseAutoFocus(event: Event) {
      event.preventDefault()
      // FocusScope llama al cierre después de desmontar y de terminar la animación. Leemos
      // las superficies actuales entonces, no un estado capturado antes de cerrar el padre.
      const openPanels = Array.from(
        document.querySelectorAll<HTMLElement>(
          "[data-modal-id][data-state='open']"
        )
      )
      const parentPanel = openPanels.find(
        (panel) => panel.dataset.modalId === scope.parentId
      )
      if (scope.parentId && !parentPanel) return
      // Otro modal que acaba de abrir conserva el foco; un cierre tardío no se lo roba.
      if (
        openPanels.some(
          (panel) =>
            panel.dataset.modalId !== scope.id &&
            Number(panel.dataset.modalDepth) >= scope.depth
        )
      )
        return
      const opener = openerRef.current
      if (
        opener?.isConnected &&
        (!parentPanel || parentPanel.contains(opener))
      ) {
        opener.focus({ preventScroll: true })
      } else {
        parentPanel?.focus({ preventScroll: true })
      }
    },
  }
}

// Para la excepción de diálogo a pantalla completa: añade identidad y parentesco sin crear
// otra superficie ni sustituir el Dialog nativo. El render prop permite marcar su Content.
export function ModalScope({
  children,
  kind = "dialog",
}: {
  children:
    | React.ReactNode
    | ((
        scope: ModalScopeInfo & ReturnType<typeof useModalFocus>
      ) => React.ReactNode)
  kind?: ModalScopeInfo["kind"]
}) {
  const scope = useNewModalScope(kind)
  const focusHandlers = useModalFocus(scope)
  return (
    <ModalScopeContext.Provider value={scope}>
      {typeof children === "function"
        ? children({ ...scope, ...focusHandlers })
        : children}
    </ModalScopeContext.Provider>
  )
}

function isolateModalEvent(event: React.SyntheticEvent) {
  // Un submit del formulario hijo no debe alcanzar otro formulario en el árbol de React.
  // No cancelamos la acción ni eventos de puntero: Vaul y los popovers los necesitan.
  event.stopPropagation()
}

/**
 * Barra de acciones anclada al borde inferior del modal: la acción principal no se pierde al hacer
 * scroll. Va DENTRO del contenido (el modal es el contenedor scrollable en ambas variantes), por
 * eso `sticky` y no `fixed`. Fondo opaco, no translúcido: lo que pasa por debajo no debe leerse a
 * través de los botones. `pb` con safe-area para no chocar con el gesto de inicio en la PWA.
 */
export function ModalFooter({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  const scope = React.useContext(ModalScopeContext)
  return (
    <div
      data-slot="modal-footer"
      data-modal-owner={scope?.id}
      className={cn(
        // bg-popover, no bg-background: es la superficie del Dialog y de la tarjeta del Drawer.
        // Con background (más oscuro en dark) el footer se ve como una banda de otro color.
        "sticky bottom-0 z-10 -mx-4 mt-6 flex flex-wrap items-center gap-3 border-t border-border bg-popover px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] [&_button]:min-h-11",
        className
      )}
    >
      {children}
    </div>
  )
}

// Superficie contextual adaptativa: diálogo centrado en escritorio, drawer inferior estilo iOS
// en móvil (vaul: altura según el contenido y arrastrable). Mismo contenido y comportamiento;
// solo cambia el envoltorio (useIsMobile, 768px).
export function ResponsiveModal({
  open,
  onOpenChange,
  title,
  children,
  className,
  headerClassName,
  dismissible = true,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  title: string
  children: React.ReactNode
  className?: string
  headerClassName?: string
  // `false` bloquea el cierre (Esc, click afuera, arrastre, botón X): para operaciones que no deben
  // interrumpirse a mitad (ej.: importación inicial en curso).
  dismissible?: boolean
}) {
  const isMobile = useIsMobile()
  const parent = React.useContext(ModalScopeContext)
  const scope = useNewModalScope(isMobile ? "drawer" : "dialog")
  const focusHandlers = useModalFocus(scope)
  // Ignora los intentos de cierre cuando está bloqueado; el resto pasa tal cual.
  const handleOpenChange = (o: boolean) => {
    if (!o && !dismissible) return
    onOpenChange(o)
  }

  // Haptic al abrir/cerrar (efecto genuino: sincroniza con el hardware de vibración).
  // Cubre todos los modales de la app en un solo punto; en escritorio es no-op.
  const prevOpen = React.useRef(open)
  React.useEffect(() => {
    if (prevOpen.current !== open) {
      prevOpen.current = open
      haptic("light")
    }
  }, [open])

  // Sin `shouldScaleBackground`: escalar el fondo le pone un `transform` al wrapper del layout, y un
  // ancestro con transform se vuelve el marco de referencia de todo `position: fixed` que tenga
  // dentro. La barra de navegación inferior (`fixed bottom-0`) pasaba a colgar del final del wrapper
  // —que mide todo el largo de la página, no la pantalla— y se iba de vista hasta cerrar el drawer.
  // El efecto se perdía igual bajo el overlay al 80%.
  if (isMobile) {
    const DrawerRoot =
      parent?.kind === "drawer" ? DrawerPrimitive.NestedRoot : Drawer
    return (
      <DrawerRoot
        open={open}
        onOpenChange={handleOpenChange}
        dismissible={dismissible}
      >
        <ModalScopeContext.Provider value={scope}>
          <DrawerContent
            tabIndex={-1}
            {...focusHandlers}
            data-product=""
            data-modal-id={scope.id}
            data-modal-parent={scope.parentId}
            data-modal-depth={scope.depth}
            onClick={isolateModalEvent}
            onSubmit={isolateModalEvent}
            className={cn(
              // Los paneles cortos usan su contenido; los largos desplazan el cuerpo sin alcanzar
              // el notch ni tapar las acciones con el teclado.
              "h-auto rounded-t-xl bg-popover p-0 text-base before:hidden data-[vaul-drawer-direction=bottom]:max-h-[calc(96dvh-env(safe-area-inset-top))]",
              className
            )}
          >
            <DrawerHeader
              className={cn(
                "relative shrink-0 px-5 pt-5 pb-6 text-left",
                headerClassName
              )}
            >
              <DrawerTitle className="text-xl leading-snug font-semibold break-words">
                {title}
              </DrawerTitle>
            </DrawerHeader>
            {/* El contenido se desplaza dentro del drawer; las acciones conservan su superficie
              opaca y el espacio seguro para el gesto inferior del teléfono. */}
            <div className="flex min-h-0 min-w-0 flex-1 [scrollbar-width:thin] [scrollbar-color:var(--border)_transparent] flex-col overflow-x-hidden overflow-y-auto [&>*]:min-w-0 [&>*]:shrink-0 [&>[data-slot=modal-footer]]:mx-0">
              {children}
            </div>
          </DrawerContent>
        </ModalScopeContext.Provider>
      </DrawerRoot>
    )
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <ModalScopeContext.Provider value={scope}>
        <DialogContent
          {...focusHandlers}
          data-product=""
          data-modal-id={scope.id}
          data-modal-parent={scope.parentId}
          data-modal-depth={scope.depth}
          onClick={isolateModalEvent}
          onSubmit={isolateModalEvent}
          showCloseButton={false}
          onEscapeKeyDown={dismissible ? undefined : (e) => e.preventDefault()}
          onInteractOutside={
            dismissible ? undefined : (e) => e.preventDefault()
          }
          className={cn(
            "max-h-[90dvh] [scrollbar-width:thin] [scrollbar-color:var(--border)_transparent] gap-0 overflow-x-hidden overflow-y-auto p-0 text-base sm:max-w-2xl [&>*]:min-w-0 [&>[data-slot=dialog-close]]:size-11 [&>[data-slot=modal-footer]]:mx-0",
            className
          )}
        >
          <DialogHeader className={cn("p-6", headerClassName)}>
            <DialogTitle className="pr-10 text-xl leading-snug font-semibold">
              {title}
            </DialogTitle>
            {dismissible && (
              <DialogClose asChild>
                <Button
                  id={`${scope.id}-close`}
                  data-modal-owner={scope.id}
                  data-slot="dialog-close"
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute top-4 right-4 hidden size-11 md:inline-flex"
                  aria-label={`Cerrar ${title}`}
                >
                  <X aria-hidden="true" />
                </Button>
              </DialogClose>
            )}
          </DialogHeader>
          {children}
        </DialogContent>
      </ModalScopeContext.Provider>
    </Dialog>
  )
}
