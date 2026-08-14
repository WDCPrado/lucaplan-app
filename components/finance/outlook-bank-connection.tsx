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
import {
  CARD_VARIANT_BG,
  resolveCardArt,
  type CardVariant,
} from "@/lib/bank-cards"
import { formatMoney } from "@/lib/finance-format"
import { importStep } from "@/lib/import-progress"
import { cn } from "@/lib/utils"
import { ImportProgressTimeline } from "./import-progress-timeline"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
// Estado de la conexión en DOS niveles: los correos autorizados y, dentro de cada uno, los bancos
// que alimenta. La autorización es del correo (un token, una suscripción); el snapshot y los
// omitidos son de cada banco.
export type OutlookBankDTO = {
  id: string // id del vínculo correo↔banco
  bankProvider: string
  bankId: string | null // null mientras el banco está en setup
  bankName: string // nombre del catálogo + etiqueta
  label: string | null
  pendingSetup: boolean
  skippedCount: number
  lastBalanceReconciledAt: string | null
}

export type OutlookMailboxDTO = {
  id: string
  emailAddress: string
  status: string
  lastSyncedAt: string | null
  lastError: string | null
  discardedCount: number
  webhookActive: boolean
  banks: OutlookBankDTO[]
}

export type OutlookStatus = {
  configured: boolean
  mailboxes: OutlookMailboxDTO[]
  availableBanks: { key: string; name: string }[]
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
  bankName: string
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

// Lo que se pierde al desconectar un banco: sus cuentas arrastran lo que el usuario creó sobre ellas.
type Dependents = {
  accounts: number
  movements: number
  recurring: number
  installments: number
  incomes: number
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
          bucketInvalid(card.internationalLimit, card.internationalAvailable))
    )
  )
}

