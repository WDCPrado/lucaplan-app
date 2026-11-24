import * as React from "react"
import { ChevronDown, ChevronRight } from "lucide-react"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

// Piezas de presentación del lenguaje «Finanzas en calma» (WDC-188). Solo dibujan: no piden datos,
// no calculan dominio ni mutan. Guía de uso en docs/design/design-system.md.

/**
 * Sección con encabezado independiente de la superficie: título y acción quedan afuera de la
 * tarjeta, mientras la línea clave y el contenido conservan el fondo, radio y padding actuales.
 */
export function SectionCard({
  title,
  action,
  keyLine,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<"section">, "title"> & {
  title?: React.ReactNode
  /** Acción de la tarjeta: normalmente un <SectionAction>. */
  action?: React.ReactNode
  /** Línea clave: <KeyLine value="$ 120.000" note="de $ 400.000" />. */
  keyLine?: React.ReactNode
}) {
  const titleId = React.useId()
  return (
    <section
      aria-labelledby={title ? titleId : undefined}
      className={cn("flex min-w-0 flex-col", className)}
      {...props}
    >
      {(title || action) && (
        <div className="mb-3 flex min-h-8 items-center justify-between gap-3">
          {title && (
            <h2
              id={titleId}
              className="min-w-0 flex-1 truncate text-title font-semibold text-ink-2"
            >
              {title}
            </h2>
          )}
          {action && <div className="-mr-2 flex shrink-0 items-center">{action}</div>}
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col rounded-xl bg-card p-(--pad-card) text-card-foreground">
        {keyLine}
        {children}
      </div>
    </section>
  )
}

/**
 * Acción de texto en verde para el encabezado de una tarjeta («Ver todo», «Editar»). Botón; con
 * `asChild` toma la forma de su hijo (un `<Link>`) con las mismas clases.
 */
export function SectionAction({
  className,
  children,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "button"
  return (
    <Comp
      {...(asChild ? {} : { type: "button" as const })}
      className={cn(
        "press inline-flex min-h-11 items-center gap-1 rounded-md px-2 text-callout font-semibold whitespace-nowrap text-primary hover:bg-primary-soft disabled:opacity-45 md:min-h-8 [&_svg]:size-4",
        className
      )}
      {...props}
    >
      {children}
    </Comp>
  )
}

/** Línea clave de una tarjeta: la cifra en tinta primaria (title) y su contexto en callout. Los montos no se parten. */
export function KeyLine({
  value,
  note,
  className,
}: {
  value: React.ReactNode
  note?: React.ReactNode
  className?: string
}) {
  return (
    <p
      className={cn(
        "mb-3 flex flex-wrap items-baseline gap-x-2 text-title font-semibold text-foreground",
        className
      )}
    >
      <span className="whitespace-nowrap">{value}</span>
      {note && (
        <span className="text-callout font-normal text-ink-2">{note}</span>
      )}
    </p>
  )
}

/**
 * Fila de lista: icono de 36 a la izquierda, título y meta, valor a la derecha y chevron opcional.
 * 56 px de alto mínimo. Con onClick o href es interactiva (hover en tono); sin ellos, solo lectura.
 * Las filas van en una columna con gap-2, sin separadores.
 * `aside` es una acción secundaria dentro de la fila (un enlace al portal de pago): como un control
 * no puede ir dentro de otro, la acción principal pasa a cubrir la fila por debajo y `aside` queda
 * encima; el nombre accesible de la fila es su título y su valor.
 */
export function ListRow({
  icon,
  title,
  meta,
  value,
  valueNote,
  chevron = false,
  aside,
  href,
  onClick,
  className,
  ...props
}: Omit<React.ComponentProps<"div">, "title" | "onClick"> & {
  icon?: React.ReactNode
  title: React.ReactNode
  meta?: React.ReactNode
  value?: React.ReactNode
  /** Segunda línea bajo el valor (caption, tinta 3). */
  valueNote?: React.ReactNode
  chevron?: boolean
  /** Acción secundaria dentro de la fila, entre el texto y el valor. */
  aside?: React.ReactNode
  href?: string
  onClick?: () => void
}) {
  const id = React.useId()
  const inner = (
    <>
      {icon && <span className="grid size-9 shrink-0 place-items-center">{icon}</span>}
      {/* Con aside, la fila ya se nombra con aria-labelledby: el texto visible no se lee dos veces. */}
      <span aria-hidden={aside ? true : undefined} className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span id={`${id}-t`} className="truncate font-semibold">{title}</span>
        {meta && (
          <span className="flex flex-wrap items-center gap-x-2 text-callout text-ink-2">
            {meta}
          </span>
        )}
      </span>
      {aside && <span className="relative z-2 flex min-w-0 shrink items-center">{aside}</span>}
      {(value || valueNote) && (
        <span
          aria-hidden={aside ? true : undefined}
          className="flex shrink-0 flex-col items-end text-right whitespace-nowrap"
        >
          {value && <span id={`${id}-v`} className="font-semibold">{value}</span>}
          {valueNote && (
            <span id={`${id}-n`} className="text-caption text-ink-3">
              {valueNote}
            </span>
          )}
        </span>
      )}
      {chevron && <ChevronRight aria-hidden className="size-4 shrink-0 text-ink-3" />}
    </>
  )
  const rowClass = cn(
    "-mx-3 flex min-h-14 w-[calc(100%+1.5rem)] items-center gap-3 rounded-lg px-3 py-2 text-left",
    (href || onClick) && "press hover:bg-secondary",
    aside && "relative",
    className
  )
  if (aside) {
    const cover = "absolute inset-0 z-1 rounded-[inherit]"
    const labelledBy = [`${id}-t`, value && `${id}-v`, valueNote && `${id}-n`]
      .filter(Boolean)
      .join(" ")
    return (
      <div className={rowClass} {...props}>
        {href ? (
          <a href={href} aria-labelledby={labelledBy} className={cover} />
        ) : onClick ? (
          <button type="button" onClick={onClick} aria-labelledby={labelledBy} className={cover} />
        ) : null}
        {inner}
      </div>
    )
  }
  if (href)
    return (
      <a href={href} className={rowClass} {...(props as React.ComponentProps<"a">)}>
        {inner}
      </a>
    )
  if (onClick)
    return (
      <button
        type="button"
        onClick={onClick}
        className={rowClass}
        {...(props as React.ComponentProps<"button">)}
      >
        {inner}
      </button>
    )
  return (
    <div className={rowClass} {...props}>
      {inner}
    </div>
  )
}

/** Cuadro de icono de 36 para ListRow. `color` es un color de categoría (var o hex del dato); sin él, neutro. */
export function IconTile({
  color,
  className,
  children,
}: {
  color?: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <span
      style={{ "--cat": color ?? "var(--ink-3)" } as React.CSSProperties}
      className={cn(
        "grid size-9 shrink-0 place-items-center rounded-sm bg-[color-mix(in_srgb,var(--cat)_16%,var(--card))] text-[color-mix(in_srgb,var(--cat)_62%,var(--foreground))] dark:bg-[color-mix(in_srgb,var(--cat)_20%,var(--card))] dark:text-[color-mix(in_srgb,var(--cat)_70%,var(--foreground))] [&_svg]:size-[1.125rem]",
        className
      )}
    >
      {children}
    </span>
  )
}

const noticeTone = {
  warn: "bg-warning-soft text-warning",
  alert: "bg-destructive-soft text-destructive",
  accent: "bg-primary-soft text-primary",
} as const

/**
 * Aviso en línea: fila a ancho completo de 44 px, radio 8, en tono suave (ámbar, óxido o verde).
 * Nunca una píldora suelta. Con onClick es un botón (y lleva chevron). `wrap` deja que un mensaje
 * largo (el de la API) se envuelva en vez de cortarse.
 */
export function InlineNotice({
  tone = "warn",
  label,
  value,
  icon,
  onClick,
  wrap = false,
  className,
}: {
  tone?: keyof typeof noticeTone
  wrap?: boolean
  label: React.ReactNode
  /** Cifra o acción a la derecha, en semibold. */
  value?: React.ReactNode
  icon?: React.ReactNode
  onClick?: () => void
  className?: string
}) {
  const cls = cn(
    "flex min-h-11 w-full items-center justify-between gap-3 rounded-md px-3 text-left text-callout [&_svg]:size-4 [&_svg]:shrink-0",
    noticeTone[tone],
    wrap && "py-2",
    onClick && "press hover:brightness-97",
    className
  )
  const inner = (
    <>
      {icon}
      <span className={cn("min-w-0 flex-1", wrap ? "text-pretty" : "truncate")}>{label}</span>
      {value && <span className="font-semibold whitespace-nowrap">{value}</span>}
      {onClick && <ChevronRight aria-hidden />}
    </>
  )
  return onClick ? (
    <button type="button" onClick={onClick} className={cls}>
      {inner}
    </button>
  ) : (
    <div role="status" className={cls}>
      {inner}
    </div>
  )
}

/** Tono de barra según el estado que calcula el servidor (el mismo semáforo que `statusVar`). */
export function statusTone(status: string): "default" | "warn" | "alert" {
  return status === "bueno" ? "default" : status === "moderado" ? "warn" : "alert"
}

/**
 * Barra de progreso de un tope: gastado a la izquierda, libre al centro y comprometido gris
 * reservado a la derecha. Si no alcanza el tope, la reserva mantiene su tramo y el gastado se
 * recorta al espacio restante. `tone` la tiñe de ámbar u óxido según el estado del
 * servidor; la barra solo fuerza óxido cuando lo gastado pasa del tope. `decorative` la saca del
 * árbol de accesibilidad: dentro de un botón o enlace un `meter` no se expone, y la cifra ya está
 * en el texto.
 */
export function ProgressBar({
  value,
  committed = 0,
  max,
  tone = "default",
  label,
  decorative = false,
  className,
}: {
  value: number
  committed?: number
  max: number
  tone?: "default" | "warn" | "alert"
  /** Nombre accesible («Gastado de Supermercado»). */
  label: string
  decorative?: boolean
  className?: string
}) {
  // Sin tope (tope $0), cualquier monto llena la barra, como antes del rediseño.
  const pct = (n: number) =>
    max > 0 ? Math.max(0, Math.min(100, (n / max) * 100)) : n > 0 ? 100 : 0
  const comm = pct(committed)
  const spent = Math.min(pct(value), 100 - comm)
  const t = value > max ? "alert" : tone
  const ariaMax = Math.max(1, max)
  return (
    <div
      {...(decorative
        ? { "aria-hidden": true }
        : {
            role: "meter",
            "aria-label": label,
            "aria-valuemin": 0,
            "aria-valuemax": ariaMax,
            "aria-valuenow": Math.max(0, Math.min(value, ariaMax)),
          })}
      className={cn("relative h-1.5 overflow-hidden rounded-full bg-track", className)}
    >
      <i
        style={{ width: spent + "%" }}
        className={cn(
          "absolute inset-y-0 left-0 rounded-full transition-[width] duration-240 ease-(--ease-out) motion-reduce:transition-none",
          t === "alert" ? "bg-destructive-bar" : t === "warn" ? "bg-warning-bar" : "bg-bar"
        )}
      />
      {comm > 0 && (
        <i
          style={{ width: comm + "%" }}
          className="absolute inset-y-0 right-0 rounded-full bg-committed"
        />
      )}
    </div>
  )
}

/** Dato suelto: etiqueta (caption, tinta 3) sobre su valor (callout semibold). Para filas de 2–3 cifras. */
export function StatTile({
  label,
  value,
  className,
}: {
  label: React.ReactNode
  value: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="text-caption whitespace-nowrap text-ink-3">{label}</dt>
      <dd className="truncate text-callout font-semibold whitespace-nowrap">{value}</dd>
    </div>
  )
}

/**
 * Chevron que gira 180° cuando su botón está abierto (aria-expanded="true" o data-state="open" en un
 * ancestro con la clase `group`). Va dentro del botón que abre.
 */
export function Chevron({ className }: { className?: string }) {
  return (
    <ChevronDown
      aria-hidden
      className={cn(
        "size-4 shrink-0 text-ink-3 transition-transform duration-180 ease-(--ease-out) group-aria-expanded:rotate-180 group-data-[state=open]:rotate-180 motion-reduce:transition-none",
        className
      )}
    />
  )
}
