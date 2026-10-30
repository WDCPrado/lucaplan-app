import type { AccountDTO } from "@/arch/v1/application/finance-use-cases/finance-read"
import type { CurrencyCode } from "@/arch/v1/domain/finance/money"
import { formatCLP, formatMoney } from "@/lib/finance-format"
import { CARD_VARIANT_BG, resolveCardArt } from "@/lib/bank-cards"
import { cn } from "@/lib/utils"
import { SyncStatusLine } from "./sync-status-line"

// Barra de cupo DISPONIBLE (cupo de crédito o línea de sobregiro): llena = cupo intacto, se vacía a
// medida que se usa, como una batería. Así "completo" se ve verde y lleno; agotado, corto y rojo.
// Color por los mismos 4 cortes de cuartil que `quartileVar` (el lenguaje de los presupuestos), pero
// con los tokens --card-art-*: tonos claros que se leen sobre el arte (var(--primary) desaparecería
// contra el gradiente azul del banco y var(--success) contra el verde). Recibe el % USADO.
function CapacityBar({ usedPct }: { usedPct: number }) {
  const pct = Math.min(100, Math.max(0, usedPct))
  const color =
    pct < 25
      ? "bg-card-art-ok"
      : pct < 50
        ? "bg-card-art-info"
        : pct < 75
          ? "bg-card-art-warn"
          : "bg-card-art-danger"
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
// (opcional) para abrir su detalle.
export function AccountCard({
  account,
  showConnected = false,
  onClick,
}: {
  account: AccountDTO
  showConnected?: boolean // distintivo «Conectado»: solo la landing (en la app lo dice la línea de sincronización)
  onClick?: () => void
}) {
  const art = resolveCardArt(account.bankName, account.accountType)
  // Conectada = importada por un banco, cualquiera sea. Comparar contra un banco concreto
  // dejaría las cuentas de los demás como editables (y sus movimientos, borrables a mano).
  const connected = account.provider !== "manual"
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
        // Sin sombra: la tarjeta se separa del fondo grouped por su propio color, como en Wallet.
        "account-card relative flex min-h-40 w-full flex-col justify-between overflow-hidden rounded-xl p-5 text-white",
        onClick &&
          "cursor-pointer transition-transform duration-150 ease-out hover:-translate-y-0.5 active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100"
      )}
      style={
        art
          ? { background: CARD_VARIANT_BG[art.variant] }
          : { background: account.color ?? CARD_VARIANT_BG.debito }
      }
    >
      {art && (
        // Monograma propio del banco, grande y tenue, a la derecha, como marca de agua (sin logo de terceros).
        <span
          aria-hidden
          // Excepción a la escala tipográfica: es arte decorativo (aria-hidden), no texto que se lee.
          className="pointer-events-none absolute top-1/2 -right-3 -translate-y-1/2 text-8xl leading-none font-bold text-white/12 select-none"
        >
          {art.monogram}
        </span>
      )}

      <div className="relative flex items-start justify-between gap-2">
        <div className="text-headline font-semibold [text-shadow:0_1px_3px_rgb(0_0_0/0.45)]">
          {account.bankName || account.name}
        </div>
        {showConnected && connected && (
          <span className="flex shrink-0 items-center gap-1 rounded-lg bg-white/15 px-2 py-0.5 text-caption font-medium">
            <span aria-hidden className="size-1.5 rounded-full bg-card-art-ok" />
            Conectado
          </span>
        )}
      </div>

      {isCredit && primary ? (
        // Crédito: UN héroe (el cupo disponible principal) + el otro cupo como chip, y el uso como
        // barra + frase. Misma gramática que la rama corriente: etiqueta → número grande → contexto.
        <div className="relative">
          <div className="text-caption text-white/85">Disponible</div>
          <div className="tabular text-title-1 font-bold [text-shadow:0_1px_3px_rgb(0_0_0/0.45)]">
            {formatMoney(primary.available, primary.currency as CurrencyCode)}
          </div>
          {/* El cupo secundario va DEBAJO, no al lado: en la misma línea, dos montos largos
              (CLP de siete dígitos + USD) se salen del ancho de la tarjeta. */}
          {chip && (
            <span className="tabular mt-1.5 inline-block rounded-lg bg-white/15 px-2 py-0.5 text-caption">
              {formatMoney(chip.available, chip.currency as CurrencyCode)}
            </span>
          )}
          {primary.limit > 0 && (
            <>
              <CapacityBar usedPct={usedPct} />
              <div className="tabular mt-1 text-caption text-white/85">
                Usado{" "}
                {formatMoney(
                      primary.used,
                      primary.currency as CurrencyCode
                    )}{" "}
                de{" "}
                {formatMoney(
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
          <div
            className={cn(
              "tabular text-title-1 font-bold [text-shadow:0_1px_3px_rgb(0_0_0/0.45)]",
              (cash ? cash.available : account.balance) < 0 && "text-card-art-danger"
            )}
          >
            {formatCLP(cash ? cash.available : account.balance)}
          </div>
          {/* Solo si la cuenta TIENE línea de sobregiro (limit > 0): mismo lenguaje que el cupo. */}
          {overdraft && overdraft.limit > 0 && (
            <>
              <CapacityBar usedPct={(overdraft.used / overdraft.limit) * 100} />
              <div className="tabular mt-1 text-caption text-white/85">
                {overdraft.used > 0 ? (
                  <>
                    Sobregiro usado{" "}
                    {formatCLP(overdraft.used)} de{" "}
                    {formatCLP(overdraft.limit)}
                  </>
                ) : (
                  <>
                    Sobregiro {formatCLP(overdraft.limit)}{" "}
                    disponible
                  </>
                )}
              </div>
            </>
          )}
        </div>
      )}

      <div className="relative space-y-1.5">
        <div className="flex items-center justify-between gap-2 text-footnote text-white/85">
          <span className="tabular truncate tracking-widest">
            {account.cardLast4 ? `•••• ${account.cardLast4}` : account.name}
          </span>
          <span className="shrink-0">
            {TYPE_LABEL[account.accountType] ?? account.accountType}
          </span>
        </div>
        {estimatedSince ? (
          <div className="text-caption text-white/85">
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
