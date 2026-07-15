"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  Check,
  CircleAlert,
  Loader2,
  Mail,
  Plus,
  RefreshCw,
  Unplug,
} from "lucide-react"
import { toast } from "sonner"
import { haptic } from "@/lib/haptics"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DatePicker } from "./transaction-modal"
import type { CurrencyCode } from "@/arch/v1/domain/finance/money"
import type { AccountDTO } from "@/arch/v1/application/finance-use-cases/finance-read"
import { useMoneyInput } from "@/hooks/use-money-input"
import { CARD_VARIANT_BG, resolveCardArt, type CardVariant } from "@/lib/bank-cards"
import { formatMoney } from "@/lib/finance-format"
import { cn } from "@/lib/utils"

export type OutlookStatus = {
  configured: boolean
  activeMethod: "email" | null
  connection: {
    status: string
    emailAddress: string
    pendingSetup: boolean
    lastSyncedAt: string | null
    lastBalanceReconciledAt: string | null
    skippedCount: number
    lastError: string | null
    webhookActive: boolean
  } | null
}

type Candidate =
  | { kind: "checking"; ref: string; last4: string; movementCount: number }
  | {
      kind: "credit_card"
      last4: string
      currencies: ("CLP" | "USD")[]
      movementCount: number
    }
type Scan = {
  candidates: Candidate[]
  totalMessages: number
  expenseCount: number
  internalCount: number
  skippedCount: number
}
export type CheckingForm = {
  ref: string
  cash: number
  hasOverdraft: boolean
  overdraftLimit: number
  overdraftAvailable: number
  movementCount?: number
}
export type CardForm = {
  id: string
  last4: string
  national: boolean
  nationalLimit: number
  nationalAvailable: number
  international: boolean
  internationalLimit: number
  internationalAvailable: number
  movementCount?: number
}

const nowLocal = () => {
  const d = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000)
  return d.toISOString().slice(0, 16)
}

function formsFromAccounts(accounts: AccountDTO[]): {
  checking: CheckingForm | null
  cards: CardForm[]
} {
  const checkingAccount = accounts.find((a) => a.accountType === "checking")
  const checking = checkingAccount
    ? {
        ref: checkingAccount.cardLast4 ?? "",
        cash:
          checkingAccount.buckets?.find((b) => b.kind === "cash")?.available ??
          checkingAccount.balance,
        hasOverdraft: Boolean(
          checkingAccount.buckets?.some((b) => b.kind === "overdraft")
        ),
        overdraftLimit:
          checkingAccount.buckets?.find((b) => b.kind === "overdraft")?.limit ??
          0,
        overdraftAvailable:
          checkingAccount.buckets?.find((b) => b.kind === "overdraft")
            ?.available ?? 0,
      }
    : null
  const cards = accounts
    .filter((a) => a.accountType === "credit_card")
    .map((a) => {
      const national = a.buckets?.find((b) => b.kind === "credit_national")
      const international = a.buckets?.find(
        (b) => b.kind === "credit_international"
      )
      return {
        id: crypto.randomUUID(),
        last4: a.cardLast4 ?? "",
        national: Boolean(national),
        nationalLimit: national?.limit ?? 0,
        nationalAvailable: national?.available ?? 0,
        international: Boolean(international),
        internationalLimit: international?.limit ?? 0,
        internationalAvailable: international?.available ?? 0,
      }
    })
  return { checking, cards }
}

const bucketInvalid = (limit: number, available: number) =>
  available < 0 || available > limit

function snapshotInvalid(checking: CheckingForm | null, cards: CardForm[]) {
  return Boolean(
    (checking?.hasOverdraft &&
      bucketInvalid(checking.overdraftLimit, checking.overdraftAvailable)) ||
      cards.some(
        (card) =>
          (card.national &&
            bucketInvalid(card.nationalLimit, card.nationalAvailable)) ||
          (card.international &&
            bucketInvalid(
              card.internationalLimit,
              card.internationalAvailable
            ))
      )
  )
}

