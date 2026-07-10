import type { AccountDTO } from "@/arch/v1/application/finance-use-cases/finance-read";
import { formatCLP } from "@/lib/finance-format";
import { resolveCardArt } from "@/lib/bank-cards";
import { cn } from "@/lib/utils";

const TYPE_LABEL: Record<string, string> = {
  checking: "Débito",
  savings: "Ahorro",
  credit_card: "Crédito",
  credit_line: "Línea",
  wallet: "Billetera",
  investment: "Inversión",
};

// Fondo por variante: azul (débito) / negro (crédito). Estilo propio, no una foto de tarjeta.
const VARIANT_BG: Record<string, string> = {
  debito: "linear-gradient(135deg, #0a2a6b 0%, #0b3f9e 55%, #0850c0 100%)",
  credito: "linear-gradient(135deg, #0a0a0d 0%, #17171c 55%, #26262d 100%)",
};

// Tarjeta de una cuenta: nuestro estilo (gradiente por variante) + el isotipo del banco como
// marca de agua de fondo; encima, banco, saldo, los últimos 4 dígitos reales y el tipo. Clickable
// (opcional) para abrir su detalle. Las conectadas muestran el distintivo "Conectado".
export function AccountCard({ account, hidden, onClick }: { account: AccountDTO; hidden?: boolean; onClick?: () => void }) {
  const art = resolveCardArt(account.bankName, account.accountType);
  const connected = account.provider === "fintoc";

  return (
    <div
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      className={cn(
        // Sombra corta y contenida: una larga se recorta contra el borde del carrusel (overflow-x)
        "relative flex min-h-40 w-full flex-col justify-between overflow-hidden rounded-2xl p-5 text-white shadow-[0_1px_2px_rgb(0_0_0/0.08),0_8px_20px_-10px_rgb(0_0_0/0.25)]",
        onClick && "cursor-pointer transition-transform hover:-translate-y-0.5",
      )}
      style={art ? { background: VARIANT_BG[art.variant] } : { background: account.color ?? "var(--primary)" }}
    >
      {art && (
        // Isotipo del banco teñido de blanco, grande y tenue, a la derecha, como marca de agua.
        // eslint-disable-next-line @next/next/no-img-element -- decorativo de fondo, no LCP
        <img
          src={art.icon}
          alt=""
          aria-hidden
          className="pointer-events-none absolute top-1/2 -right-4 h-36 w-auto -translate-y-1/2 opacity-[0.16] filter-[brightness(0)_invert(1)]"
        />
      )}

      <div className="relative flex items-start justify-between gap-2">
        <div className="text-lg font-semibold tracking-tight [text-shadow:0_1px_3px_rgb(0_0_0/0.45)]">
          {account.bankName || account.name}
        </div>
        {connected && (
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-medium backdrop-blur">
            <span className="size-1.5 rounded-full bg-emerald-400" />
            Conectado
          </span>
        )}
      </div>

      <div className="relative">
        <div className="text-xs text-white/75">Saldo {account.currency}</div>
        <div className="tabular text-3xl font-semibold [text-shadow:0_1px_3px_rgb(0_0_0/0.45)]">
          {hidden ? "••••••" : formatCLP(account.balance)}
        </div>
      </div>

      <div className="relative flex items-center justify-between gap-2 text-sm text-white/85">
        <span className="tabular truncate tracking-widest">
          {account.cardLast4 ? `•••• ${account.cardLast4}` : account.name}
        </span>
        <span className="shrink-0">{TYPE_LABEL[account.accountType] ?? account.accountType}</span>
      </div>
    </div>
  );
}
