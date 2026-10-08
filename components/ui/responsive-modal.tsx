"use client"

import * as React from "react"
import { X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { haptic } from "@/lib/haptics"
import { useIsMobile } from "@/hooks/use-mobile"
import {
  Dialog,
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
  return (
    <div
      data-slot="modal-footer"
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
    return (
      <Drawer
        open={open}
        onOpenChange={handleOpenChange}
        dismissible={dismissible}
      >
        <DrawerContent
          data-product=""
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
            <DrawerTitle className="pr-12 text-xl leading-snug font-semibold">
              {title}
            </DrawerTitle>
            {dismissible && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute top-3 right-1 size-11"
                aria-label="Cerrar"
                onClick={() => handleOpenChange(false)}
              >
                <X aria-hidden="true" />
              </Button>
            )}
          </DrawerHeader>
          {/* El contenido se desplaza dentro del drawer; las acciones conservan su superficie
              opaca y el espacio seguro para el gesto inferior del teléfono. */}
          <div className="flex min-h-0 flex-1 [scrollbar-width:thin] [scrollbar-color:var(--border)_transparent] flex-col overflow-x-hidden overflow-y-auto [&>[data-slot=modal-footer]]:mx-0">
            {children}
          </div>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        data-product=""
        showCloseButton={dismissible}
        onEscapeKeyDown={dismissible ? undefined : (e) => e.preventDefault()}
        onInteractOutside={dismissible ? undefined : (e) => e.preventDefault()}
        className={cn(
          "max-h-[90dvh] [scrollbar-width:thin] [scrollbar-color:var(--border)_transparent] gap-0 overflow-x-hidden overflow-y-auto p-0 text-base sm:max-w-2xl [&>*]:min-w-0 [&>[data-slot=dialog-close]]:size-11 [&>[data-slot=modal-footer]]:mx-0",
          className
        )}
      >
        <DialogHeader className={cn("p-6", headerClassName)}>
          <DialogTitle className="pr-10 text-xl leading-snug font-semibold">
            {title}
          </DialogTitle>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  )
}
