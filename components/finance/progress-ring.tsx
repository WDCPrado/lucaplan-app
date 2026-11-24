import { spendingColors } from "@/lib/spending-colors"

// Anillo de progreso en SVG. `percent` puede pasar de 100 (el arco se capa a 100, el color
// refleja el tercio del tope consumido, igual que las barras de presupuesto).
export function ProgressRing({
  percent,
  committedPercent = 0,
  size = 96,
  stroke = 7,
  children,
}: {
  percent: number
  // Gasto COMPROMETIDO (recurrentes del mes aún no cobradas): arco tenue que continúa al gastado,
  // nunca sumado a él. Deja ver "esto ya está reservado" sin mentir sobre lo gastado.
  committedPercent?: number
  status: string
  size?: number
  stroke?: number
  children?: React.ReactNode
}) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const clamped = Math.max(0, Math.min(100, percent))
  const dash = (clamped / 100) * c
  // El comprometido ocupa solo lo que queda de vuelta, para no dar dos veces al círculo.
  const committed = Math.max(0, Math.min(100 - clamped, committedPercent))
  const committedDash = (committed / 100) * c

  return (
    <div
      className="relative grid place-items-center"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--muted)"
          strokeWidth={stroke}
        />
        {committedDash > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="var(--committed)"
            strokeWidth={stroke}
            strokeDasharray={`${committedDash} ${c}`}
            strokeDashoffset={-dash}
          />
        )}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={spendingColors(percent, 100).stroke}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c}`}
        />
      </svg>
      <div className="absolute grid place-items-center">{children}</div>
    </div>
  )
}