export function OutlookBankConnection({
  status,
  accounts,
  onReload,
}: {
  status: OutlookStatus | null
  accounts: AccountDTO[]
  onReload: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [scan, setScan] = useState<Scan | null>(null)
  const [snapshotAt, setSnapshotAt] = useState(nowLocal)
  const [checking, setChecking] = useState<CheckingForm | null>(null)
  const [cards, setCards] = useState<CardForm[]>([])
  const [reconciling, setReconciling] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)
  const automaticScanStarted = useRef(false)
  const invalidSnapshot = snapshotInvalid(checking, cards)

  async function connect() {
    setBusy(true)
    const res = await fetch("/api/email-connection/connect", { method: "POST" })
    const data = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok || !data.url)
      return toast.error(data.error ?? "No se pudo iniciar Outlook")
    window.location.assign(data.url)
  }

  const detect = useCallback(async () => {
    setBusy(true)
    setScanError(null)
    try {
      const res = await fetch("/api/email-connection/candidates", {
        cache: "no-store",
      })
      const data = (await res.json().catch(() => ({}))) as Scan & {
        error?: string
      }
      if (!res.ok) {
        setScanError(data.error ?? "No se pudo revisar el correo")
        return
      }
      setScan(data)
      const foundChecking = data.candidates.find(
        (c): c is Extract<Candidate, { kind: "checking" }> =>
          c.kind === "checking"
      )
      setChecking(
        foundChecking
          ? {
              ref: foundChecking.ref,
              cash: 0,
              hasOverdraft: false,
              overdraftLimit: 0,
              overdraftAvailable: 0,
              movementCount: foundChecking.movementCount,
            }
          : null
      )
      setCards(
        data.candidates
          .filter(
            (c): c is Extract<Candidate, { kind: "credit_card" }> =>
              c.kind === "credit_card"
          )
          .map((c) => ({
            id: crypto.randomUUID(),
            last4: c.last4,
            national: c.currencies.includes("CLP"),
            nationalLimit: 0,
            nationalAvailable: 0,
            international: c.currencies.includes("USD"),
            internationalLimit: 0,
            internationalAvailable: 0,
            movementCount: c.movementCount,
          }))
      )
    } catch {
      setScanError("No se pudo revisar el correo")
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    if (status?.connection?.pendingSetup && !automaticScanStarted.current) {
      automaticScanStarted.current = true
      void detect()
    }
  }, [status?.connection?.pendingSetup, detect])

  function snapshotBody() {
    return {
      snapshotAt: new Date(snapshotAt).toISOString(),
      checking: checking
        ? {
            ref: checking.ref,
            cash: checking.cash,
            overdraft: checking.hasOverdraft
              ? {
                  limit: checking.overdraftLimit,
                  available: checking.overdraftAvailable,
                }
              : null,
          }
        : null,
      cards: cards.map((card) => ({
        last4: card.last4,
        national: card.national
          ? {
              limit: card.nationalLimit,
              available: card.nationalAvailable,
            }
          : null,
        international: card.international
          ? {
              limit: card.internationalLimit,
              available: card.internationalAvailable,
            }
          : null,
      })),
    }
  }

  async function saveSnapshot(mode: "confirm" | "reconcile") {
    setBusy(true)
    const res = await fetch(`/api/email-connection/${mode}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(snapshotBody()),
    })
    const data = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) {
      haptic("error")
      return toast.error(data.error ?? "No se pudieron guardar los saldos")
    }
    haptic("success")
    toast.success(
      mode === "confirm"
        ? "Outlook conectado y movimientos importados"
        : "Saldos actualizados"
    )
    setReconciling(false)
    await onReload()
  }

  async function refresh() {
    setBusy(true)
    const res = await fetch("/api/email-connection/refresh", { method: "POST" })
    const data = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) {
      haptic("error")
      return toast.error(data.error ?? "No se pudo sincronizar")
    }
    haptic("success")
    toast.success(`${data.created ?? 0} movimientos nuevos`)
    await onReload()
  }

  async function disconnect() {
    setBusy(true)
    haptic("heavy") // acción destructiva confirmada
    const res = await fetch("/api/email-connection/disconnect", {
      method: "POST",
    })
    setBusy(false)
    if (!res.ok) {
      haptic("error")
      return toast.error("No se pudo desconectar Outlook")
    }
    toast.success("Outlook desconectado")
    await onReload()
  }

  if (!status)
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="size-5 animate-spin text-primary" />
      </div>
    )
  if (!status.configured) {
    return (
      <Notice icon={CircleAlert}>
        Outlook aún no está configurado en el servidor. Revisa la guía de
        Microsoft Entra.
      </Notice>
    )
  }
  if (!status.connection) {
    return (
      <div className="space-y-4">
        <Notice icon={Mail}>
          Luca Plan solo leerá notificaciones de Banco de Chile con el permiso
          Mail.Read. No puede enviar ni borrar correos.
        </Notice>
        <Button
          onClick={connect}
          disabled={busy}
          className="h-12 w-full rounded-full"
        >
          {busy ? <Loader2 className="animate-spin" /> : <Mail />} Conectar
          Outlook
        </Button>
      </div>
    )
  }

  if (status.connection.pendingSetup) {
    if (!scan) {
      return (
        <div className="space-y-4">
          <Notice icon={Check}>
            Outlook autorizado como {status.connection.emailAddress}. Aún no se
            creó ninguna cuenta ni movimiento.
          </Notice>
          {scanError ? (
            <>
              <Notice icon={CircleAlert}>{scanError}</Notice>
              <Button
                onClick={detect}
                disabled={busy}
                className="h-12 w-full rounded-full"
              >
                <RefreshCw /> Reintentar revisión
              </Button>
            </>
          ) : (
            <div
              className="flex items-center justify-center gap-2 rounded-2xl border bg-muted/30 p-5 text-sm text-muted-foreground"
              role="status"
            >
              <Loader2 className="size-4 animate-spin text-primary" />
              Revisando notificaciones de este mes…
            </div>
          )}
          <DisconnectOutlookButton
            busy={busy}
            onConfirm={disconnect}
            description="Se eliminará la autorización de Outlook. Aún no se creó ninguna cuenta ni movimiento."
          />
        </div>
      )
    }
    return (
      <div className="space-y-5">
        <div className="rounded-xl bg-muted/50 p-3 text-sm">
          <span className="font-medium">
            {scan.expenseCount} gastos detectados
          </span>
          <span className="text-muted-foreground">
            {" "}
            · {scan.internalCount} ajustes internos · {scan.skippedCount}{" "}
            omitidos
          </span>
        </div>
        <SnapshotForm
          snapshotAt={snapshotAt}
          setSnapshotAt={setSnapshotAt}
          checking={checking}
          setChecking={setChecking}
          cards={cards}
          setCards={setCards}
        />
        <Button
          onClick={() => saveSnapshot("confirm")}
          disabled={busy || invalidSnapshot}
          className="h-12 w-full rounded-full"
        >
          {busy && <Loader2 className="animate-spin" />} Validar e importar
          movimientos
        </Button>
        <DisconnectOutlookButton
          busy={busy}
          onConfirm={disconnect}
          description="Se eliminará la autorización de Outlook. Aún no se creó ninguna cuenta ni movimiento."
        />
      </div>
    )
  }

  if (reconciling) {
    return (
      <div className="space-y-5">
        <SnapshotForm
          snapshotAt={snapshotAt}
          setSnapshotAt={setSnapshotAt}
          checking={checking}
          setChecking={setChecking}
          cards={cards}
          setCards={setCards}
        />
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => setReconciling(false)}
            className="h-11 flex-1 rounded-full"
          >
            Cancelar
          </Button>
          <Button
            onClick={() => saveSnapshot("reconcile")}
            disabled={busy || invalidSnapshot}
            className="h-11 flex-1 rounded-full"
          >
            Guardar saldos
          </Button>
        </div>
      </div>
    )
  }

  const conn = status.connection
  const statusLabel =
    conn.status === "active"
      ? "Autorización activa"
      : conn.status === "reauth_required"
        ? "Requiere reconexión"
        : conn.status === "error"
          ? "Error de sincronización"
          : "Configuración pendiente"
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-success/40 bg-success/5 p-4 text-sm">
        <div className="flex items-center gap-2 font-medium">
          <Check className="size-4 text-success" /> {conn.emailAddress}
        </div>
        <div className="mt-2 space-y-1 text-xs text-muted-foreground">
          <p>Estado: {statusLabel}</p>
          <p>
            Saldo estimado desde{" "}
            {conn.lastBalanceReconciledAt
              ? new Date(conn.lastBalanceReconciledAt).toLocaleString("es-CL")
              : "sin fecha"}
          </p>
          <p>
            Última sincronización:{" "}
            {conn.lastSyncedAt
              ? new Date(conn.lastSyncedAt).toLocaleString("es-CL")
              : "pendiente"}
          </p>
          <p>
            {conn.skippedCount} mensajes omitidos · webhook{" "}
            {conn.webhookActive ? "activo" : "no configurado"}
          </p>
        </div>
      </div>
      {conn.lastError && <Notice icon={CircleAlert}>{conn.lastError}</Notice>}
      {conn.status === "reauth_required" && (
        <Button
          onClick={connect}
          disabled={busy}
          className="h-12 w-full rounded-full"
        >
          <Mail /> Reconectar Outlook
        </Button>
      )}
      <Button
        onClick={refresh}
        disabled={busy}
        className="h-12 w-full rounded-full"
      >
        <RefreshCw /> Sincronizar ahora
      </Button>
      <Button
        variant="outline"
        onClick={() => {
          const forms = formsFromAccounts(accounts)
          setChecking(forms.checking)
          setCards(forms.cards)
          setSnapshotAt(nowLocal())
          setReconciling(true)
        }}
        className="h-11 w-full rounded-full"
      >
        Actualizar saldos
      </Button>
      <DisconnectOutlookButton
        busy={busy}
        onConfirm={disconnect}
        description="Se borrarán las cuentas y los movimientos importados por Outlook. Podrás volver a conectar el banco más adelante."
      />
    </div>
  )
}

function DisconnectOutlookButton({
  busy,
  description,
  onConfirm,
}: {
  busy: boolean
  description: string
  onConfirm: () => void
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          disabled={busy}
          className="h-10 w-full rounded-full text-destructive hover:text-destructive"
        >
          <Unplug /> Desconectar Outlook
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Desconectar Outlook?</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onConfirm}>
            Desconectar
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export function SnapshotForm({
  snapshotAt,
  setSnapshotAt,
  checking,
  setChecking,
  cards,
  setCards,
}: {
  snapshotAt: string
  setSnapshotAt: (value: string) => void
  checking: CheckingForm | null
  setChecking: (value: CheckingForm | null) => void
  cards: CardForm[]
  setCards: (value: CardForm[]) => void
}) {
  const updateCard = (id: string, patch: Partial<CardForm>) =>
    setCards(
      cards.map((card) => (card.id === id ? { ...card, ...patch } : card))
    )
  return (
    <div className="space-y-4">
      <Field label="Fecha y hora del saldo">
        {/* snapshotAt = "YYYY-MM-DDTHH:mm": Calendar+Popover de shadcn para la fecha (regla del
            proyecto: nunca input date nativo) + input de hora al lado. */}
        <div className="flex gap-2">
          <div className="min-w-0 flex-1">
            <DatePicker
              value={snapshotAt.slice(0, 10)}
              onChange={(d) => setSnapshotAt(`${d}T${snapshotAt.slice(11, 16)}`)}
            />
          </div>
          <Input
            type="time"
            value={snapshotAt.slice(11, 16)}
            onChange={(e) => setSnapshotAt(`${snapshotAt.slice(0, 10)}T${e.target.value}`)}
            aria-label="Hora del saldo"
            className="h-11 w-auto shrink-0"
          />
        </div>
      </Field>
      {checking ? (
        <CandidateCard
          variant="debito"
          typeLabel="Débito"
          movementCount={checking.movementCount}
          onRemove={() => setChecking(null)}
          refValue={checking.ref}
          onRef={(ref) => setChecking({ ...checking, ref })}
          refPlaceholder="Cuenta"
          refLabel="Número de cuenta o últimos 4"
        >
          <div>
            <div className="text-xs text-white/75">Saldo propio CLP</div>
            <MoneyField
              currency="CLP"
              value={checking.cash}
              onValue={(cash) => setChecking({ ...checking, cash })}
              ariaLabel="Saldo propio CLP"
              kind="primary"
            />
          </div>
          <div className="space-y-2">
            <CardToggle
              pressed={checking.hasOverdraft}
              onPressed={(hasOverdraft) =>
                setChecking({ ...checking, hasOverdraft })
              }
            >
              Línea de sobregiro
            </CardToggle>
            {checking.hasOverdraft && (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <CardField label="Cupo total">
                    <MoneyField
                      currency="CLP"
                      value={checking.overdraftLimit}
                      onValue={(overdraftLimit) =>
                        setChecking({ ...checking, overdraftLimit })
                      }
                      ariaLabel="Cupo total del sobregiro"
                    />
                  </CardField>
                  <CardField label="Disponible">
                    <MoneyField
                      currency="CLP"
                      value={checking.overdraftAvailable}
                      onValue={(overdraftAvailable) =>
                        setChecking({ ...checking, overdraftAvailable })
                      }
                      ariaLabel="Sobregiro disponible"
                    />
                  </CardField>
                </div>
                <DerivedUsed
                  limit={checking.overdraftLimit}
                  available={checking.overdraftAvailable}
                  currency="CLP"
                />
              </>
            )}
          </div>
        </CandidateCard>
      ) : (
        <Button
          variant="outline"
          onClick={() =>
            setChecking({
              ref: "",
              cash: 0,
              hasOverdraft: false,
              overdraftLimit: 0,
              overdraftAvailable: 0,
            })
          }
          className="h-11 w-full border-dashed"
        >
          <Plus /> Agregar cuenta corriente
        </Button>
      )}
      {cards.map((card) => (
        <CandidateCard
          key={card.id}
          variant="credito"
          typeLabel="Crédito"
          movementCount={card.movementCount}
          onRemove={() => setCards(cards.filter((c) => c.id !== card.id))}
          refValue={card.last4}
          onRef={(last4) => updateCard(card.id, { last4 })}
          refPlaceholder="1234"
          refLabel="Últimos 4 de la tarjeta"
          refMaxLength={4}
        >
          <BucketEditor
            label="Cupo nacional CLP"
            currency="CLP"
            enabled={card.national}
            onEnabled={(national) => updateCard(card.id, { national })}
            limit={card.nationalLimit}
            available={card.nationalAvailable}
            onLimit={(nationalLimit) => updateCard(card.id, { nationalLimit })}
            onAvailable={(nationalAvailable) =>
              updateCard(card.id, { nationalAvailable })
            }
            primary
          />
          <BucketEditor
            label="Cupo internacional USD"
            currency="USD"
            enabled={card.international}
            onEnabled={(international) => updateCard(card.id, { international })}
            limit={card.internationalLimit}
            available={card.internationalAvailable}
            onLimit={(internationalLimit) =>
              updateCard(card.id, { internationalLimit })
            }
            onAvailable={(internationalAvailable) =>
              updateCard(card.id, { internationalAvailable })
            }
          />
        </CandidateCard>
      ))}
      <Button
        variant="outline"
        onClick={() =>
          setCards([
            ...cards,
            {
              id: crypto.randomUUID(),
              last4: "",
              national: true,
              nationalLimit: 0,
              nationalAvailable: 0,
              international: false,
              internationalLimit: 0,
              internationalAvailable: 0,
            },
          ])
        }
        className="h-11 w-full border-dashed"
      >
        <Plus /> Agregar tarjeta
      </Button>
      <p className="text-xs text-muted-foreground">
        Los movimientos previos a este saldo se importan, pero no vuelven a
        descontarse. CLP y USD se mantienen separados.
      </p>
    </div>
  )
}

// Inputs sobre el arte oscuro de la tarjeta: caja translúcida (secundarios) y transparente
// grande (dato principal, misma posición que el saldo/cupo disponible del AccountCard).
// El fondo va inline porque el frost global de [data-slot="input"] (globals.css, fuera de
// @layer) pisa las utilidades de Tailwind; inline le gana sin tocar el design system.
const boxedMoneyInput =
  "h-11 rounded-xl border-white/20 text-base text-white placeholder:text-white/40 selection:bg-white/25 selection:text-white focus-visible:border-white/40 focus-visible:ring-white/20 md:text-base"
const primaryMoneyInput =
  "h-auto rounded-none border-0 px-0 py-0.5 text-3xl font-semibold text-white shadow-none placeholder:text-white/30 selection:bg-white/25 selection:text-white focus-visible:ring-0 md:text-3xl [text-shadow:0_1px_3px_rgb(0_0_0/0.45)]"
const boxedInputStyle: React.CSSProperties = {
  backgroundColor: "rgb(255 255 255 / 0.12)",
  backdropFilter: "none",
  WebkitBackdropFilter: "none",
}
const primaryInputStyle: React.CSSProperties = {
  backgroundColor: "transparent",
  backdropFilter: "none",
  WebkitBackdropFilter: "none",
}

// Input de monto que reutiliza el formateo vigente (CLP entero agrupado, USD con coma y 2
// decimales). `value` solo inicializa; el estado vive en useMoneyInput y se reporta por onValue.
function MoneyField({
  currency,
  value,
  onValue,
  ariaLabel,
  kind = "boxed",
  className,
}: {
  currency: CurrencyCode
  value: number
  onValue: (v: number) => void
  ariaLabel: string
  kind?: "boxed" | "primary"
  className?: string
}) {
  const money = useMoneyInput(currency, value)
  return (
    <Input
      inputMode="numeric"
      value={money.display}
      placeholder={currency === "USD" ? "0,00" : "0"}
      aria-label={ariaLabel}
      onChange={(e) => onValue(money.onChange(e.target.value))}
      style={kind === "primary" ? primaryInputStyle : boxedInputStyle}
      className={cn(
        "tabular",
        kind === "primary" ? primaryMoneyInput : boxedMoneyInput,
        className
      )}
    />
  )
}

// Cupo de tarjeta de crédito (nacional CLP / internacional USD): toggle del bucket y, si está
// activo, disponible como dato principal + cupo total; el usado se deriva y solo se muestra.
function BucketEditor({
  label,
  currency,
  enabled,
  onEnabled,
  limit,
  available,
  onLimit,
  onAvailable,
  primary,
}: {
  label: string
  currency: CurrencyCode
  enabled: boolean
  onEnabled: (v: boolean) => void
  limit: number
  available: number
  onLimit: (v: number) => void
  onAvailable: (v: number) => void
  primary?: boolean
}) {
  return (
    <div className="space-y-2">
      <CardToggle pressed={enabled} onPressed={onEnabled}>
        {label}
      </CardToggle>
      {enabled && (
        <>
          <div>
            <div className="text-xs text-white/75">Disponible</div>
            <MoneyField
              currency={currency}
              value={available}
              onValue={onAvailable}
              ariaLabel={`Disponible · ${label}`}
              kind="primary"
              className={primary ? undefined : "text-xl md:text-xl"}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <CardField label="Cupo total">
              <MoneyField
                currency={currency}
                value={limit}
                onValue={onLimit}
                ariaLabel={`Cupo total · ${label}`}
              />
            </CardField>
          </div>
          <DerivedUsed limit={limit} available={available} currency={currency} />
        </>
      )}
    </div>
  )
}

// Usado derivado de total − disponible (regla del snapshot); nunca se ingresa a mano.
function DerivedUsed({
  limit,
  available,
  currency,
}: {
  limit: number
  available: number
  currency: CurrencyCode
}) {
  if (bucketInvalid(limit, available))
    return (
      <p className="text-xs font-medium text-red-300">
        El disponible debe estar entre cero y el cupo total
      </p>
    )
  const used = limit - available
  if (used <= 0) return null
  return (
    <p className="tabular text-xs text-red-300">
      Usado −{formatMoney(used, currency)}
    </p>
  )
}

function CardToggle({
  pressed,
  onPressed,
  children,
}: {
  pressed: boolean
  onPressed: (v: boolean) => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={() => onPressed(!pressed)}
      className={cn(
        "flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors",
        pressed
          ? "border-white/30 bg-white/20 text-white"
          : "border-white/15 text-white/60 hover:text-white/85"
      )}
    >
      {pressed && <Check className="size-3" />}
      {children}
    </button>
  )
}

function CardField({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <label className="block space-y-1">
      <span className="block text-xs text-white/75">{label}</span>
      {children}
    </label>
  )
}

// Superficie editable con el mismo arte y jerarquía del AccountCard del dashboard: banco arriba,
// datos al centro, últimos 4 + tipo abajo; el isotipo del banco queda como marca de agua.
function CandidateCard({
  variant,
  typeLabel,
  movementCount,
  onRemove,
  refValue,
  onRef,
  refPlaceholder,
  refLabel,
  refMaxLength,
  children,
}: {
  variant: CardVariant
  typeLabel: string
  movementCount?: number
  onRemove: () => void
  refValue: string
  onRef: (v: string) => void
  refPlaceholder: string
  refLabel: string
  refMaxLength?: number
  children: React.ReactNode
}) {
  const art = resolveCardArt(
    "Banco de Chile",
    variant === "debito" ? "checking" : "credit_card"
  )
  return (
    <div
      className="relative flex min-h-40 w-full flex-col gap-4 overflow-hidden rounded-2xl p-5 text-white shadow-[0_1px_2px_rgb(0_0_0/0.08),0_8px_20px_-10px_rgb(0_0_0/0.25)]"
      style={{ background: CARD_VARIANT_BG[variant] }}
    >
      {art && (
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
          Banco de Chile
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="text-xs font-medium text-white/60 transition-colors hover:text-red-300"
        >
          Quitar
        </button>
      </div>
      <div className="relative flex-1 space-y-3">{children}</div>
      <div className="relative flex items-center justify-between gap-2 text-sm text-white/85">
        <span className="flex items-center gap-1.5">
          <span className="tracking-widest">••••</span>
          <Input
            inputMode="numeric"
            maxLength={refMaxLength}
            value={refValue}
            placeholder={refPlaceholder}
            aria-label={refLabel}
            onChange={(e) => onRef(e.target.value)}
            style={boxedInputStyle}
            className="tabular h-8 w-24 rounded-lg border-white/20 px-2 text-sm tracking-widest text-white placeholder:text-white/40 selection:bg-white/25 selection:text-white focus-visible:border-white/40 focus-visible:ring-white/20"
          />
        </span>
        <span className="shrink-0">
          {typeLabel}
          {movementCount ? ` · ${movementCount} movs` : ""}
        </span>
      </div>
    </div>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium">{label}</span>
      {children}
    </label>
  )
}

function Notice({
  icon: Icon,
  children,
}: {
  icon: typeof Mail
  children: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-2 rounded-xl border bg-muted/30 p-3 text-sm text-muted-foreground">
      <Icon className="mt-0.5 size-4 shrink-0 text-primary" />
      <span>{children}</span>
    </div>
  )
}
