"use client"

import * as React from "react"
import { Loader, X } from "lucide-react"
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

type ModalScopeInfo = {
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

function isolateModalEvent(event: React.SyntheticEvent) {
  // Un submit del formulario hijo no debe alcanzar otro formulario en el árbol de React.
  // No cancelamos la acción ni eventos de puntero: Vaul y los popovers los necesitan.
  event.stopPropagation()
}

/** Acción del modal: con `form` envía ese `<form>` (mismo submit que Enter); sin él, `onClick`. */
export type ModalAction = {
  label: React.ReactNode
  /** Acción que no confirma (Editar): botón en tono en vez del verde, que es de Guardar/Listo. */
  plain?: boolean
  /** Ícono que acompaña al texto de la acción. */
  icon?: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>
  form?: string
  onClick?: () => void
  disabled?: boolean
  /** Guardando o conectando: deshabilita la acción y muestra un spinner en su lugar. */
  busy?: boolean
}

function actionProps(action: ModalAction) {
  return {
    ...(action.form
      ? ({ type: "submit", form: action.form } as const)
      : ({ type: "button", onClick: action.onClick } as const)),
    disabled: action.disabled || action.busy,
    "aria-busy": action.busy || undefined,
  }
}

// Spinner de una acción ocupada; quieto con «reducir movimiento».
const busySpinner = (className: string) => (
  <Loader
    aria-hidden
    className={cn("animate-spin motion-reduce:animate-none", className)}
  />
)

/**
 * Pie de la hoja o del diálogo, anclado abajo (`sticky`, dentro del cuerpo que hace scroll), en la
 * superficie de la hoja y con un filete en tono arriba. Los botones van a la derecha (la principal la
 * última); en móvil se reparten el ancho. Va al final del contenido.
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
        "sticky bottom-0 z-10 -mx-(--pad-sheet) mt-6 flex flex-wrap items-center justify-end gap-3 border-t border-secondary bg-card px-(--pad-sheet) pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:pb-(--pad-sheet) max-md:*:flex-1 [&_button]:min-h-11",
        className
      )}
    >
      {children}
    </div>
  )
}

/**
 * Acciones del modal, declaradas donde vive su estado (dentro del formulario si hace falta): el pie
 * con Cancelar en tono y la principal en verde a su derecha.
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
  return (
    <ModalFooter className={className}>
      {cancel && (
        <Button {...actionProps(cancel)} variant="secondary">
          {cancel.label}
        </Button>
      )}
      {primary && (
        <Button
          {...actionProps(primary)}
          variant={primary.plain ? "secondary" : "default"}
          className="h-auto min-h-(--ctl) min-w-28 py-2 whitespace-normal"
        >
          {primary.busy
            ? busySpinner("size-4")
            : primary.icon && <primary.icon aria-hidden className="size-4" />}
          {primary.label}
        </Button>
      )}
    </ModalFooter>
  )
}

/**
 * Sección de una hoja: la etiqueta (callout semibold, tinta 2), el contenido y una ayuda opcional
 * debajo (caption, tinta 3). Por defecto cada hijo es una fila en tono (`.tone-rows`: surface-2,
 * radio 12, 8 px entre filas, sin líneas); `plain` deja el contenido en columna sin tono (campos,
 * chips). Las filas de adentro usan `modalRow` / `modalActionRow`.
 */
export function ModalSection({
  title,
  action,
  footer,
  plain = false,
  className,
  children,
}: {
  title?: React.ReactNode
  /** Acción de texto a la derecha de la etiqueta (un SectionAction). */
  action?: React.ReactNode
  footer?: React.ReactNode
  plain?: boolean
  className?: string
  children: React.ReactNode
}) {
  return (
    <section className="flex min-w-0 flex-col gap-2">
      {(title || action) && (
        <div className="flex min-h-8 items-center justify-between gap-3">
          {title && (
            <h3 className="min-w-0 flex-1 text-callout font-semibold text-ink-2">{title}</h3>
          )}
          {action && <div className="-mr-2 flex shrink-0 items-center">{action}</div>}
        </div>
      )}
      <div className={cn(plain ? "flex min-w-0 flex-col gap-3" : "tone-rows", className)}>
        {children}
      </div>
      {footer && <div className="text-caption text-pretty text-ink-3">{footer}</div>}
    </section>
  )
}

/**
 * Dato label → valor dentro de un `<dl className="sheet-group px-4 py-1">` (un bloque en tono): la
 * etiqueta en tinta 2 y el valor en semibold a la derecha, 44 px, sin líneas.
 */
export function ModalDataRow({
  label,
  value,
}: {
  label: React.ReactNode
  value: React.ReactNode
}) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-4 py-2">
      <dt className="shrink-0 text-callout text-ink-2">{label}</dt>
      <dd className="min-w-0 text-right font-semibold break-words">{value}</dd>
    </div>
  )
}

