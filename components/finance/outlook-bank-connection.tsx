"use client"

import { Button, Input, Switch } from "glisse"

import { useCallback, useEffect, useId, useRef, useState } from "react"
import { Check, CircleAlert, Loader2, Mail, Plus } from "lucide-react"
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

import {
  ModalActions,
  ModalDangerRow,
  ModalSection,
} from "@/components/ui/responsive-modal"
import { DatePicker } from "./transaction-modal"
import type { CurrencyCode } from "@/arch/v1/domain/finance/money"
import { useMoneyInput } from "@/hooks/use-money-input"
import type { CardVariant } from "@/lib/bank-cards"
import {
  confirmBlocker,
  plural,
  proposedChecking,
  refComplete,
  scanGuidance,
  type ScanCandidate,
  type SetupForm,
} from "@/lib/bank-setup-guidance"
import { formatMoney, monthName } from "@/lib/finance-format"
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
  emailProvider: string // clave del proveedor; el nombre visible sale de OutlookStatus.providers
  emailAddress: string
  status: string
  lastSyncedAt: string | null
  lastError: string | null
  discardedCount: number
  webhookActive: boolean
  banks: OutlookBankDTO[]
}

export type OutlookStatus = {
  // Catálogo de proveedores de correo con si el servidor tiene credenciales de cada uno. Se ofrece
  // conectar solo los configurados; la lista completa sirve además para nombrar el proveedor de un
  // buzón ya conectado.
  providers: { key: string; name: string; configured: boolean }[]
  mailboxes: OutlookMailboxDTO[]
  availableBanks: { key: string; name: string }[]
}

