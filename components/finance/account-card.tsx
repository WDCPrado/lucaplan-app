import type { AccountDTO } from "@/arch/v1/application/finance-use-cases/finance-read";
import { formatCLP } from "@/lib/finance-format";
import { resolveCardArt } from "@/lib/bank-cards";

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
// marca de agua de fondo; encima, banco, saldo, los últimos 4 dígitos reales y el tipo. Si el
// banco/tipo no tienen arte, cae al color plano.
export function AccountCard({ account, hidden }: { account: AccountDTO; hidden?: boolean }) {
  const art = resolveCardArt(account.bankName, account.accountType);

  return (
    <div
      className="relative flex min-h-40 w-full flex-col justify-between overflow-hidden rounded-2xl p-5 text-white shadow-[0_2px_8px_-2px_rgb(0_0_0/0.1),0_16px_32px_-12px_rgb(0_0_0/0.22)]"
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

      <div className="relative text-lg font-semibold tracking-tight [text-shadow:0_1px_3px_rgb(0_0_0/0.45)]">
        {account.bankName || account.name}
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
