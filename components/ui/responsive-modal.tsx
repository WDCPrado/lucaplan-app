"use client"

import { Button } from "glisse"

import { X } from "lucide-react"
import * as React from "react"
import { createPortal } from "react-dom"
import { Drawer as DrawerPrimitive } from "vaul"

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

type ModalScopeInfo = {
  id: string
  parentId?: string
  depth: number
  kind: "dialog" | "drawer"
}

// React conserva el contexto a través de los portales: el hijo conoce a su padre incluso
// cuando sus superficies son hermanas en el DOM. Radix sigue gestionando foco, Esc y el fondo.
const ModalScopeContext = React.createContext<ModalScopeInfo | null>(null)

// Huecos del encabezado de la hoja (móvil) donde `ModalActions` dibuja Cancelar y la acción
// principal por portal, aunque se declaren dentro del formulario que guarda su estado.
type HeaderSlots = { start: HTMLElement | null; end: HTMLElement | null }
const HeaderSlotsContext = React.createContext<HeaderSlots | null>(null)

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

function isolateModalEvent(event: React.SyntheticEvent) {
  // Un submit del formulario hijo no debe alcanzar otro formulario en el árbol de React.
  // No cancelamos la acción ni eventos de puntero: Vaul y los popovers los necesitan.
  event.stopPropagation()
}

/** Acción del modal: con `form` envía ese `<form>` (mismo submit que Enter); sin él, `onClick`. */
export type ModalAction = {
  label: React.ReactNode
  /** Texto corto para el encabezado de la hoja en móvil («Guardar» en vez de «Guardar presupuesto»). */
  mobileLabel?: React.ReactNode
  form?: string
  onClick?: () => void
  disabled?: boolean
}

function actionProps(action: ModalAction) {
  return action.form
    ? ({ type: "submit", form: action.form } as const)
    : ({ type: "button", onClick: action.onClick } as const)
}

/**
 * Pie del diálogo de ESCRITORIO, anclado abajo (`sticky`, dentro del contenido que hace scroll) y
 * opaco. En la hoja de móvil no se dibuja: las acciones van en el encabezado (`primary`/`cancel`
 * de `ResponsiveModal`) y un «Listo»/«Cerrar» sobra porque la hoja se cierra arrastrando o tocando
 * el fondo. Lo que deba verse también en móvil no va aquí.
 */