type Scan = {
  candidates: ScanCandidate[]
  totalMessages: number
  expenseCount: number
  internalCount: number
  // Movimientos que el banco refiere solo como "tu cuenta principal", sin número: no producen
  // candidato, pero sí se importan si el usuario confirma UNA cuenta corriente.
  primaryCheckingCount: number
  skippedCount: number
  since: string // primer día del mes escaneado (ISO)
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

// Lo que el formulario le muestra al usuario (qué se le propone, los avisos y qué le falta) vive
// en lib/, para que se pruebe sin montar la UI.
const formOf = (
  checking: CheckingForm | null,
  cards: CardForm[]
): SetupForm => ({
  checkingRef: checking ? checking.ref : null,
  cards: cards.map((card) => ({
    ref: card.last4,
    national: card.national,
    international: card.international,
  })),
})

// Mes de la ventana escaneada, en la voz de la app: "julio de 2026". Vacío si el escaneo no lo trae.
function scanMonthLabel(sinceIso: string): string {
  const since = new Date(sinceIso)
  if (Number.isNaN(since.getTime())) return ""
  const name = monthName(since.getUTCMonth() + 1).toLowerCase()
  return name ? `${name} de ${since.getUTCFullYear()}` : ""
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

// Ventana que el refresco manual vuelve a leer, además de las novedades del delta. Corta a
// propósito: cada relectura baja los avisos del banco CON cuerpo, y un mes de compras diarias son
// cientos de correos en cada toque del botón. Para ir más atrás, el endpoint acepta su propia
// fecha (hasta 90 días).
const REPROCESO_DIAS = 7

export function OutlookBankConnection({
  status,
  onReload,
  onImportingChange,
  inline = false,
}: {
  status: OutlookStatus | null
  onReload: () => Promise<void>
  // Aviso al padre de que la importación inicial está en curso (para bloquear el cierre del modal).
  onImportingChange?: (v: boolean) => void
  // Fuera de un modal (onboarding): las acciones van en el flujo, al final del contenido, y no se
  // listan los bancos que vienen: ahí la persona conecta el suyo y sigue.
  inline?: boolean
}) {
  const actionsClass = inline ? INLINE_ACTIONS_CLASS : ACTIONS_CLASS
  const [busy, setBusy] = useState(false)
  const [scan, setScan] = useState<Scan | null>(null)
  const [snapshotAt, setSnapshotAt] = useState(nowLocal)
  const [checking, setChecking] = useState<CheckingForm | null>(null)
  const [cards, setCards] = useState<CardForm[]>([])
  const [scanError, setScanError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [importStepIdx, setImportStepIdx] = useState(0)
  const automaticScanStarted = useRef(false)
  const invalidSnapshot = snapshotInvalid(checking, cards)
  // Qué falta para poder confirmar la conexión inicial, que CREA instrumentos.
  const blockingHint = confirmBlocker(formOf(checking, cards))

  const mailboxes = status?.mailboxes ?? []
  // Solo los que el servidor puede autorizar. El nombre se busca en el catálogo completo: un buzón
  // conectado con un proveedor que después se desconfiguró igual tiene que poder nombrarse.
  const providers = status?.providers ?? []
  const configuredProviders = providers.filter((p) => p.configured)
  const providerName = (key: string) =>
    providers.find((p) => p.key === key)?.name ?? key
  const banks = mailboxes.flatMap((m) =>
    m.banks.map((b) => ({ ...b, mailbox: m }))
  )
  const pending = banks.find((b) => b.pendingSetup) ?? null

  // Conectar un CORREO nuevo (pasa por OAuth) trayendo consigo el proveedor y el banco elegidos.
  // Al reconectar un buzón existente se le pasa SU proveedor: la autorización tiene que renovarse
  // con el mismo con el que se creó, no con el que esté por defecto.
  async function connect(
    bankProvider: string,
    label?: string | null,
    provider?: string
  ) {
    setBusy(true)
    const res = await fetch("/api/email-connection/connect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider, bankProvider, label }),
    })
    const data = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok || !data.url)
      return toast.error(data.error ?? "No se pudo iniciar la conexión")
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
      // Qué cuenta se propone —incluida la vacía cuando el banco no la numera— lo decide
      // proposedChecking, que se prueba aparte.
      const propuesta = proposedChecking(data)
      setChecking(
        propuesta
          ? {
              ref: propuesta.ref,
              cash: 0,
              hasOverdraft: false,
              overdraftLimit: 0,
              overdraftAvailable: 0,
              movementCount: propuesta.movementCount,
            }
          : null
      )
      setCards(
        data.candidates
          .filter(
            (c): c is Extract<ScanCandidate, { kind: "credit_card" }> =>
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

  async function refresh() {
    setBusy(true)
    // Además del delta, relee este último mes de avisos de los bancos vinculados: así vuelven los
    // correos que pasaron por el cursor sin dejar movimiento porque su plantilla aún no se
    // reconocía. La fecha acota el reproceso; el histórico anterior no se toca.
    const since = new Date(
      Date.now() - REPROCESO_DIAS * 86_400_000
    ).toISOString()
    const res = await fetch("/api/email-connection/refresh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ since }),
    })
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
  if (importing)
    return (
      <ImportProgressTimeline
        current={importStepIdx}
        bankName={pending?.bankName ?? "tu banco"}
      />
    )

  if (!status)
    return (
      <div role="status" className="flex justify-center py-8">
        <Loader2 className="size-5 animate-spin text-primary" aria-hidden />
        <span className="sr-only">Cargando la conexión del banco</span>
      </div>
    )
  // Banco recién agregado: escaneo del mes y snapshot antes de crear nada.
  if (pending) {
    const cancelPending = (
      <DisconnectButton
        busy={busy}
        label="Cancelar conexión"
        title={`¿Cancelar la conexión de ${pending.bankName}?`}
        description="Aún no se creó ninguna cuenta ni movimiento."
        onConfirm={() => disconnect({ linkId: pending.id })}
      />
    )
    if (!scan) {
      return (
        <div className="flex flex-col gap-7">
          <ModalSection footer="Aún no se creó ninguna cuenta ni movimiento.">
            <div className={ROW}>
              <Check className="size-5 shrink-0 text-success" aria-hidden />
              <div className="min-w-0">
                <p className="text-body">{pending.bankName}</p>
                <p className="truncate text-subheadline text-muted-foreground">
                  {pending.mailbox.emailAddress}
                </p>
              </div>
            </div>
            {scanError ? (
              <Notice icon={CircleAlert} tone="warning" role="alert">
                {scanError}
              </Notice>
            ) : (
              <div role="status" className={ROW}>
                <Loader2
                  className="size-5 shrink-0 animate-spin text-primary"
                  aria-hidden
                />
                <span className="text-subheadline text-muted-foreground">
                  Revisando las notificaciones de tu banco…
                </span>
              </div>
            )}
          </ModalSection>
          {cancelPending}
          {scanError && (
            <ModalActions
              primary={{
                label: "Reintentar revisión",
                mobileLabel: "Reintentar",
                onClick: () => detect(pending.id),
                disabled: busy,
              }}
              className={actionsClass}
            />
          )}
        </div>
      )
    }
    return (
      <div className="flex flex-col gap-7">
        <ScanSummary scan={scan} bankName={pending.bankName} />
        <ScanGuidance
          scan={scan}
          bankName={pending.bankName}
          checking={checking}
          cards={cards}
        />
        <SnapshotForm
          bankName={pending.bankName}
          snapshotAt={snapshotAt}
          setSnapshotAt={setSnapshotAt}
          checking={checking}
          setChecking={setChecking}
          cards={cards}
          setCards={setCards}
        />
        {/* Por qué la acción está apagada: un disabled sin motivo deja al usuario probando clics.
            El mismo motivo viaja además en el campo que lo causa (aria-describedby), que es donde
            se arregla y donde sí lo alcanza un lector de pantalla. */}
        {blockingHint && <BlockingHint>{blockingHint}</BlockingHint>}
        {cancelPending}
        <ModalActions
          primary={{
            label: "Validar e importar movimientos",
            mobileLabel: "Importar",
            onClick: () => startInitialImport(pending.id),
            disabled: busy || invalidSnapshot || Boolean(blockingHint),
          }}
          className={actionsClass}
        />
      </div>
    )
  }

  // Sin correos conectados: primer OAuth, trayendo el banco elegido.
  if (mailboxes.length === 0) {
    return (
      <div className="flex flex-col gap-7">
        <ModalSection>
          <Notice icon={Mail}>
            Luca Plan solo leerá notificaciones de tu banco con el permiso
            Mail.Read. No puede enviar ni borrar correos.
          </Notice>
        </ModalSection>
        {configuredProviders.length === 0 ? (
          <ModalSection>
            <NotConfiguredNotice />
          </ModalSection>
        ) : (
          <FirstBankPicker
            banks={status.availableBanks}
            providers={configuredProviders}
            busy={busy}
            actionsClass={actionsClass}
            showComingSoon={!inline}
            onSubmit={(bank, provider) => connect(bank, null, provider)}
          />
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-7">
      {mailboxes.map((mailbox) => (
        <MailboxSection
          key={mailbox.id}
          mailbox={mailbox}
          providerName={providerName(mailbox.emailProvider)}
          canReconnect={configuredProviders.some(
            (p) => p.key === mailbox.emailProvider
          )}
          busy={busy}
          onReconnect={() =>
            connect(
              mailbox.banks[0]?.bankProvider ?? "",
              null,
              mailbox.emailProvider
            )
          }
          onDisconnectBank={(bank) => disconnect({ linkId: bank.id })}
        />
      ))}

      <AddBankSection
        availableBanks={status.availableBanks}
        providers={configuredProviders}
        mailboxes={mailboxes}
        allBanks={banks}
        busy={busy}
        showComingSoon={!inline}
        onAdd={addBank}
        onConnect={connect}
      />

      {/* Lo destructivo va al final, una fila por correo: nunca junto a la acción principal. */}
      {mailboxes.map((mailbox) => (
        <DisconnectButton
          key={mailbox.id}
          busy={busy}
          label={`Desconectar ${mailbox.emailAddress}`}
          className="[overflow-wrap:anywhere]"
          title="¿Desconectar el correo?"
          description={`Se desconectarán todos los bancos de ${mailbox.emailAddress}, con sus cuentas y movimientos importados.`}
          onConfirm={() => disconnect({ mailboxId: mailbox.id })}
        />
      ))}

      <ModalActions
        primary={{
          label: "Sincronizar ahora",
          mobileLabel: "Sincronizar",
          onClick: refresh,
          disabled: busy,
        }}
        className={actionsClass}
      />
    </div>
  )
}

// Fila de una lista agrupada (≥44 px) y la variante que es una acción en texto azul.
const ROW = "flex min-h-11 items-center gap-3 px-4 py-2.5"
const ACTION_ROW =
  "press flex min-h-11 w-full items-center gap-3 px-4 py-2.5 text-left text-body text-primary disabled:opacity-50"
// Botón de texto dentro de una fila (Desconectar): sin relleno, 44 px de alto.
const TEXT_BUTTON =
  "press h-11 px-3 text-body font-normal hover:bg-transparent dark:hover:bg-transparent"
// Pie de escritorio (en la hoja de móvil van al encabezado): llega a los bordes del contenedor, que
// tiene px-5 pb-6 tanto en el modal como en el onboarding.
const ACTIONS_CLASS = "-mx-5 mt-0 -mb-6 px-5"
// Sin modal no hay pie que anclar: los botones quedan en el flujo, sobre el fondo de la página.
const INLINE_ACTIONS_CLASS =
  "static mx-0 mt-0 border-0 bg-transparent px-0 py-0 pb-0"

// Bancos que todavía no se pueden conectar: se nombran al pie de la lista de bancos, que es donde
// la persona busca el suyo.
const COMING_SOON = `Próximamente: ${new Intl.ListFormat("es", {
  type: "conjunction",
}).format([
  "Santander",
  "BCI",
  "Banco Estado",
  "Itaú",
  "Banco Falabella",
  "Scotiabank",
])}.`

function BlockingHint({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-4 text-center text-subheadline text-muted-foreground">
      {children}
    </p>
  )
}

// El servidor no tiene credenciales del proveedor, así que no se puede INICIAR una conexión. Los
// correos ya conectados se siguen mostrando: rotularlos no necesita credenciales.
function NotConfiguredNotice() {
  return (
    <Notice icon={CircleAlert}>
      Outlook aún no está configurado en el servidor (falta OUTLOOK_CLIENT_ID).
      Revisa la guía en docs/email-connection-outlook.md.
    </Notice>
  )
}

// Agregar un banco: se elige el banco Y de qué correo llegan sus avisos, en un solo lugar. Antes
// eran dos entradas separadas —un botón dentro de cada correo y otra lista al pie— y desde el
// segundo banco del catálogo se veían dos selectores casi idénticos sin decir a cuál correo iba
// cada uno. Un correo ya autorizado no vuelve a pasar por OAuth; uno nuevo sí.
function AddBankSection({
  availableBanks,
  providers,
  mailboxes,
  allBanks,
  busy,
  showComingSoon,
  onAdd,
  onConnect,
}: {
  availableBanks: { key: string; name: string }[]
  providers: { key: string; name: string }[] // solo los configurados en el servidor
  mailboxes: OutlookMailboxDTO[]
  allBanks: OutlookBankDTO[]
  busy: boolean
  showComingSoon: boolean
  onAdd: (mailboxId: string, bankProvider: string, label: string | null) => void
  onConnect: (
    bankProvider: string,
    label: string | null,
    provider: string
  ) => void
}) {
  const NEW_MAILBOX = "__new__"
  const [bank, setBank] = useState(availableBanks[0]?.key ?? "")
  const [target, setTarget] = useState<string>(mailboxes[0]?.id ?? NEW_MAILBOX)
  const [provider, setProvider] = useState(providers[0]?.key ?? "")
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
  const pickBank = availableBanks.length > 1

  return (
    <>
      {pickBank && (
        <ModalSection
          title="Agregar un banco"
          footer={showComingSoon ? COMING_SOON : undefined}
        >
          <OptionRows
            options={availableBanks.map((b) => ({
              value: b.key,
              label: b.name,
            }))}
            selected={bank}
            onSelect={setBank}
          />
        </ModalSection>
      )}

      <ModalSection
        title={
          pickBank
            ? "¿A qué correo llegan sus avisos?"
            : `¿A qué correo llegan los avisos de ${bankName}?`
        }
        footer={!pickBank && showComingSoon ? COMING_SOON : undefined}
      >
        <OptionRows
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
      </ModalSection>

      {/* Conectar un correo nuevo pasa por OAuth; agregar un banco a uno ya autorizado, no. */}
      {!targetMailbox && providers.length === 0 && (
        <ModalSection>
          <NotConfiguredNotice />
        </ModalSection>
      )}

      {/* De qué proveedor es el correo nuevo. Con uno solo configurado no hay nada que preguntar. */}
      {!targetMailbox && providers.length > 1 && (
        <ModalSection title="¿De qué proveedor es el correo nuevo?">
          <OptionRows
            options={providers.map((p) => ({ value: p.key, label: p.name }))}
            selected={provider}
            onSelect={setProvider}
          />
        </ModalSection>
      )}

      {requiresLabel && (
        <ModalSection
          title="Etiqueta"
          footer={`Ya tienes ${bankName} conectado desde otro correo: la etiqueta los distingue en toda la app.`}
        >
          <Input
            value={label}
            onValueChange={(value) => setLabel(value)}
            placeholder="Empresa, Personal…"
            aria-label="Etiqueta"
            maxLength={24}
            className="h-11 rounded-none border-0 bg-transparent px-4 text-body shadow-none focus-visible:ring-0 md:text-body"
          />
        </ModalSection>
      )}

      <ModalSection>
        <button
          type="button"
          onClick={() =>
            targetMailbox
              ? onAdd(targetMailbox.id, bank, label.trim() || null)
              : onConnect(bank, label.trim() || null, provider)
          }
          disabled={
            busy ||
            !bank ||
            (!targetMailbox && !provider) ||
            (requiresLabel && !label.trim())
          }
          className={ACTION_ROW}
        >
          {busy ? (
            <Loader2 className="size-5 shrink-0 animate-spin" aria-hidden />
          ) : (
            <Plus className="size-5 shrink-0" aria-hidden />
          )}
          {targetMailbox ? `Agregar ${bankName}` : "Conectar otro correo"}
        </button>
      </ModalSection>
    </>
  )
}

// Opciones de una lista agrupada (banco, correo destino, proveedor): una fila por opción y la
// elegida con su check, como en Ajustes. Toque grande, sin desplegables.
function OptionRows({
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
  return options.map((option) => {
    const isSelected = selected === option.value && !option.disabled
    return (
      <button
        key={option.value}
        type="button"
        disabled={option.disabled}
        aria-pressed={isSelected}
        onClick={() => onSelect(option.value)}
        className="press flex min-h-11 w-full items-center gap-3 px-4 py-2.5 text-left text-body disabled:opacity-45"
      >
        <span className="min-w-0 flex-1 truncate">{option.label}</span>
        {option.hint && (
          <span className="shrink-0 text-footnote text-muted-foreground">
            {option.hint}
          </span>
        )}
        {isSelected && (
          <Check className="size-5 shrink-0 text-primary" aria-hidden />
        )}
      </button>
    )
  })
}

// Un correo conectado con los bancos que alimenta. El estado de la autorización es del correo y sus
// bancos lo heredan: una sola reconexión los arregla a todos.
function MailboxSection({
  mailbox,
  providerName,
  canReconnect,
  busy,
  onReconnect,
  onDisconnectBank,
}: {
  mailbox: OutlookMailboxDTO
  providerName: string
  canReconnect: boolean // el servidor tiene credenciales del proveedor de ESTE buzón
  busy: boolean
  onReconnect: () => void
  onDisconnectBank: (bank: OutlookBankDTO) => void
}) {
  const active = mailbox.status === "active"
  const statusLabel = active
    ? "Autorización activa"
    : mailbox.status === "reauth_required"
      ? "Requiere reconexión"
      : "Error de sincronización"
  return (
    <ModalSection
      title={<span className="block truncate">{mailbox.emailAddress}</span>}
      footer={`Última sincronización: ${
        mailbox.lastSyncedAt
          ? new Date(mailbox.lastSyncedAt).toLocaleString("es-CL")
          : "pendiente"
      } · webhook ${mailbox.webhookActive ? "activo" : "no configurado"}`}
    >
      <div className={ROW}>
        <span
          aria-hidden
          className={cn(
            "size-2 shrink-0 rounded-full",
            active ? "bg-success" : "bg-destructive"
          )}
        />
        <span
          className={cn(
            "min-w-0 flex-1 text-body",
            !active && "text-destructive"
          )}
        >
          {statusLabel}
        </span>
        {/* De qué proveedor es este correo: con varios conectados es lo que los distingue. */}
        <span className="shrink-0 text-subheadline text-muted-foreground">
          {providerName}
        </span>
      </div>
      {mailbox.lastError && (
        <Notice icon={CircleAlert} tone="warning">
          {mailbox.lastError}
        </Notice>
      )}
      {mailbox.status === "reauth_required" &&
        (canReconnect ? (
          <button
            type="button"
            onClick={onReconnect}
            disabled={busy}
            className={ACTION_ROW}
          >
            <Mail className="size-5 shrink-0" aria-hidden /> Reconectar este
            correo
          </button>
        ) : (
          <NotConfiguredNotice />
        ))}

      {mailbox.banks.map((bank) => (
        <div key={bank.id} className="px-4 pt-2.5 pb-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="text-body">{bank.bankName}</span>
            {/* La etiqueta distingue este origen cuando el mismo banco viene de dos correos. */}
            {bank.label && (
              <span className="rounded-lg bg-primary/10 px-2 py-0.5 text-footnote font-medium text-primary">
                {bank.label}
              </span>
            )}
          </div>
          <p className="text-footnote text-muted-foreground">
            Saldo estimado desde{" "}
            {bank.lastBalanceReconciledAt
              ? new Date(bank.lastBalanceReconciledAt).toLocaleString("es-CL")
              : "sin fecha"}{" "}
            · {bank.skippedCount} mensajes omitidos
          </p>
          <div className="-mx-3 flex flex-wrap">
            <DisconnectBankButton
              busy={busy}
              bank={bank}
              onConfirm={() => onDisconnectBank(bank)}
            />
          </div>
        </div>
      ))}
    </ModalSection>
  )
}

// Primer correo: solo se elige el banco. No hay etiqueta que pedir (no existe todavía otro correo
// del que distinguirlo) ni destino que elegir.
function FirstBankPicker({
  banks,
  providers,
  busy,
  actionsClass,
  showComingSoon,
  onSubmit,
}: {
  banks: { key: string; name: string }[]
  providers: { key: string; name: string }[] // solo los configurados en el servidor
  busy: boolean
  actionsClass: string
  showComingSoon: boolean
  onSubmit: (bankProvider: string, provider: string) => void
}) {
  const [selected, setSelected] = useState(banks[0]?.key ?? "")
  const [provider, setProvider] = useState(providers[0]?.key ?? "")
  const providerLabel = providers.find((p) => p.key === provider)?.name ?? ""

  return (
    <>
      {banks.length > 1 ? (
        <ModalSection
          title="Banco"
          footer={showComingSoon ? COMING_SOON : undefined}
        >
          <OptionRows
            options={banks.map((b) => ({ value: b.key, label: b.name }))}
            selected={selected}
            onSelect={setSelected}
          />
        </ModalSection>
      ) : (
        showComingSoon && (
          <p className="px-4 text-footnote text-muted-foreground">
            {COMING_SOON}
          </p>
        )
      )}
      {/* Con un solo proveedor configurado la acción ya dice cuál es; preguntarlo sería una lista
          de un elemento. */}
      {providers.length > 1 && (
        <ModalSection title="¿De qué proveedor es tu correo?">
          <OptionRows
            options={providers.map((p) => ({ value: p.key, label: p.name }))}
            selected={provider}
            onSelect={setProvider}
          />
        </ModalSection>
      )}
      <ModalActions
        primary={{
          label: busy ? "Conectando…" : `Conectar ${providerLabel}`,
          mobileLabel: busy ? "Conectando…" : "Conectar",
          onClick: () => onSubmit(selected, provider),
          disabled: busy || !selected || !provider,
        }}
        className={actionsClass}
      />
    </>
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
          type="button"
          disabled={busy}
          destructive
          className={TEXT_BUTTON}
        >
          Desconectar
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

// Fila roja al final del contenido que pide confirmación antes de desconectar.
function DisconnectButton({
  busy,
  label,
  title,
  description,
  onConfirm,
  className,
}: {
  busy: boolean
  label: string
  title: string
  description: string
  onConfirm: () => void
  className?: string
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <ModalDangerRow disabled={busy} className={className}>
          {label}
        </ModalDangerRow>
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
  bankName: string // el banco que se está configurando: da nombre a cada instrumento
  snapshotAt: string
  setSnapshotAt: (value: string) => void
  checking: CheckingForm | null
  setChecking: (value: CheckingForm | null) => void
  cards: CardForm[]
  setCards: (value: CardForm[]) => void
}) {
  const dateId = useId()
  const updateCard = (id: string, patch: Partial<CardForm>) =>
    setCards(
      cards.map((card) => (card.id === id ? { ...card, ...patch } : card))
    )
  return (
    <div className="flex flex-col gap-7">
      <ModalSection
        title="Fecha y hora del saldo"
        footer="Los movimientos previos a este saldo se importan, pero no vuelven a descontarse. CLP y USD se mantienen separados."
      >
        {/* snapshotAt = "YYYY-MM-DDTHH:mm": Calendar+Popover de shadcn para la fecha (regla del
            proyecto: nunca input date nativo) + input de hora al lado. */}
        <div className="flex items-center gap-2 px-4 py-2">
          <label htmlFor={dateId} className="sr-only">
            Fecha del saldo
          </label>
          <div className="min-w-0 flex-1">
            <DatePicker
              id={dateId}
              value={snapshotAt.slice(0, 10)}
              onChange={(d) =>
                setSnapshotAt(`${d}T${snapshotAt.slice(11, 16)}`)
              }
            />
          </div>
          <Input
            type="time"
            value={snapshotAt.slice(11, 16)}
            onValueChange={(value) =>
              setSnapshotAt(`${snapshotAt.slice(0, 10)}T${value}`)
            }
            aria-label="Hora del saldo"
            className="h-12 w-auto shrink-0"
          />
        </div>
      </ModalSection>
      {checking && (
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
          <MoneyRow label="Saldo actual (CLP)">
            <MoneyField
              currency="CLP"
              value={checking.cash}
              onValue={(cash) => setChecking({ ...checking, cash })}
              ariaLabel="Saldo actual en pesos"
              kind="primary"
            />
          </MoneyRow>
          <SwitchRow
            checked={checking.hasOverdraft}
            onChecked={(hasOverdraft) =>
              setChecking({ ...checking, hasOverdraft })
            }
          >
            Línea de sobregiro
          </SwitchRow>
          {checking.hasOverdraft && (
            <>
              <MoneyRow label="Cupo total">
                <MoneyField
                  currency="CLP"
                  value={checking.overdraftLimit}
                  onValue={(overdraftLimit) =>
                    setChecking({ ...checking, overdraftLimit })
                  }
                  ariaLabel="Cupo total del sobregiro"
                />
              </MoneyRow>
              <MoneyRow label="Disponible">
                <MoneyField
                  currency="CLP"
                  value={checking.overdraftAvailable}
                  onValue={(overdraftAvailable) =>
                    setChecking({ ...checking, overdraftAvailable })
                  }
                  ariaLabel="Sobregiro disponible"
                />
              </MoneyRow>
              <DerivedUsed
                limit={checking.overdraftLimit}
                available={checking.overdraftAvailable}
                currency="CLP"
              />
            </>
          )}
        </CandidateCard>
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
      <ModalSection>
        {!checking && (
          <button
            type="button"
            onClick={() =>
              setChecking({
                ref: "",
                cash: 0,
                hasOverdraft: false,
                overdraftLimit: 0,
                overdraftAvailable: 0,
              })
            }
            className={ACTION_ROW}
          >
            <Plus className="size-5 shrink-0" aria-hidden /> Agregar cuenta
            corriente
          </button>
        )}
        <button
          type="button"
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
          className={ACTION_ROW}
        >
          <Plus className="size-5 shrink-0" aria-hidden /> Agregar tarjeta
        </button>
      </ModalSection>
    </div>
  )
}

// Controles de saldo dentro de una fila: misma máscara, monedas separadas y alineados a la derecha.
const boxedMoneyInput = "h-11 rounded-lg text-right text-body"
const primaryMoneyInput =
  "h-11 rounded-lg text-right text-title-3 font-semibold md:text-title-3"

// Input de monto que reutiliza el formateo vigente (CLP entero agrupado, USD con coma y 2
// decimales). `value` solo inicializa; el estado vive en useMoneyInput y se reporta por onValue.
function MoneyField({
  currency,
  value,
  onValue,
  ariaLabel,
  kind = "boxed",
}: {
  currency: CurrencyCode
  value: number
  onValue: (v: number) => void
  ariaLabel: string
  kind?: "boxed" | "primary"
}) {
  const money = useMoneyInput(currency, value)
  return (
    <Input
      inputMode="numeric"
      value={money.display}
      placeholder={currency === "USD" ? "0,00" : "0"}
      aria-label={ariaLabel}
      onValueChange={(value) => onValue(money.onChange(value))}
      className={cn(
        "tabular",
        kind === "primary" ? primaryMoneyInput : boxedMoneyInput
      )}
    />
  )
}

// Fila de monto: la etiqueta a la izquierda y el campo a la derecha, con ancho fijo para que las
// cifras de un mismo instrumento queden alineadas.
function MoneyRow({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <label className="flex min-h-11 items-center justify-between gap-3 px-4 py-1.5">
      <span className="min-w-0 text-body">{label}</span>
      <span className="w-40 shrink-0">{children}</span>
    </label>
  )
}

// Interruptor de iOS en una fila: la etiqueta entera lo activa.
function SwitchRow({
  checked,
  onChecked,
  children,
}: {
  checked: boolean
  onChecked: (v: boolean) => void
  children: React.ReactNode
}) {
  const id = useId()
  return (
    <div className="flex min-h-11 items-center gap-3 px-4 py-1.5">
      <label htmlFor={id} className="min-w-0 flex-1 py-1 text-body">
        {children}
      </label>
      <Switch id={id} checked={checked} onCheckedChange={onChecked} />
    </div>
  )
}

// Cupo de tarjeta de crédito (nacional CLP / internacional USD): interruptor del bucket y, si está
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
}: {
  label: string
  currency: CurrencyCode
  enabled: boolean
  onEnabled: (v: boolean) => void
  limit: number
  available: number
  onLimit: (v: number) => void
  onAvailable: (v: number) => void
}) {
  return (
    <>
      <SwitchRow checked={enabled} onChecked={onEnabled}>
        {label}
      </SwitchRow>
      {enabled && (
        <>
          <MoneyRow label="Disponible">
            <MoneyField
              currency={currency}
              value={available}
              onValue={onAvailable}
              ariaLabel={`Disponible · ${label}`}
              kind="primary"
            />
          </MoneyRow>
          <MoneyRow label="Cupo total">
            <MoneyField
              currency={currency}
              value={limit}
              onValue={onLimit}
              ariaLabel={`Cupo total · ${label}`}
            />
          </MoneyRow>
          <DerivedUsed
            limit={limit}
            available={available}
            currency={currency}
          />
        </>
      )}
    </>
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
      <p className="px-4 py-2.5 text-footnote font-medium text-destructive">
        El disponible debe estar entre cero y el cupo total
      </p>
    )
  const used = limit - available
  if (used <= 0) return null
  return (
    <p className="tabular px-4 py-2.5 text-footnote text-destructive">
      Usado −{formatMoney(used, currency)}
    </p>
  )
}

// Instrumento propuesto: un grupo por cuenta o tarjeta, con su referencia arriba y sus saldos como
// filas. La persona revisa cada dato antes de confirmar la conexión.
function CandidateCard({
  bankName,
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
  // Un instrumento sin sus 4 dígitos no se puede crear, pero la cuenta se propone vacía a
  // propósito: marcarla en rojo de entrada culpa al usuario de algo que todavía no hizo. El campo
  // se marca recién cuando lo dejó incompleto, y el motivo viaja con él (aria-describedby) porque
  // la acción deshabilitada no recibe foco y su explicación queda fuera del alcance del teclado.
  const [refTouched, setRefTouched] = useState(false)
  const refInvalid = refTouched && !refComplete(refValue)
  const refErrorId = useId()
  return (
    <ModalSection title={`${typeLabel} · ${bankName}`}>
      <div>
        <div className="flex min-h-11 flex-wrap items-center gap-x-2 gap-y-1 px-4 py-1.5">
          <span
            aria-hidden
            className="text-body tracking-widest text-muted-foreground"
          >
            ••••
          </span>
          <Input
            inputMode="numeric"
            maxLength={refMaxLength}
            value={refValue}
            placeholder={refPlaceholder}
            aria-label={refLabel}
            aria-invalid={refInvalid || undefined}
            aria-describedby={refInvalid ? refErrorId : undefined}
            onValueChange={(value) => onRef(value)}
            onBlur={() => setRefTouched(true)}
            style={{ width: 96 }}
            className="tabular text-body tracking-widest"
          />
          {movementCount ? (
            <span className="text-subheadline text-muted-foreground">
              {plural(movementCount, "movimiento", "movimientos")}
            </span>
          ) : null}
          {/* Fuera del título: el encabezado se lee solo con el instrumento, y cada «Quitar» dice
              cuál quita. */}
          <Button
            type="button"
            onClick={onRemove}
            aria-label={`Quitar ${typeLabel}${refValue ? ` ${refValue}` : ""}`}
            className="press ml-auto min-h-11 shrink-0 text-body text-primary"
          >
            Quitar
          </Button>
        </div>
        {refInvalid && (
          <p
            id={refErrorId}
            className="px-4 pb-2.5 text-subheadline text-destructive"
          >
            Faltan los últimos 4 dígitos.
          </p>
        )}
      </div>
      {children}
    </ModalSection>
  )
}

// Aviso como fila de una lista agrupada (va dentro de un ModalSection, nunca como tarjeta suelta).
function Notice({
  icon: Icon,
  tone = "info",
  role,
  children,
}: {
  icon: typeof Mail
  // "warning" separa el aviso que pide una acción del texto informativo: mismo bloque, otro peso.
  tone?: "info" | "warning"
  role?: "alert" | "status"
  children: React.ReactNode
}) {
  const warn = tone === "warning"
  return (
    <div
      role={role}
      className={cn(
        "flex items-start gap-3 px-4 py-3 text-subheadline",
        warn ? "text-foreground" : "text-muted-foreground"
      )}
    >
      <Icon
        aria-hidden
        className={cn(
          "mt-0.5 size-5 shrink-0",
          warn ? "text-warning" : "text-primary"
        )}
      />
      <span className="min-w-0 break-words">{children}</span>
    </div>
  )
}

// Qué se leyó y qué salió de ahí. La procedencia —cuántos correos, de qué mes— va junto al dato:
// sin ella, una revisión que llega sin candidatos parece un error de la app.
export function ScanSummary({
  scan,
  bankName,
}: {
  scan: Pick<
    Scan,
    | "expenseCount"
    | "internalCount"
    | "skippedCount"
    | "totalMessages"
    | "since"
  >
  bankName: string
}) {
  const mes = scanMonthLabel(scan.since)
  // Con el buzón sin avisos del banco, "0 correos revisados" cuenta una lectura que no ocurrió.
  const leidos =
    scan.totalMessages === 0
      ? `Sin correos de ${bankName}`
      : `${plural(scan.totalMessages, "correo revisado", "correos revisados")} de ${bankName}`
  return (
    <ModalSection footer={`${leidos}${mes ? ` · ${mes}` : ""}`}>
      <div className="flex min-h-11 flex-col justify-center px-4 py-2.5">
        <p className="text-body font-medium">
          {plural(scan.expenseCount, "gasto detectado", "gastos detectados")}
        </p>
        <p className="text-subheadline text-muted-foreground">
          {plural(scan.internalCount, "ajuste interno", "ajustes internos")}
          {" · "}
          {plural(scan.skippedCount, "omitido", "omitidos")}
        </p>
      </div>
    </ModalSection>
  )
}

// Por qué la revisión llega como llega y qué tiene que hacer el usuario. El texto se decide en
// lib/bank-setup-guidance; acá solo se pinta cuando hay algo que decir.
export function ScanGuidance({
  scan,
  bankName,
  checking,
  cards,
}: {
  scan: Pick<Scan, "totalMessages" | "primaryCheckingCount">
  bankName: string
  checking: CheckingForm | null
  cards: CardForm[]
}) {
  // bankName va DESPUÉS del spread: el `scan` de producción trae el suyo y pisaría la prop.
  const aviso = scanGuidance({ ...scan, bankName }, formOf(checking, cards))
  if (!aviso) return null
  return (
    <ModalSection>
      <Notice icon={CircleAlert} tone="warning">
        {aviso}
      </Notice>
    </ModalSection>
  )
}
