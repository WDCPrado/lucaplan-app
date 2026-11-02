"use client"

import { useEffect, useRef, useState } from "react"
import { formatCLP } from "@/lib/finance-format"
import { spendPace } from "@/lib/spend-pace"
import { shortDate } from "./month-status"

/**
 * El mes como curva: lo gastado acumulado (sólida) contra el ritmo ideal (punteada, de $0 al
 * presupuesto en línea recta) y el ingreso del mes como techo. El color dice de un vistazo si vas
 * bajo el ritmo (verde) o sobre él (rojo); la línea de arriba lo dice en pesos. SVG propio en
 * píxeles reales (medido con ResizeObserver) para que trazos y puntos no se deformen al estirar.
 */
export function SpendPaceChart({
  days,
  spend,
  limit,
  income,
  lastIndex,
  current,
}: {
  days: string[] // fechas "YYYY-MM-DD" del período, en orden
  spend: number[] // gasto de cada fecha de `days` (spendByDate)
  limit: number // presupuesto del período
  income: number // ingreso del período; 0 = sin línea de techo
  lastIndex: number // hoy en el mes en curso; el último día en uno pasado; -1 si aún no empieza
  current: boolean // mes en curso: «Vas…» y marca de hoy; si no, «Cerraste…»
}) {
  const plotRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = plotRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) =>
      setSize({ w: e.contentRect.width, h: e.contentRect.height })
    )
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const n = days.length
  const { ideal, cumulative, diff } = spendPace(spend, limit, lastIndex)
  const k = cumulative.length - 1 // borde del último día con datos
  const spent = cumulative[k]
  const started = k > 0
  const isToday = current && lastIndex >= 0
  const over = diff > 0
  const tone = over ? "var(--destructive)" : "var(--success)"
  // Un poco de aire arriba para que el techo no quede pegado al borde.
  const yMax = Math.max(1, income, limit, spent) * 1.06

  const { w, h } = size
  const PAD = 4 // el grosor del trazo y el punto de hoy no se cortan en los bordes
  const x = (i: number) => PAD + (n ? (i / n) * (w - 2 * PAD) : 0)
  const y = (v: number) => PAD + (1 - v / yMax) * (h - 2 * PAD)
  const pts = (vals: number[]) =>
    vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ")
  const curve = pts(cumulative)
  const idealSoFar = ideal.slice(0, k + 1)
  const area = `${curve} ${idealSoFar
    .map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`)
    .reverse()
    .join(" ")}`

  const verb = isToday ? "Vas" : "Cerraste"
  const summary = !started
    ? "El período aún no empieza"
    : diff === 0
      ? `${verb} justo en el ritmo`
      : `${verb} ${formatCLP(Math.abs(diff))} ${over ? "sobre" : "bajo"} el ritmo`
  const todayX = x(k) // px del final de la curva (hoy)
  const EDGE = 72

  return (
    <figure
      className="flex min-h-40 flex-1 flex-col gap-2 md:h-64 md:flex-none"
    >
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span
          className="tabular text-subheadline font-semibold"
          style={started ? { color: tone } : undefined}
        >
          {summary}
        </span>
        {/* Una sola fila que no se parte (cabe a 375 px): la muestra de cada línea con su nombre;
            el ingreso va aquí y no sobre su línea, así el gráfico gana ese alto. */}
        <span
          aria-hidden
          className="ml-auto flex shrink-0 items-center gap-3 text-caption whitespace-nowrap text-muted-foreground"
        >
          <span className="flex items-center gap-1">
            <span
              className="h-0.5 w-3 rounded-full"
              style={{ background: tone }}
            />
            Gastado
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 border-t-2 border-dashed border-muted-foreground/60" />
            Ritmo
          </span>
          {income > 0 && (
            <span className="tabular flex items-center gap-1">
              <span className="h-px w-3 bg-muted-foreground/45" />
              Ingreso {formatCLP(income)}
            </span>
          )}
        </span>
      </figcaption>

      <div
        ref={plotRef}
        role="img"
        aria-label={`${summary}. Gastado ${formatCLP(spent)} de ${formatCLP(limit)}${
          started
            ? `; el ritmo ideal a la fecha era ${formatCLP(Math.round(ideal[k]))}`
            : ""
        }${income > 0 ? `. Ingreso del período ${formatCLP(income)}` : ""}.`}
        className="relative min-h-0 flex-1"
      >
        {w > 0 && h > 0 && (
          <svg
            width={w}
            height={h}
            className="absolute inset-0 overflow-visible"
            aria-hidden
          >
            {income > 0 && (
              <line
                x1={x(0)}
                x2={x(n)}
                y1={y(income)}
                y2={y(income)}
                stroke="var(--muted-foreground)"
                strokeOpacity={0.45}
                strokeWidth={1}
              />
            )}
            {/* Base: el $0 del período. */}
            <line
              x1={x(0)}
              x2={x(n)}
              y1={y(0)}
              y2={y(0)}
              stroke="var(--border)"
              strokeWidth={1}
            />
            <line
              x1={x(0)}
              x2={x(n)}
              y1={y(0)}
              y2={y(limit)}
              stroke="var(--muted-foreground)"
              strokeOpacity={0.7}
              strokeWidth={1.5}
              strokeDasharray="4 4"
            />
            {started && (
              <>
                <polygon points={area} fill={tone} fillOpacity={0.14} />
                <polyline
                  points={curve}
                  fill="none"
                  stroke={tone}
                  strokeWidth={2.5}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
                {/* Hoy (o el cierre): el final de la curva, con un aro del color de la tarjeta. */}
                <circle
                  cx={x(k)}
                  cy={y(spent)}
                  r={4.5}
                  fill={tone}
                  stroke="var(--card)"
                  strokeWidth={2}
                />
              </>
            )}
          </svg>
        )}
      </div>

      {/* Eje X: inicio, hoy y cierre, en px del ancho medido. «Hoy, 28 nov» mide ~64 px y una
          fecha del borde ~40: a menos de 72 px de un borde, la de hoy esconde la de ese borde. */}
      <div
        aria-hidden
        className="relative h-4 text-caption text-muted-foreground tabular-nums"
      >
        {!(isToday && todayX < EDGE) && (
          <span className="absolute left-0">{shortDate(days[0])}</span>
        )}
        {isToday && w > 0 && (
          <span
            className="absolute -translate-x-1/2 font-semibold whitespace-nowrap text-foreground"
            style={{ left: Math.min(Math.max(todayX, EDGE / 2), w - EDGE / 2) }}
          >
            Hoy, {shortDate(days[lastIndex])}
          </span>
        )}
        {!(isToday && todayX > w - EDGE) && (
          <span className="absolute right-0">{shortDate(days[n - 1])}</span>
        )}
      </div>
    </figure>
  )
}
