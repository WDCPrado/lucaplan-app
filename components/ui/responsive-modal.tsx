"use client"

import * as React from "react"
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
      className={cn(
        // bg-popover, no bg-background: es la superficie del Dialog y de la tarjeta del Drawer.
        // Con background (más oscuro en dark) el footer se ve como una banda de otro color.
        "sticky bottom-0 z-10 -mx-4 mt-auto flex flex-wrap items-center gap-2 border-t border-border/60 bg-popover px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]",
        className
      )}
    >
      {children}
    </div>
  )
}

// Superficie contextual adaptativa: diálogo centrado en escritorio, drawer inferior estilo iOS
// en móvil (vaul: full-height, arrastrable, con el fondo escalado vía data-vaul-drawer-wrapper
// en el layout). Mismo contenido y comportamiento; solo cambia el envoltorio (useIsMobile, 768px).
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
          className={cn(
            // Altura menos el safe-area del notch: como el drawer está anclado abajo, restar altura
            // baja todo el borde superior de la tarjeta bajo el notch en la PWA instalada. En
            // navegador env()=0 y queda 96dvh como antes.
            "h-[calc(96dvh-env(safe-area-inset-top))] data-[vaul-drawer-direction=bottom]:max-h-[calc(96dvh-env(safe-area-inset-top))]",
            className
          )}
        >
          <DrawerHeader className={headerClassName}>
            <DrawerTitle>{title}</DrawerTitle>
          </DrawerHeader>
          {/* Columna flex y el hijo estirado: así el ModalFooter (mt-auto) queda pegado al borde
              inferior cuando el contenido es más corto que el drawer. Con contenido largo el hijo
              mide lo que mide y el área scrollea igual que antes. */}
          <div className="flex min-h-0 flex-1 [scrollbar-width:thin] [scrollbar-color:var(--border)_transparent] flex-col overflow-x-hidden overflow-y-auto [&>*]:flex-1">
            {children}
          </div>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        showCloseButton={dismissible}
        onEscapeKeyDown={dismissible ? undefined : (e) => e.preventDefault()}
        onInteractOutside={dismissible ? undefined : (e) => e.preventDefault()}
        className={cn(
          "max-h-[90dvh] [scrollbar-width:thin] [scrollbar-color:var(--border)_transparent] gap-0 overflow-x-hidden overflow-y-auto p-0 sm:max-w-lg [&>*]:min-w-0",
          className
        )}
      >
        <DialogHeader className={cn("p-6", headerClassName)}>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  )
}
