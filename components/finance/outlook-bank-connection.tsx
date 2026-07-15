"use client"

import { useState } from "react"
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
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { AccountDTO } from "@/arch/v1/application/finance-use-cases/finance-read"

export type OutlookStatus = {
  configured: boolean
  activeMethod: "scraper" | "email" | null
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
type CheckingForm = {
  ref: string
  cash: string
  hasOverdraft: boolean
  overdraftLimit: string
  overdraftUsed: string
  movementCount?: number
}
type CardForm = {
  last4: string
  national: boolean
  nationalLimit: string
  nationalUsed: string
  international: boolean
  internationalLimit: string
  internationalUsed: string
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
        cash: String(
          checkingAccount.buckets?.find((b) => b.kind === "cash")?.available ??
            checkingAccount.balance
        ),
        hasOverdraft: Boolean(
          checkingAccount.buckets?.some((b) => b.kind === "overdraft")
        ),
        overdraftLimit: String(
          checkingAccount.buckets?.find((b) => b.kind === "overdraft")?.limit ??
            0
        ),
        overdraftUsed: String(
          checkingAccount.buckets?.find((b) => b.kind === "overdraft")?.used ??
            0
        ),
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
        last4: a.cardLast4 ?? "",
        national: Boolean(national),
        nationalLimit: String(national?.limit ?? 0),
        nationalUsed: String(national?.used ?? 0),
        international: Boolean(international),
        internationalLimit: String(international?.limit ?? 0),
        internationalUsed: String(international?.used ?? 0),
      }
    })
  return { checking, cards }
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

  async function connect() {
    setBusy(true)
    const res = await fetch("/api/email-connection/connect", { method: "POST" })
    const data = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok || !data.url)
      return toast.error(data.error ?? "No se pudo iniciar Outlook")
    window.location.assign(data.url)
  }

  async function detect() {
    setBusy(true)
    const res = await fetch("/api/email-connection/candidates", {
      cache: "no-store",
    })
    const data = (await res.json().catch(() => ({}))) as Scan & {
      error?: string
    }
    setBusy(false)
    if (!res.ok)
      return toast.error(data.error ?? "No se pudo revisar el correo")
    setScan(data)
    const foundChecking = data.candidates.find(
      (c): c is Extract<Candidate, { kind: "checking" }> =>
        c.kind === "checking"
    )
    setChecking(
      foundChecking
        ? {
            ref: foundChecking.ref,
            cash: "",
            hasOverdraft: false,
            overdraftLimit: "",
            overdraftUsed: "",
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
          last4: c.last4,
          national: c.currencies.includes("CLP"),
          nationalLimit: "",
          nationalUsed: "",
          international: c.currencies.includes("USD"),
          internationalLimit: "",
          internationalUsed: "",
          movementCount: c.movementCount,
        }))
    )
  }

  function snapshotBody() {
    return {
      snapshotAt: new Date(snapshotAt).toISOString(),
      checking: checking
        ? {
            ref: checking.ref,
            cash: Number(checking.cash),
            overdraft: checking.hasOverdraft
              ? {
                  limit: Number(checking.overdraftLimit),
                  used: Number(checking.overdraftUsed),
                }
              : null,
          }
        : null,
      cards: cards.map((card) => ({
        last4: card.last4,
        national: card.national
          ? {
              limit: Number(card.nationalLimit),
              used: Number(card.nationalUsed),
            }
          : null,
        international: card.international
          ? {
              limit: Number(card.internationalLimit),
              used: Number(card.internationalUsed),
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
    if (!res.ok)
      return toast.error(data.error ?? "No se pudieron guardar los saldos")
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
    if (!res.ok) return toast.error(data.error ?? "No se pudo sincronizar")
    toast.success(`${data.created ?? 0} movimientos nuevos`)
    await onReload()
  }

  async function disconnect() {
    if (
      !window.confirm(
        "Se borrarán las cuentas y movimientos importados por Outlook. ¿Continuar?"
      )
    )
      return
    setBusy(true)
    const res = await fetch("/api/email-connection/disconnect", {
      method: "POST",
    })
    setBusy(false)
    if (!res.ok) return toast.error("No se pudo desconectar Outlook")
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
  if (status.activeMethod === "scraper" && !status.connection) {
    return (
      <Notice icon={CircleAlert}>
        Banco de Chile ya usa el scraper. Desconéctalo antes de cambiar a
        Outlook.
      </Notice>
    )
  }

  if (!status.connection) {
    return (
      <div className="space-y-4">
        <Notice icon={Mail}>
          LucaPlan solo leerá notificaciones de Banco de Chile con el permiso
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
          <Button
            onClick={detect}
            disabled={busy}
            className="h-12 w-full rounded-full"
          >
            {busy ? <Loader2 className="animate-spin" /> : <Mail />} Revisar
            notificaciones de este mes
          </Button>
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
          disabled={busy}
          className="h-12 w-full rounded-full"
        >
          {busy && <Loader2 className="animate-spin" />} Validar e importar
          movimientos
        </Button>
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
            disabled={busy}
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
      <Button
        variant="ghost"
        onClick={disconnect}
        disabled={busy}
        className="h-10 w-full rounded-full text-destructive hover:text-destructive"
      >
        <Unplug /> Desconectar Outlook
      </Button>
    </div>
  )
}

function SnapshotForm({
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
  const updateCard = (index: number, patch: Partial<CardForm>) =>
    setCards(
      cards.map((card, i) => (i === index ? { ...card, ...patch } : card))
    )
  return (
    <div className="space-y-4">
      <Field label="Fecha y hora del saldo">
        <Input
          type="datetime-local"
          value={snapshotAt}
          onChange={(e) => setSnapshotAt(e.target.value)}
        />
      </Field>
      {checking ? (
        <div className="space-y-3 rounded-xl border p-4">
          <div className="flex items-center justify-between">
            <span className="font-medium">
              Cuenta corriente{" "}
              {checking.movementCount
                ? `· ${checking.movementCount} movimientos`
                : ""}
            </span>
            <button
              className="text-xs text-destructive"
              onClick={() => setChecking(null)}
            >
              Quitar
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Número o últimos 4">
              <Input
                inputMode="numeric"
                value={checking.ref}
                onChange={(e) =>
                  setChecking({ ...checking, ref: e.target.value })
                }
              />
            </Field>
            <Field label="Saldo propio CLP">
              <Input
                type="number"
                min="0"
                value={checking.cash}
                onChange={(e) =>
                  setChecking({ ...checking, cash: e.target.value })
                }
              />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={checking.hasOverdraft}
              onChange={(e) =>
                setChecking({ ...checking, hasOverdraft: e.target.checked })
              }
            />{" "}
            Tiene sobregiro
          </label>
          {checking.hasOverdraft && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Cupo sobregiro">
                <Input
                  type="number"
                  min="0"
                  value={checking.overdraftLimit}
                  onChange={(e) =>
                    setChecking({ ...checking, overdraftLimit: e.target.value })
                  }
                />
              </Field>
              <Field label="Sobregiro usado">
                <Input
                  type="number"
                  min="0"
                  value={checking.overdraftUsed}
                  onChange={(e) =>
                    setChecking({ ...checking, overdraftUsed: e.target.value })
                  }
                />
              </Field>
            </div>
          )}
        </div>
      ) : (
        <Button
          variant="outline"
          onClick={() =>
            setChecking({
              ref: "",
              cash: "",
              hasOverdraft: false,
              overdraftLimit: "",
              overdraftUsed: "",
            })
          }
          className="w-full border-dashed"
        >
          <Plus /> Agregar cuenta corriente
        </Button>
      )}
      {cards.map((card, index) => (
        <div
          key={`${index}-${card.last4}`}
          className="space-y-3 rounded-xl border p-4"
        >
          <div className="flex items-center justify-between">
            <span className="font-medium">
              Tarjeta de crédito{" "}
              {card.movementCount ? `· ${card.movementCount} movimientos` : ""}
            </span>
            <button
              className="text-xs text-destructive"
              onClick={() => setCards(cards.filter((_, i) => i !== index))}
            >
              Quitar
            </button>
          </div>
          <Field label="Últimos 4">
            <Input
              inputMode="numeric"
              maxLength={4}
              value={card.last4}
              onChange={(e) => updateCard(index, { last4: e.target.value })}
            />
          </Field>
          <BucketFields
            label="Cupo nacional CLP"
            enabled={card.national}
            onEnabled={(national) => updateCard(index, { national })}
            limit={card.nationalLimit}
            used={card.nationalUsed}
            onLimit={(nationalLimit) => updateCard(index, { nationalLimit })}
            onUsed={(nationalUsed) => updateCard(index, { nationalUsed })}
          />
          <BucketFields
            label="Cupo internacional USD"
            enabled={card.international}
            onEnabled={(international) => updateCard(index, { international })}
            limit={card.internationalLimit}
            used={card.internationalUsed}
            onLimit={(internationalLimit) =>
              updateCard(index, { internationalLimit })
            }
            onUsed={(internationalUsed) =>
              updateCard(index, { internationalUsed })
            }
          />
        </div>
      ))}
      <Button
        variant="outline"
        onClick={() =>
          setCards([
            ...cards,
            {
              last4: "",
              national: true,
              nationalLimit: "",
              nationalUsed: "",
              international: false,
              internationalLimit: "",
              internationalUsed: "",
            },
          ])
        }
        className="w-full border-dashed"
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

function BucketFields({
  label,
  enabled,
  onEnabled,
  limit,
  used,
  onLimit,
  onUsed,
}: {
  label: string
  enabled: boolean
  onEnabled: (v: boolean) => void
  limit: string
  used: string
  onLimit: (v: string) => void
  onUsed: (v: string) => void
}) {
  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onEnabled(e.target.checked)}
        />{" "}
        {label}
      </label>
      {enabled && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Cupo total">
            <Input
              type="number"
              min="0"
              step="any"
              value={limit}
              onChange={(e) => onLimit(e.target.value)}
            />
          </Field>
          <Field label="Utilizado">
            <Input
              type="number"
              min="0"
              step="any"
              value={used}
              onChange={(e) => onUsed(e.target.value)}
            />
          </Field>
        </div>
      )}
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
