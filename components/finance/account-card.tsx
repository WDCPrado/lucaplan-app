import type { AccountDTO } from "@/arch/v1/application/finance-use-cases/finance-read"
import { formatCLP, formatMoney } from "@/lib/finance-format"
import { CARD_VARIANT_BG, resolveCardArt } from "@/lib/bank-cards"
import { cn } from "@/lib/utils"
import { SyncStatusLine } from "./sync-status-line"

const TYPE_LABEL: Record<string, string> = {
  checking: "Débito",
  savings: "Ahorro",
  credit_card: "Crédito",
  credit_line: "Línea",
  wallet: "Billetera",
  investment: "Inversión",
}

// Tarjeta de una cuenta: nuestro estilo (gradiente por variante) + el isotipo del banco como
// marca de agua de fondo; encima, banco, saldo, los últimos 4 dígitos reales y el tipo. Clickable
// (opcional) para abrir su detalle. Las conectadas muestran el distintivo "Conectado".
export function AccountCard({
  account,
  hidden,
  onClick,
}: {
  account: AccountDTO
  hidden?: boolean
  onClick?: () => void
}) {
  const art = resolveCardArt(account.bankName, account.accountType)
  const connected =
    account.provider === "fintoc" || account.provider === "bancochile"
  const buckets = account.buckets ?? []
  const cash = buckets.find((b) => b.kind === "cash")
  const overdraft = buckets.find((b) => b.kind === "overdraft")
  const nat = buckets.find((b) => b.kind === "credit_national")
  const intl = buckets.find((b) => b.kind === "credit_international")
  const isCredit = account.accountType === "credit_card"
  const estimatedSince =
    account.connectionMethod === "email"
      ? buckets.find((b) => b.asOf)?.asOf
      : null

  return (
    <div
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault()
                onClick()
              }
            }
          : undefined
      }
      className={cn(
        // Sombra corta y contenida: una larga se recorta contra el borde del carrusel (overflow-x)
        "relative flex min-h-40 w-full flex-col justify-between overflow-hidden rounded-2xl p-5 text-white shadow-[0_1px_2px_rgb(0_0_0/0.08),0_8px_20px_-10px_rgb(0_0_0/0.25)]",
        onClick && "cursor-pointer transition-transform hover:-translate-y-0.5"
      )}
      style={
        art
          ? { background: CARD_VARIANT_BG[art.variant] }
          : { background: account.color ?? "var(--primary)" }
      }
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

      {isCredit && (nat || intl) ? (
        // Tarjeta de crédito conectada: cupos nacional (CLP) e internacional (USD) por separado.
        <div className="relative space-y-1">
          {nat && (
            <div>
              <div className="text-xs text-white/75">Cupo nacional</div>
              <div className="tabular text-2xl font-semibold [text-shadow:0_1px_3px_rgb(0_0_0/0.45)]">
                {hidden ? "••••••" : formatCLP(nat.available)}{" "}
                <span className="text-xs font-normal text-white/60">disp</span>
              </div>
              {nat.used > 0 && (
                <div className="tabular text-xs text-red-300">
                  Usado −{hidden ? "••••" : formatCLP(nat.used)}
                </div>
              )}
            </div>
          )}
          {intl && (
            <div className="text-xs text-white/85">
              <span className="text-white/60">USD</span>{" "}
              <span className="tabular">
                {hidden ? "••" : formatMoney(intl.available, "USD")}
              </span>{" "}
              disp
              {intl.used > 0 && (
                <span className="tabular text-red-300">
                  {" "}
                  · usado {formatMoney(intl.used, "USD")}
                </span>
              )}
            </div>
          )}
        </div>
      ) : (
        // Cuenta corriente (cash + sobregiro) o cuenta manual (saldo simple).
        <div className="relative">
          <div className="text-xs text-white/75">Saldo {account.currency}</div>
          <div
            className={cn(
              "tabular text-3xl font-semibold [text-shadow:0_1px_3px_rgb(0_0_0/0.45)]",
              (cash ? cash.available : account.balance) < 0 && "text-red-300"
            )}
          >
            {hidden
              ? "••••••"
              : formatCLP(cash ? cash.available : account.balance)}
          </div>
          {overdraft && overdraft.limit > 0 && (
            <div className="tabular mt-0.5 text-xs text-white/70">
              Sobregiro:{" "}
              {overdraft.used > 0 ? (
                <span className="text-red-300">
                  usado −{hidden ? "••••" : formatCLP(overdraft.used)}
                </span>
              ) : (
                <span>
                  {hidden ? "••••" : formatCLP(overdraft.available)} disp
                </span>
              )}
            </div>
          )}
        </div>
      )}

      <div className="relative space-y-1.5">
        <div className="flex items-center justify-between gap-2 text-sm text-white/85">
          <span className="tabular truncate tracking-widest">
            {account.cardLast4 ? `•••• ${account.cardLast4}` : account.name}
          </span>
          <span className="shrink-0">
            {TYPE_LABEL[account.accountType] ?? account.accountType}
          </span>
        </div>
        {estimatedSince ? (
          <div className="text-[10px] text-white/65">
            Saldo estimado desde{" "}
            {new Date(estimatedSince).toLocaleDateString("es-CL")}
          </div>
        ) : connected && account.lastSyncedAt ? (
          <SyncStatusLine lastSyncedAt={account.lastSyncedAt} />
        ) : null}
      </div>
    </div>
  )
}