/** Fila de dato o de texto dentro de una sección en tono: 44 px, margen 16. */
export const modalRow = "flex min-h-11 min-w-0 items-center gap-3 px-4 py-2.5 text-body"
/** Fila que actúa (abre, marca, pausa): la misma fila, con hover en tono más oscuro. */
export const modalActionRow =
  "press flex min-h-11 w-full min-w-0 items-center gap-3 px-4 py-2.5 text-left text-body hover:bg-surface-3 disabled:pointer-events-none disabled:opacity-45 [&_svg]:size-5 [&_svg]:shrink-0"

/**
 * Acción destructiva como fila en tono con el texto en óxido, al final del contenido: nunca en el pie
 * ni junto a la acción principal. Acepta las props de un botón para ir dentro de un
 * `AlertDialogTrigger asChild`.
 */
export function ModalDangerRow({
  className,
  ...props
}: React.ComponentProps<typeof Button>) {
  return (
    <Button
      type="button"
      variant="ghost"
      className={cn(
        "h-auto min-h-11 w-full justify-start gap-3 rounded-lg bg-secondary px-4 py-2.5 text-left text-body font-semibold whitespace-normal text-destructive [&_svg:not([class*='size-'])]:size-5 hover:bg-destructive-soft hover:text-destructive aria-expanded:bg-destructive-soft aria-expanded:text-destructive",
        className
      )}
      {...props}
    />
  )
}

// Encabezado fijo de una hoja (móvil): el título a la izquierda y la X a la derecha, 44 px.
function SheetHeader({
  title,
  onClose,
}: {
  title: React.ReactNode
  onClose?: () => void
}) {
  return (
    <DrawerHeader className="flex shrink-0 flex-row items-center gap-2 py-2 pr-2 pl-(--pad-sheet) text-left group-data-[vaul-drawer-direction=bottom]/drawer-content:text-left md:text-left">
      <DrawerTitle className="min-w-0 flex-1 text-title font-semibold text-balance break-words">
        {title}
      </DrawerTitle>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          className="press grid size-11 shrink-0 place-items-center rounded-md text-ink-2 hover:bg-secondary hover:text-foreground"
        >
          <X aria-hidden className="size-5" />
          <span className="sr-only">Cerrar</span>
        </button>
      )}
    </DrawerHeader>
  )
}

// La hoja desde abajo (vaul): radio 24 arriba, asa, encabezado fijo y cuerpo con scroll propio; no
// llega al notch. Con «reducir movimiento» aparece y se va sin deslizarse; el dedo la sigue igual.
// No ocultar el `::after` de vaul: además de rellenar bajo la hoja al tirarla hacia arriba, es lo
// que hace que `shouldDrag` reconozca la hoja (role=dialog con overflow).
const sheetContentClass =
  "h-auto rounded-t-(--radius-sheet) bg-card p-0 text-body shadow-sheet outline-none before:hidden data-[vaul-drawer-direction=bottom]:mt-0 data-[vaul-drawer-direction=bottom]:max-h-[calc(96dvh-env(safe-area-inset-top))] motion-reduce:transition-none! motion-reduce:[animation-duration:1ms]"