export function ModalFooter({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  const scope = React.useContext(ModalScopeContext)
  if (scope?.kind === "drawer") return null
  return (
    <div
      data-slot="modal-footer"
      data-modal-owner={scope?.id}
      className={cn(
        // bg-sheet: la misma superficie del diálogo, para que no se vea como una banda de otro color.
        "sticky bottom-0 z-10 -mx-4 mt-6 flex flex-wrap items-center gap-3 border-t border-border bg-sheet px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] [&_button]:min-h-11",
        className
      )}
    >
      {children}
    </div>
  )
}

/**
 * Acciones del modal, declaradas donde vive su estado (dentro del formulario si hace falta).
 * Móvil: «Cancelar» a la izquierda del título y la principal en texto azul semibold a la derecha,
 * en el encabezado de la hoja. Escritorio: pie con los dos botones, como siempre.
 */
export function ModalActions({
  primary,
  cancel,
  className,
}: {
  primary?: ModalAction
  cancel?: ModalAction
  className?: string
}) {
  const scope = React.useContext(ModalScopeContext)
  const slots = React.useContext(HeaderSlotsContext)
  if (scope?.kind === "drawer") {
    return (
      <>
        {cancel &&
          slots?.start &&
          createPortal(
            <Button
              {...actionProps(cancel)}
              disabled={cancel.disabled}
              className={sheetActionClass}
            >
              {cancel.mobileLabel ?? cancel.label}
            </Button>,
            slots.start
          )}
        {primary &&
          slots?.end &&
          createPortal(
            <Button
              variant="filled"
              {...actionProps(primary)}
              disabled={primary.disabled}
              className={cn(sheetActionClass, "font-semibold")}
            >
              {primary.mobileLabel ?? primary.label}
            </Button>,
            slots.end
          )}
      </>
    )
  }
  return (
    <ModalFooter className={className}>
      {cancel && (
        <Button
          {...actionProps(cancel)}
          disabled={cancel.disabled}
          className="h-12 flex-1 text-body"
        >
          {cancel.label}
        </Button>
      )}
      {primary && (
        <Button
          variant="filled"
          {...actionProps(primary)}
          disabled={primary.disabled}
          className="h-auto min-h-12 min-w-0 flex-1 py-3 text-body whitespace-normal"
        >
          {primary.label}
        </Button>
      )}
    </ModalFooter>
  )
}

/**
 * Sección de lista agrupada dentro de una hoja, como en Ajustes: el título va fuera del grupo, las
 * filas (≥44 px) dentro de una sola celda con separadores, y la ayuda como pie del grupo en
 * `text-footnote`. Sin tarjetas dentro de tarjetas.
 */
export function ModalSection({
  title,
  footer,
  className,
  children,
}: {
  title?: React.ReactNode
  footer?: React.ReactNode
  className?: string
  children: React.ReactNode
}) {
  return (
    <section className="min-w-0">
      {title && (
        <h3 className="px-4 pb-2 text-headline font-semibold">{title}</h3>
      )}
      <div className={cn("sheet-group inset-list overflow-hidden", className)}>
        {children}
      </div>
      {footer && (
        <div className="px-4 pt-2 text-footnote text-muted-foreground">
          {footer}
        </div>
      )}
    </section>
  )
}

/**
 * Acción destructiva como fila de texto roja, en su propio grupo al final del contenido: nunca en el
 * encabezado ni junto a la acción primaria. Acepta las props de un botón para ir dentro de un
 * `AlertDialogTrigger asChild`.
 */
export function ModalDangerRow({
  className,
  ...props
}: React.ComponentProps<typeof Button>) {
  return (
    <Button
      destructive
      type="button"
      className={cn(
        "sheet-group press h-auto min-h-11 w-full justify-center rounded-xl px-4 py-2.5 text-body font-normal whitespace-normal text-destructive hover:bg-(--sheet-cell) hover:text-destructive aria-expanded:bg-(--sheet-cell) aria-expanded:text-destructive dark:hover:bg-(--sheet-cell)",
        className
      )}
      {...props}
    />
  )
}

// Texto de acción del encabezado de la hoja: azul, sin relleno, 44 px de alto; deshabilitada en gris.
const sheetActionClass =
  "press h-11 min-w-11 px-3 text-body font-normal text-primary hover:bg-transparent hover:text-primary dark:hover:bg-transparent disabled:text-muted-foreground disabled:opacity-100"

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
  primary,
  cancel,
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
  /** Atajo de `<ModalActions primary cancel />` cuando el estado de las acciones vive aquí arriba. */
  primary?: ModalAction
  cancel?: ModalAction
}) {
  const isMobile = useIsMobile()
  const parent = React.useContext(ModalScopeContext)
  const scope = useNewModalScope(isMobile ? "drawer" : "dialog")
  const focusHandlers = useModalFocus(scope)
  const [slotStart, setSlotStart] = React.useState<HTMLElement | null>(null)
  const [slotEnd, setSlotEnd] = React.useState<HTMLElement | null>(null)
  const slots = React.useMemo(
    () => ({ start: slotStart, end: slotEnd }),
    [slotStart, slotEnd]
  )
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
        repositionInputs={false}
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
              // el notch. El teclado se superpone sin redimensionar ni elevar el panel.
              "h-auto rounded-t-(--radius-sheet) p-0 text-body before:hidden data-[vaul-drawer-direction=bottom]:max-h-[calc(96dvh-env(safe-area-inset-top))]",
              className
            )}
          >
            {/* Encabezado de hoja de iOS: Cancelar a la izquierda, título centrado y la acción
              principal a la derecha. Los lados crecen igual (`flex-1 basis-0`) para centrar el
              título, que es lo único que se encoge y envuelve. */}
            <DrawerHeader
              className={cn(
                "relative flex shrink-0 flex-row items-center gap-1 px-2 pt-1 pb-3 text-center",
                headerClassName
              )}
            >
              <div
                ref={setSlotStart}
                className="flex min-w-fit flex-1 basis-0 justify-start"
              />
              <DrawerTitle className="min-w-0 shrink text-headline font-semibold text-balance break-words">
                {title}
              </DrawerTitle>
              <div
                ref={setSlotEnd}
                className="flex min-w-fit flex-1 basis-0 justify-end"
              />
            </DrawerHeader>
            {/* El contenido se desplaza dentro del drawer, sin pie: el final deja aire y el espacio
              seguro para el gesto inferior del teléfono. */}
            <div className="flex min-h-0 min-w-0 flex-1 [scrollbar-width:thin] [scrollbar-color:var(--border)_transparent] flex-col overflow-x-hidden overflow-y-auto pb-[max(1.5rem,env(safe-area-inset-bottom))] [&>*]:min-w-0 [&>*]:shrink-0">
              <HeaderSlotsContext.Provider value={slots}>
                {children}
                {(cancel || primary) && (
                  <ModalActions cancel={cancel} primary={primary} />
                )}
              </HeaderSlotsContext.Provider>
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
            "max-h-[90dvh] [scrollbar-width:thin] [scrollbar-color:var(--border)_transparent] gap-0 overflow-x-hidden overflow-y-auto rounded-(--radius-sheet) p-0 text-body sm:max-w-2xl [&>*]:min-w-0 [&>[data-slot=dialog-close]]:size-11 [&>[data-slot=modal-footer]]:mx-0",
            className
          )}
        >
          <DialogHeader className={cn("p-6", headerClassName)}>
            <DialogTitle className="pr-10 text-title-3 font-semibold">
              {title}
            </DialogTitle>
            {dismissible && (
              <DialogClose asChild>
                <Button
                  icon={<X aria-hidden="true" />}
                  id={`${scope.id}-close`}
                  data-modal-owner={scope.id}
                  data-slot="dialog-close"
                  type="button"
                  style={{ position: "absolute", top: 16, right: 16 }}
                  aria-label={`Cerrar ${title}`}
                ></Button>
              </DialogClose>
            )}
          </DialogHeader>
          {children}
          {(cancel || primary) && (
            <ModalActions cancel={cancel} primary={primary} className="px-5" />
          )}
        </DialogContent>
      </ModalScopeContext.Provider>
    </Dialog>
  )
}
