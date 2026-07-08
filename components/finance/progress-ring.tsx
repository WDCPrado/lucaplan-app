import { statusVar } from "@/lib/finance-format";

// Anillo de progreso en SVG. `percent` puede pasar de 100 (el arco se capa a 100, el color
// refleja el estado). El color sale del estado de categoría (bueno/moderado/completado/excedido).
export function ProgressRing({
  percent,
  status,
  size = 96,
  stroke = 7,
  children,
}: {
  percent: number;
  status: string;
  size?: number;
  stroke?: number;
  children?: React.ReactNode;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, percent));
  const dash = (clamped / 100) * c;

  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--muted)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={statusVar(status)}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c}`}
        />
      </svg>
      <div className="absolute grid place-items-center">{children}</div>
    </div>
  );
}