// Cuerpo de la hoja: margen --pad-sheet y, sin pie, aire más el espacio seguro del home indicator.
const sheetBodyClass =
  "flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto overscroll-contain px-(--pad-sheet) pt-2 pb-[calc(1.5rem+env(safe-area-inset-bottom))] has-[[data-slot=modal-footer]]:pb-0 [&>*]:min-w-0 [&>*]:shrink-0"

// Superficie contextual adaptativa: diálogo centrado en escritorio (radio 24), hoja desde abajo
// en móvil (vaul: altura según el contenido y arrastrable). Mismo contenido y comportamiento;
// solo cambia el envoltorio (useIsMobile, 768px). El cuerpo lleva el margen de la hoja
// (--pad-sheet: 16 móvil, 24 escritorio): el contenido no pone el suyo.
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

  const actions = (cancel || primary) && (
    <ModalActions cancel={cancel} primary={primary} />
  )

  // Sin `shouldScaleBackground`: escalar el fondo le pone un `transform` al wrapper del layout, y un
  // ancestro con transform se vuelve el marco de referencia de todo `position: fixed` que tenga
  // dentro; la barra inferior se iba de vista hasta cerrar el drawer.
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
            className={cn(sheetContentClass, className)}
          >
            <div className={cn(headerClassName)}>
              <SheetHeader
                title={title}
                onClose={dismissible ? () => handleOpenChange(false) : undefined}
              />
            </div>
            <div className={sheetBodyClass}>
              {children}
              {actions}
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
            "max-h-[90dvh] gap-0 overflow-x-hidden overflow-y-auto rounded-(--radius-sheet) bg-card p-0 text-body sm:max-w-2xl [&>*]:min-w-0",
            className
          )}
        >
          <DialogHeader className={cn("px-(--pad-sheet) pt-6 pb-4", headerClassName)}>
            <DialogTitle className="pr-12 text-title font-semibold">
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
                  className="absolute top-5 right-5 size-(--ctl) text-ink-2 hover:text-foreground"
                  aria-label={`Cerrar ${title}`}
                >
                  <X aria-hidden="true" className="size-5" />
                </Button>
              </DialogClose>
            )}
          </DialogHeader>
          <div className="flex min-w-0 flex-col px-(--pad-sheet) pb-(--pad-sheet) has-[[data-slot=modal-footer]]:pb-0">
            {children}
            {actions}
          </div>
        </DialogContent>
      </ModalScopeContext.Provider>
    </Dialog>
  )
}

/**
 * Lo que en escritorio es un popover anclado a su botón (calendario, selector de mes, menú) y en
 * móvil una hoja desde abajo con su título y la X. Mismo contenido y mismos handlers; dentro de una
 * hoja se apila encima (NestedRoot de vaul). `trigger` es el botón que lo abre (asChild).
 */
export function ResponsivePopover({
  open,
  onOpenChange,
  title,
  trigger,
  children,
  align = "start",
  className,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  /** Título de la hoja en móvil (en escritorio no se dibuja). */
  title: React.ReactNode
  trigger: React.ReactElement
  children: React.ReactNode
  align?: "start" | "center" | "end"
  /** Clases del popover de escritorio. */
  className?: string
}) {
  const isMobile = useIsMobile()
  const parent = React.useContext(ModalScopeContext)
  // La hoja es un ámbito más: un modal que se abra desde ella se apila encima (NestedRoot).
  const scope = useNewModalScope("drawer")
  if (isMobile) {
    const Root = parent?.kind === "drawer" ? DrawerPrimitive.NestedRoot : Drawer
    return (
      <Root open={open} onOpenChange={onOpenChange} repositionInputs={false}>
        <DrawerPrimitive.Trigger asChild>{trigger}</DrawerPrimitive.Trigger>
        <DrawerContent
          data-product=""
          onClick={isolateModalEvent}
          onSubmit={isolateModalEvent}
          className={sheetContentClass}
        >
          <ModalScopeContext.Provider value={scope}>
            <SheetHeader title={title} onClose={() => onOpenChange(false)} />
            <div className={sheetBodyClass}>{children}</div>
          </ModalScopeContext.Provider>
        </DrawerContent>
      </Root>
    )
  }
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align={align} className={className}>
        {children}
      </PopoverContent>
    </Popover>
  )
}
