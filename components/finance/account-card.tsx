import type { AccountDTO } from "@/arch/v1/application/finance-use-cases/finance-read"
import type { CurrencyCode } from "@/arch/v1/domain/finance/money"
import { formatCLP, formatMoney } from "@/lib/finance-format"
import { CARD_VARIANT_BG, resolveCardArt } from "@/lib/bank-cards"
import { cn } from "@/lib/utils"
import { SyncStatusLine } from "./sync-status-line"

// Barra de cupo DISPONIBLE (cupo de crédito o línea de sobregiro): llena = cupo intacto, se vacía a
// medida que se usa, como una batería. Así "completo" se ve verde y lleno; agotado, corto y rojo.
// Color por los mismos 4 cortes de cuartil que `quartileVar` (el lenguaje de los presupuestos), pero
// con tonos claros de Tailwind: sobre el arte de la tarjeta, var(--primary) desaparecería contra el
// gradiente azul del banco y var(--success) contra el verde. Recibe el % USADO.
function CapacityBar({ usedPct }: { usedPct: number }) {
  const pct = Math.min(100, Math.max(0, usedPct))
  const color =
    pct < 25
      ? "bg-emerald-300"
      : pct < 50
        ? "bg-sky-300"
        : pct < 75
          ? "bg-amber-300"
          : "bg-red-300"
  return (
    <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/25">
      <div
        className={cn(
          "h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none",
          color
        )}
        style={{ width: `${100 - pct}%` }}
      />
    </div>
  )
}

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
  const connected = account.provider === "bancochile"
  const buckets = account.buckets ?? []
  const cash = buckets.find((b) => b.kind === "cash")
  const overdraft = buckets.find((b) => b.kind === "overdraft")
  const nat = buckets.find((b) => b.kind === "credit_national")
  const intl = buckets.find((b) => b.kind === "credit_international")
  const isCredit = account.accountType === "credit_card"
  // Cupo protagonista: el nacional (CLP) si existe; si la tarjeta solo tiene internacional, ese.
  // El otro queda como chip — es dato de consulta, no de decisión diaria.
  const primary = nat ?? intl
  const chip = nat && intl ? intl : null
  const usedPct =
    primary && primary.limit > 0 ? (primary.used / primary.limit) * 100 : 0
  // El más antiguo acota de verdad desde cuándo se estima (los buckets sincronizan por separado).
  const estimatedSince =
    account.connectionMethod === "email"
      ? buckets
          .map((b) => b.asOf)
          .filter((d): d is string => !!d)
          .sort()[0]
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
        // Monograma propio del banco, grande y tenue, a la derecha, como marca de agua (sin logo de terceros).
        <span
          aria-hidden
          className="pointer-events-none absolute top-1/2 -right-3 -translate-y-1/2 text-8xl leading-none font-bold text-white/12 select-none"
        >
          {art.monogram}
        </span>
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

      {isCredit && primary ? (
        // Crédito: UN héroe (el cupo disponible principal) + el otro cupo como chip, y el uso como
        // barra + frase. Misma gramática que la rama corriente: etiqueta → número grande → contexto.
        <div className="relative">
          <div className="text-xs text-white/75">Disponible</div>
          <div className="flex items-baseline gap-2">
            <div className="tabular text-3xl font-semibold [text-shadow:0_1px_3px_rgb(0_0_0/0.45)]">
              {hidden
                ? "••••••"
                : formatMoney(
                    primary.available,
                    primary.currency as CurrencyCode
                  )}
            </div>
            {chip && (
              <span className="tabular shrink-0 rounded-full bg-white/15 px-2 py-0.5 text-xs backdrop-blur">
                {hidden
                  ? "••••"
                  : formatMoney(chip.available, chip.currency as CurrencyCode)}
              </span>
            )}
          </div>
          {primary.limit > 0 && (
            <>
              <CapacityBar usedPct={usedPct} />
              <div className="tabular mt-1 text-xs text-white/70">
                Usado{" "}
                {hidden
                  ? "••••"
                  : formatMoney(
                      primary.used,
                      primary.currency as CurrencyCode
                    )}{" "}
                de{" "}
                {hidden
                  ? "••••"
                  : formatMoney(
                      primary.limit,
                      primary.currency as CurrencyCode
                    )}
              </div>
            </>
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
          {/* Solo si la cuenta TIENE línea de sobregiro (limit > 0): mismo lenguaje que el cupo. */}
          {overdraft && overdraft.limit > 0 && (
            <>
              <CapacityBar usedPct={(overdraft.used / overdraft.limit) * 100} />
              <div className="tabular mt-1 text-xs text-white/70">
                {overdraft.used > 0 ? (
                  <>
                    Sobregiro usado{" "}
                    {hidden ? "••••" : formatCLP(overdraft.used)} de{" "}
                    {hidden ? "••••" : formatCLP(overdraft.limit)}
                  </>
                ) : (
                  <>
                    Sobregiro {hidden ? "••••" : formatCLP(overdraft.limit)}{" "}
                    disponible
                  </>
                )}
              </div>
            </>
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