export function OutlookBankConnection({
  status,
  accounts,
  onReload,
  onImportingChange,
}: {
  status: OutlookStatus | null
  accounts: AccountDTO[]
  onReload: () => Promise<void>
  // Aviso al padre de que la importación inicial está en curso (para bloquear el cierre del modal).
  onImportingChange?: (v: boolean) => void
}) {
  const [busy, setBusy] = useState(false)
  const [scan, setScan] = useState<Scan | null>(null)
  const [snapshotAt, setSnapshotAt] = useState(nowLocal)
  const [checking, setChecking] = useState<CheckingForm | null>(null)
  const [cards, setCards] = useState<CardForm[]>([])
  // Banco en curso: el que está en setup (escaneo → snapshot) o el que se está reconciliando.
  const [reconciling, setReconciling] = useState<OutlookBankDTO | null>(null)
  const [scanError, setScanError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [importStepIdx, setImportStepIdx] = useState(0)
  const automaticScanStarted = useRef(false)
  const invalidSnapshot = snapshotInvalid(checking, cards)

  const mailboxes = status?.mailboxes ?? []
  const banks = mailboxes.flatMap((m) =>
    m.banks.map((b) => ({ ...b, mailbox: m }))
  )
  const pending = banks.find((b) => b.pendingSetup) ?? null

  // Conectar un CORREO nuevo (pasa por OAuth) trayendo consigo el banco elegido.
  async function connect(bankProvider: string, label?: string | null) {
    setBusy(true)
    const res = await fetch("/api/email-connection/connect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ bankProvider, label }),
    })
    const data = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok || !data.url)
      return toast.error(data.error ?? "No se pudo iniciar Outlook")
    window.location.assign(data.url)
  }

  // Agregar un banco a un correo YA autorizado: sin OAuth, el buzón conserva su autorización.
  async function addBank(
    mailboxId: string,
    bankProvider: string,
    label: string | null
  ) {
    setBusy(true)
    const res = await fetch("/api/email-connection/banks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mailboxId, bankProvider, label }),
    })
    const data = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) {
      haptic("error")
      return toast.error(data.error ?? "No se pudo agregar el banco")
    }
    automaticScanStarted.current = false
    await onReload()
  }

  const detect = useCallback(async (linkId: string) => {
    setBusy(true)
    setScanError(null)
    try {
      const res = await fetch(
        `/api/email-connection/candidates?link=${encodeURIComponent(linkId)}`,
        { cache: "no-store" }
      )
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
    if (pending && !automaticScanStarted.current) {
      automaticScanStarted.current = true
      void detect(pending.id)
    }
  }, [pending, detect])

  function snapshotBody(linkId: string) {
    return {
      linkId,
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

  // Importación inicial con overlay de pasos: la petición /confirm corre en paralelo mientras el
  // timeline avanza; el paso "Categorizando" espera la respuesta y recién ahí llega a "Listo". El
  // modal queda bloqueado (onImportingChange) para que no se cierre a mitad.
  async function startInitialImport(linkId: string) {
    setImporting(true)
    setImportStepIdx(0)
    onImportingChange?.(true)
    const start = Date.now()
    let resolved = false
    let result: { ok: boolean; errMsg: string | null } = {
      ok: false,
      errMsg: null,
    }
    void fetch("/api/email-connection/confirm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(snapshotBody(linkId)),
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}))
        result = {
          ok: res.ok,
          errMsg: res.ok
            ? null
            : (data.error ?? "No se pudieron guardar los saldos"),
        }
      })
      .catch(() => {
        result = { ok: false, errMsg: "No se pudieron guardar los saldos" }
      })
      .finally(() => {
        resolved = true
      })

    // El modal está bloqueado durante la importación ⇒ el componente no se desmonta y el bucle es
    // seguro. Avanza el paso cada ~120ms hasta "Listo" (o corta ante error).
    for (;;) {
      setImportStepIdx(importStep(Date.now() - start, resolved))
      if (resolved && !result.ok) {
        setImporting(false)
        onImportingChange?.(false)
        haptic("error")
        toast.error(result.errMsg ?? "No se pudieron guardar los saldos")
        return
      }
      if (importStep(Date.now() - start, resolved) === 3) break
      await sleep(120)
    }
    await sleep(800) // "Listo" visible un instante antes de cerrar
    setImporting(false)
    onImportingChange?.(false)
    haptic("success")
    toast.success("Banco conectado y movimientos importados")
    setScan(null)
    await onReload()
  }

  async function saveReconcile(linkId: string) {
    setBusy(true)
    const res = await fetch("/api/email-connection/reconcile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(snapshotBody(linkId)),
    })
    const data = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) {
      haptic("error")
      return toast.error(data.error ?? "No se pudieron guardar los saldos")
    }
    haptic("success")
    toast.success("Saldos actualizados")
    setReconciling(null)
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

  async function disconnect(body: { linkId?: string; mailboxId?: string }) {
    setBusy(true)
    haptic("heavy") // acción destructiva confirmada
    const res = await fetch("/api/email-connection/disconnect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
    setBusy(false)
    if (!res.ok) {
      haptic("error")
      return toast.error("No se pudo desconectar")
    }
    toast.success(body.linkId ? "Banco desconectado" : "Correo desconectado")
    setScan(null)
    automaticScanStarted.current = false
    await onReload()
  }

  // Importación inicial en curso: el overlay de pasos toma toda la superficie del modal (bloqueado).
  if (importing) return <ImportProgressTimeline current={importStepIdx} />

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

  // Reconciliación de un banco concreto ("Actualizar saldos").
  if (reconciling) {
    return (
      <div className="space-y-5">
        <SnapshotForm
          bankName={reconciling.bankName}
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
            onClick={() => setReconciling(null)}
            className="h-11 flex-1 rounded-full"
          >
            Cancelar
          </Button>
          <Button
            onClick={() => saveReconcile(reconciling.id)}
            disabled={busy || invalidSnapshot}
            className="h-11 flex-1 rounded-full"
          >
            Guardar saldos
          </Button>
        </div>
      </div>
    )
  }

  // Banco recién agregado: escaneo del mes y snapshot antes de crear nada.
  if (pending) {
    if (!scan) {
      return (
        <div className="space-y-4">
          <Notice icon={Check}>
            {pending.bankName} en {pending.mailbox.emailAddress}. Aún no se creó
            ninguna cuenta ni movimiento.
          </Notice>
          {scanError ? (
            <>
              <Notice icon={CircleAlert}>{scanError}</Notice>
              <Button
                onClick={() => detect(pending.id)}
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
              Revisando las notificaciones de tu banco…
            </div>
          )}
          <DisconnectButton
            busy={busy}
            label="Cancelar conexión"
            title={`¿Cancelar la conexión de ${pending.bankName}?`}
            description="Aún no se creó ninguna cuenta ni movimiento."
            onConfirm={() => disconnect({ linkId: pending.id })}
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
          bankName={pending.bankName}
          snapshotAt={snapshotAt}
          setSnapshotAt={setSnapshotAt}
          checking={checking}
          setChecking={setChecking}
          cards={cards}
          setCards={setCards}
        />
        <Button
          onClick={() => startInitialImport(pending.id)}
          disabled={busy || invalidSnapshot}
          className="h-12 w-full rounded-full"
        >
          Validar e importar movimientos
        </Button>
        <DisconnectButton
          busy={busy}
          label="Cancelar conexión"
          title={`¿Cancelar la conexión de ${pending.bankName}?`}
          description="Aún no se creó ninguna cuenta ni movimiento."
          onConfirm={() => disconnect({ linkId: pending.id })}
        />
      </div>
    )
  }

  // Sin correos conectados: primer OAuth, trayendo el banco elegido.
  if (mailboxes.length === 0) {
    return (
      <div className="space-y-4">
        <Notice icon={Mail}>
          Luca Plan solo leerá notificaciones de tu banco con el permiso
          Mail.Read. No puede enviar ni borrar correos.
        </Notice>
        <FirstBankPicker
          banks={status.availableBanks}
          busy={busy}
          onSubmit={(bank) => connect(bank)}
        />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {mailboxes.map((mailbox) => (
        <MailboxCard
          key={mailbox.id}
          mailbox={mailbox}
          busy={busy}
          onReconnect={() => connect(mailbox.banks[0]?.bankProvider ?? "")}
          onReconcile={(bank) => {
            // Solo las cuentas de ESTE banco: con varios conectados, cargar todas metía en el
            // formulario las tarjetas de otro banco.
            const forms = formsFromAccounts(
              accounts.filter((a) => a.bankId === bank.bankId)
            )
            setChecking(forms.checking)
            setCards(forms.cards)
            setSnapshotAt(nowLocal())
            setReconciling(bank)
          }}
          onDisconnectBank={(bank) => disconnect({ linkId: bank.id })}
          onDisconnectMailbox={() => disconnect({ mailboxId: mailbox.id })}
        />
      ))}

      <Button
        onClick={refresh}
        disabled={busy}
        className="h-12 w-full rounded-full"
      >
        <RefreshCw /> Sincronizar ahora
      </Button>

      <AddBankSection
        availableBanks={status.availableBanks}
        mailboxes={mailboxes}
        allBanks={banks}
        busy={busy}
        onAdd={addBank}
        onConnect={connect}
      />
    </div>
  )
}

// Agregar un banco: se elige el banco Y de qué correo llegan sus avisos, en un solo lugar. Antes
// eran dos entradas separadas —un botón dentro de cada correo y otra lista al pie— y desde el
// segundo banco del catálogo se veían dos selectores casi idénticos sin decir a cuál correo iba
// cada uno. Un correo ya autorizado no vuelve a pasar por OAuth; uno nuevo sí.
function AddBankSection({
  availableBanks,
  mailboxes,
  allBanks,
  busy,
  onAdd,
  onConnect,
}: {
  availableBanks: { key: string; name: string }[]
  mailboxes: OutlookMailboxDTO[]
  allBanks: OutlookBankDTO[]
  busy: boolean
  onAdd: (mailboxId: string, bankProvider: string, label: string | null) => void
  onConnect: (bankProvider: string, label: string | null) => void
}) {
  const NEW_MAILBOX = "__new__"
  const [bank, setBank] = useState(availableBanks[0]?.key ?? "")
  const [target, setTarget] = useState<string>(mailboxes[0]?.id ?? NEW_MAILBOX)
  const [label, setLabel] = useState("")

  // El mismo banco no se repite dentro de un correo: el enrutado por remitente no sabría a cuál
  // vínculo imputar el movimiento.
  const taken = (mailboxId: string, bankKey: string) =>
    mailboxes
      .find((m) => m.id === mailboxId)
      ?.banks.some((b) => b.bankProvider === bankKey) ?? false
  // Ese banco ya viene de otro correo ⇒ la etiqueta es la que los distingue en toda la app.
  const requiresLabel = allBanks.some((b) => b.bankProvider === bank)

  // El correo elegido puede ya tener ese banco (el primero de cada lista suele ser justo la
  // combinación que ya existe, y cambiar de banco puede invalidar el correo elegido antes): en ese
  // caso el destino real es un correo nuevo, sin necesidad de sincronizar estados entre sí.
  const effectiveTarget = taken(target, bank) ? NEW_MAILBOX : target
  const targetMailbox = mailboxes.find((m) => m.id === effectiveTarget)
  const bankName = availableBanks.find((b) => b.key === bank)?.name ?? "banco"

  return (
    <div className="space-y-4 rounded-xl border p-4">
      <p className="text-sm font-medium">Agregar un banco</p>

      {availableBanks.length > 1 && (
        <OptionList
          options={availableBanks.map((b) => ({ value: b.key, label: b.name }))}
          selected={bank}
          onSelect={setBank}
        />
      )}

      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">
          ¿A qué correo llegan sus avisos?
        </p>
        <OptionList
          options={[
            ...mailboxes.map((m) => ({
              value: m.id,
              label: m.emailAddress,
              disabled: taken(m.id, bank),
              hint: taken(m.id, bank) ? "ya conectado aquí" : undefined,
            })),
            { value: NEW_MAILBOX, label: "Conectar un correo nuevo" },
          ]}
          selected={effectiveTarget}
          onSelect={setTarget}
        />
      </div>

      {requiresLabel && (
        <div className="space-y-1">
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Etiqueta: Empresa, Personal…"
            maxLength={24}
            className="h-11"
          />
          <p className="text-xs text-muted-foreground">
            Ya tienes {bankName} conectado desde otro correo: la etiqueta los
            distingue en toda la app.
          </p>
        </div>
      )}

      <Button
        onClick={() =>
          targetMailbox
            ? onAdd(targetMailbox.id, bank, label.trim() || null)
            : onConnect(bank, label.trim() || null)
        }
        disabled={busy || !bank || (requiresLabel && !label.trim())}
        className="h-12 w-full rounded-full"
      >
        {busy ? <Loader2 className="animate-spin" /> : <Plus />}
        {targetMailbox ? `Agregar ${bankName}` : "Conectar otro correo"}
      </Button>
    </div>
  )
}

// Lista de opciones en una columna (banco, correo destino): toque grande, sin desplegables.
function OptionList({
  options,
  selected,
  onSelect,
}: {
  options: {
    value: string
    label: string
    disabled?: boolean
    hint?: string
  }[]
  selected: string
  onSelect: (value: string) => void
}) {
  return (
    <div className="flex flex-col gap-2">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          disabled={option.disabled}
          onClick={() => onSelect(option.value)}
          className={cn(
            "flex h-12 items-center justify-between gap-3 rounded-xl border px-4 text-left transition-colors",
            selected === option.value && !option.disabled
              ? "border-primary bg-primary/10"
              : "border-border",
            option.disabled && "opacity-45"
          )}
        >
          <span className="min-w-0 truncate font-medium">{option.label}</span>
          {option.hint && (
            <span className="shrink-0 text-xs text-muted-foreground">
              {option.hint}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}

// Un correo conectado con los bancos que alimenta. El estado de la autorización es del correo y sus
// bancos lo heredan: una sola reconexión los arregla a todos.
function MailboxCard({
  mailbox,
  busy,
  onReconnect,
  onReconcile,
  onDisconnectBank,
  onDisconnectMailbox,
}: {
  mailbox: OutlookMailboxDTO
  busy: boolean
  onReconnect: () => void
  onReconcile: (bank: OutlookBankDTO) => void
  onDisconnectBank: (bank: OutlookBankDTO) => void
  onDisconnectMailbox: () => void
}) {
  const statusLabel =
    mailbox.status === "active"
      ? "Autorización activa"
      : mailbox.status === "reauth_required"
        ? "Requiere reconexión"
        : "Error de sincronización"
  const tone =
    mailbox.status === "active"
      ? "border-success/40 bg-success/5"
      : "border-destructive/40 bg-destructive/5"
  return (
    <div className={cn("space-y-3 rounded-xl border p-4 text-sm", tone)}>
      <div className="flex items-center gap-2 font-medium">
        <Mail className="size-4 text-primary" /> {mailbox.emailAddress}
      </div>
      <div className="space-y-1 text-xs text-muted-foreground">
        <p>Estado: {statusLabel}</p>
        <p>
          Última sincronización:{" "}
          {mailbox.lastSyncedAt
            ? new Date(mailbox.lastSyncedAt).toLocaleString("es-CL")
            : "pendiente"}
        </p>
        <p>webhook {mailbox.webhookActive ? "activo" : "no configurado"}</p>
      </div>
      {mailbox.lastError && (
        <Notice icon={CircleAlert}>{mailbox.lastError}</Notice>
      )}
      {mailbox.status === "reauth_required" && (
        <Button
          onClick={onReconnect}
          disabled={busy}
          className="h-11 w-full rounded-full"
        >
          <Mail /> Reconectar este correo
        </Button>
      )}

      <ul className="space-y-2">
        {mailbox.banks.map((bank) => (
          <li key={bank.id} className="rounded-lg border bg-background/60 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{bank.bankName}</span>
              {/* La etiqueta distingue este origen cuando el mismo banco viene de dos correos. */}
              {bank.label && (
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                  {bank.label}
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Saldo estimado desde{" "}
              {bank.lastBalanceReconciledAt
                ? new Date(bank.lastBalanceReconciledAt).toLocaleString("es-CL")
                : "sin fecha"}{" "}
              · {bank.skippedCount} mensajes omitidos
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={() => onReconcile(bank)}
                disabled={busy}
                className="h-9 rounded-full"
              >
                Actualizar saldos
              </Button>
              <DisconnectBankButton
                busy={busy}
                bank={bank}
                onConfirm={() => onDisconnectBank(bank)}
              />
            </div>
          </li>
        ))}
      </ul>

      <DisconnectButton
        busy={busy}
        label="Desconectar este correo"
        title="¿Desconectar el correo?"
        description={`Se desconectarán todos los bancos de ${mailbox.emailAddress}, con sus cuentas y movimientos importados.`}
        onConfirm={onDisconnectMailbox}
      />
    </div>
  )
}

// Primer correo: solo se elige el banco. No hay etiqueta que pedir (no existe todavía otro correo
// del que distinguirlo) ni destino que elegir.
function FirstBankPicker({
  banks,
  busy,
  onSubmit,
}: {
  banks: { key: string; name: string }[]
  busy: boolean
  onSubmit: (bankProvider: string) => void
}) {
  const [selected, setSelected] = useState(banks[0]?.key ?? "")

  return (
    <div className="space-y-3">
      {banks.length > 1 && (
        <OptionList
          options={banks.map((b) => ({ value: b.key, label: b.name }))}
          selected={selected}
          onSelect={setSelected}
        />
      )}
      <Button
        onClick={() => onSubmit(selected)}
        disabled={busy || !selected}
        className="h-12 w-full rounded-full"
      >
        {busy ? <Loader2 className="animate-spin" /> : <Mail />} Conectar
        Outlook
      </Button>
    </div>
  )
}

// Desconectar un banco: enumera lo que se pierde ANTES de ejecutar (las cuentas arrastran ingresos,
// recurrentes y planes de cuotas que el usuario creó sobre ellas).
function DisconnectBankButton({
  busy,
  bank,
  onConfirm,
}: {
  busy: boolean
  bank: OutlookBankDTO
  onConfirm: () => void
}) {
  const [dependents, setDependents] = useState<Dependents | null>(null)

  async function loadDependents() {
    setDependents(null)
    const res = await fetch(
      `/api/email-connection/disconnect?link=${encodeURIComponent(bank.id)}`,
      { cache: "no-store" }
    )
    if (res.ok) setDependents(await res.json())
  }

  const lines = dependents
    ? [
        [dependents.accounts, "cuenta", "cuentas"],
        [dependents.movements, "movimiento", "movimientos"],
        [dependents.recurring, "recurrente", "recurrentes"],
        [dependents.installments, "plan de cuotas", "planes de cuotas"],
        [dependents.incomes, "fuente de ingreso", "fuentes de ingreso"],
      ]
        .filter(([n]) => (n as number) > 0)
        .map(([n, one, many]) => `${n} ${n === 1 ? one : many}`)
    : []

  return (
    <AlertDialog onOpenChange={(open) => open && loadDependents()}>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          disabled={busy}
          className="h-9 rounded-full text-destructive hover:text-destructive"
        >
          <Unplug /> Desconectar
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Desconectar {bank.bankName}?</AlertDialogTitle>
          <AlertDialogDescription>
            {dependents === null
              ? "Revisando qué se eliminará…"
              : lines.length === 0
                ? "No hay datos asociados a este banco todavía."
                : `Se eliminarán ${lines.join(", ")}. Los demás bancos de este correo no se tocan.`}
          </AlertDialogDescription>
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

function DisconnectButton({
  busy,
  label,
  title,
  description,
  onConfirm,
}: {
  busy: boolean
  label: string
  title: string
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
          <Unplug /> {label}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
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
  bankName,
  snapshotAt,
  setSnapshotAt,
  checking,
  setChecking,
  cards,
  setCards,
}: {
  bankName: string // el banco que se está configurando: da nombre y monograma a las tarjetas
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
              onChange={(d) =>
                setSnapshotAt(`${d}T${snapshotAt.slice(11, 16)}`)
              }
            />
          </div>
          <Input
            type="time"
            value={snapshotAt.slice(11, 16)}
            onChange={(e) =>
              setSnapshotAt(`${snapshotAt.slice(0, 10)}T${e.target.value}`)
            }
            aria-label="Hora del saldo"
            className="h-11 w-auto shrink-0"
          />
        </div>
      </Field>
      {checking ? (
        <CandidateCard
          bankName={bankName}
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
            <div className="text-xs text-white/75">Saldo actual (CLP)</div>
            <MoneyField
              currency="CLP"
              value={checking.cash}
              onValue={(cash) => setChecking({ ...checking, cash })}
              ariaLabel="Saldo actual en pesos"
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
          bankName={bankName}
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
            onEnabled={(international) =>
              updateCard(card.id, { international })
            }
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
          <DerivedUsed
            limit={limit}
            available={available}
            currency={currency}
          />
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
  bankName,
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
  bankName: string
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
    bankName,
    variant === "debito" ? "checking" : "credit_card"
  )
  return (
    <div
      className="relative flex min-h-40 w-full flex-col gap-4 overflow-hidden rounded-2xl p-5 text-white shadow-[0_1px_2px_rgb(0_0_0/0.08),0_8px_20px_-10px_rgb(0_0_0/0.25)]"
      style={{ background: CARD_VARIANT_BG[variant] }}
    >
      {art && (
        // Monograma propio del banco como marca de agua (sin logo de terceros).
        <span
          aria-hidden
          className="pointer-events-none absolute top-1/2 -right-3 -translate-y-1/2 text-8xl leading-none font-bold text-white/12 select-none"
        >
          {art.monogram}
        </span>
      )}
      <div className="relative flex items-start justify-between gap-2">
        <div className="text-lg font-semibold tracking-tight [text-shadow:0_1px_3px_rgb(0_0_0/0.45)]">
          {bankName}
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
            className="tabular h-8 w-24 rounded-lg border-white/20 px-2 text-sm tracking-widest text-white selection:bg-white/25 selection:text-white placeholder:text-white/40 focus-visible:border-white/40 focus-visible:ring-white/20"
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
