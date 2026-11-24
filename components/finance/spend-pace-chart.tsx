"use client"

import { useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import { formatCLP } from "@/lib/finance-format"
import { spendPace } from "@/lib/spend-pace"
import { spendingColors } from "@/lib/spending-colors"
import { shortDate } from "./month-status"

/**
 * El mes como curva: el gasto de ritmo acumulado (sólida; sin los pagos que saldan una recurrente
 * o una cuota) contra el ritmo ideal (punteada, de $0 a lo disponible al inicio en línea recta). La
 * línea clave de arriba dice en pesos cuánto vas sobre o bajo el ritmo; el óxido solo marca «sobre».
 * SVG propio en píxeles reales (medido con ResizeObserver) para que trazos y puntos no se deformen.
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
  spend: number[] // gasto de ritmo de cada fecha de `days` (budget.globalPace.daily)
  limit: number // base del ritmo del período (budget.globalPace.budget)
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
  // El gasto usa los mismos tercios que las barras; el desvío del ritmo sigue indicado en texto.
  const tone = spendingColors(spent, limit).stroke
  // Un poco de aire arriba para que el techo no quede pegado al borde.
  const yMax = Math.max(1, limit, spent) * 1.06

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
    <figure className="flex min-h-44 flex-1 flex-col gap-2">
      <figcaption className="mb-1 flex flex-wrap items-baseline gap-x-2 text-title font-semibold">
        {!started || diff === 0 ? (
          <span>{summary}</span>
        ) : (
          <>
            <span className={cn("whitespace-nowrap", over && "text-destructive")}>
              {formatCLP(Math.abs(diff))}
            </span>
            <span className="text-callout font-normal text-ink-2">
              {over ? "sobre" : "bajo"} el ritmo{isToday ? "" : " al cierre"}
            </span>
          </>
        )}
      </figcaption>

      <div
        ref={plotRef}
        role="img"
        aria-label={`${summary}. Gasto del ritmo ${formatCLP(spent)} de ${formatCLP(limit)} disponibles al inicio del período${
          started
            ? `; el ritmo ideal a la fecha era ${formatCLP(Math.round(ideal[k]))}`
            : ""
        }${income > 0 ? `. Ingreso del período ${formatCLP(income)}` : ""}.`}
        className="relative min-h-24 flex-1"
      >
        {w > 0 && h > 0 && (
          <svg
            width={w}
            height={h}
            className="absolute inset-0 overflow-visible"
            aria-hidden
          >
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
              stroke="var(--ink-3)"
              strokeWidth={1.5}
              strokeDasharray="4 4"
            />
            {isToday && (
              <line
                x1={todayX}
                x2={todayX}
                y1={PAD}
                y2={h - PAD}
                stroke="var(--ink-3)"
                strokeWidth={1.5}
                strokeDasharray="1.5 3"
              />
            )}
            {started && (
              <>
                <polygon points={area} fill={tone} fillOpacity={0.06} />
                <polyline
                  points={curve}
                  fill="none"
                  stroke={tone}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
                {/* Hoy (o el cierre): el final de la curva, aro del tono sobre la tarjeta. */}
                <circle
                  cx={x(k)}
                  cy={y(spent)}
                  r={5}
                  fill="var(--card)"
                  stroke={tone}
                  strokeWidth={2.5}
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
        className="relative h-4 text-caption text-ink-3"
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
      <div aria-hidden className="mt-1 flex gap-4 text-caption text-ink-3">
        <span className={cn("flex items-center gap-1", spendingColors(spent, limit).text)}>
          <i className="inline-block w-4 border-t-2" style={{ borderColor: tone }} />
          Gastado
        </span>
        <span className="flex items-center gap-1">
          <i className="inline-block w-4 border-t-2 border-dashed border-ink-3" />
          Ritmo del plan
        </span>
      </div>
    </figure>
  )
}
