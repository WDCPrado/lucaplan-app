"use client"

import { Suspense, use, useState, useSyncExternalStore } from "react"
import {
  Check,
  ChevronRight,
  Copy,
  ExternalLink,
  Lock,
  Mail,
  Send,
  Sparkles,
} from "lucide-react"
import { toast } from "sonner"
import {
  INTEGRATION_KEYS,
  type IntegrationKey,
  type IntegrationsStatus,
} from "@/lib/integration-settings-schemas"
import { haptic } from "@/lib/haptics"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ApiError, getIntegrations, updateIntegrations } from "./http"
import {
  IntegrationModal,
  KEY_LABEL,
  type SaveIntegrations,
} from "./integration-modal"

// Mismo grupo inset grouped que el resto de Ajustes (settings-view.tsx).
const GROUP = "inset-list overflow-hidden rounded-xl bg-card"

const README_OUTLOOK =
  "https://github.com/WDCPrado/lucaplan-app#-conectar-outlook-banco-de-chile-paso-a-paso"

export type IntegrationGroup = "openai" | "outlook" | "resend"

const GROUPS: {
  id: IntegrationGroup
  name: string
  purpose: string
  icon: typeof Sparkles
  keys: IntegrationKey[]
}[] = [
  {
    id: "openai",
    name: "OpenAI",
    purpose: "Categoriza tus movimientos y propone categorías.",
    icon: Sparkles,
    keys: ["OPENAI_API_KEY", "OPENAI_MODEL"],
  },
  {
    id: "outlook",
    name: "Outlook",
    purpose: "Lee los avisos de tu banco que llegan al correo.",
    icon: Mail,
    keys: ["OUTLOOK_CLIENT_ID", "OUTLOOK_CLIENT_SECRET", "OUTLOOK_TENANT"],
  },
  {
    id: "resend",
    name: "Resend",
    purpose: "Envía los códigos de acceso por correo.",
    icon: Send,
    keys: ["RESEND_API_KEY", "RESEND_FROM"],
  },
]

const dateFmt = new Intl.DateTimeFormat("es-CL", {
  day: "numeric",
  month: "short",
  year: "numeric",
})

const noop = () => () => {}

// Un GET que falla no lanza: vuelve como valor, así la pantalla muestra el aviso en línea con
// Reintentar en vez de caer entera a la pantalla de error de Next. La usa también /setup.
export type LoadFailure = { loadError: string }

export function catchLoad<T>(request: Promise<T>): Promise<T | LoadFailure> {
  return request.catch((error: unknown) => ({
    loadError:
      error instanceof ApiError
        ? error.message
        : "No se pudo cargar. Revisa tu conexión",
  }))
}

export function isLoadFailure(value: unknown): value is LoadFailure {
  return typeof value === "object" && value !== null && "loadError" in value
}

export function LoadError({
  message,
  onRetry,
}: {
  message: string
  onRetry: () => void
}) {
  return (
    <div className="flex flex-col items-start gap-3">
      <p role="alert" className="text-subheadline text-destructive">
        {message}
      </p>
      <Button
        type="button"
        variant="outline"
        className="h-11"
        onClick={onRetry}
      >
        Reintentar
      </Button>
    </div>
  )
}

// Los datos se piden en el cliente (GET /api/integrations); en el servidor no hay sesión que
// reenviar, así que hasta hidratar se ve el esqueleto.
export function IntegrationsGroups({ redirectUri }: { redirectUri: string }) {
  const hydrated = useSyncExternalStore(
    noop,
    () => true,
    () => false
  )
  // La promesa vive aquí, que sí se monta: si la creara el hijo que suspende, React la volvería a
  // crear en cada reintento y nunca saldría del esqueleto. Reintentar la reemplaza por una nueva.
  const [request, setRequest] = useState(() =>
    typeof window === "undefined" ? null : catchLoad(getIntegrations())
  )
  if (!hydrated || !request) return <GroupsSkeleton />
  return (
    <Suspense fallback={<GroupsSkeleton />}>
      <Loaded
        request={request}
        redirectUri={redirectUri}
        onRetry={() => setRequest(catchLoad(getIntegrations()))}
      />
    </Suspense>
  )
}

function GroupsSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy>
      {GROUPS.map((g) => (
        <Skeleton key={g.id} className="h-40 rounded-xl" />
      ))}
    </div>
  )
}

function Loaded({
  request,
  redirectUri,
  onRetry,
}: {
  request: Promise<IntegrationsStatus | LoadFailure>
  redirectUri: string
  onRetry: () => void
}) {
  const result = use(request)
  if (isLoadFailure(result))
    return <LoadError message={result.loadError} onRetry={onRetry} />
  return <LoadedList initial={result} redirectUri={redirectUri} />
}

function LoadedList({
  initial,
  redirectUri,
}: {
  initial: IntegrationsStatus
  redirectUri: string
}) {
  const [status, setStatus] = useState(initial)
  return (
    <IntegrationsList
      status={status}
      onStatus={setStatus}
      save={updateIntegrations}
      redirectUri={redirectUri}
    />
  )
}

// Las filas y el modal, sin cargar nada: los usan Ajustes y la instalación inicial (/setup), cada
// uno con su estado y su PUT. `groups` elige cuáles se muestran.
export function IntegrationsList({
  status,
  onStatus,
  save,
  redirectUri,
  groups,
}: {
  status: IntegrationsStatus
  onStatus: (status: IntegrationsStatus) => void
  save: SaveIntegrations
  redirectUri: string
  groups?: IntegrationGroup[]
}) {
  const [editing, setEditing] = useState<IntegrationKey | null>(null)
  const byKey = new Map(status.entries.map((e) => [e.key, e]))

  return (
    <div className="flex flex-col gap-6">
      {GROUPS.filter((g) => !groups || groups.includes(g.id)).map((group) => (
        <div key={group.id} className={GROUP}>
          <div className="flex items-center gap-3 px-4 py-3">
            <span
              aria-hidden
              className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground"
            >
              <group.icon className="size-4.5" />
            </span>
            <span className="grid min-w-0 flex-1">
              <h3 className="text-headline font-semibold">{group.name}</h3>
              <span className="text-footnote text-muted-foreground">
                {group.purpose}
              </span>
            </span>
          </div>
          {group.keys.map((key) => {
            const entry = byKey.get(key)
            return (
              <KeyRow
                key={key}
                secret={INTEGRATION_KEYS[key].secret}
                id={`integration-${key}`}
                label={KEY_LABEL[key]}
                source={entry?.source ?? "none"}
                display={entry?.display ?? null}
                updatedAt={entry?.updatedAt ?? null}
                onEdit={() => setEditing(key)}
              />
            )
          })}
          {group.id === "outlook" && (
            <>
              <RedirectUriRow uri={redirectUri} />
              <a
                href={README_OUTLOOK}
                target="_blank"
                rel="noreferrer"
                className="press flex min-h-11 items-center gap-3 px-4 py-2.5 text-body text-primary hover:bg-accent/60"
              >
                <span className="flex-1">
                  Cómo crear la app en Microsoft Entra
                </span>
                <ExternalLink aria-hidden className="size-4 shrink-0" />
              </a>
            </>
          )}
        </div>
      ))}
      <IntegrationModal
        entry={editing ? (byKey.get(editing) ?? null) : null}
        onOpenChange={(open) => !open && setEditing(null)}
        save={save}
        onSaved={(next) => {
          onStatus(next)
          setEditing(null)
        }}
      />
    </div>
  )
}

function statusText(source: "env" | "app" | "none", display: string | null) {
  if (source === "env") return "Desde el servidor (variable de entorno)"
  if (source === "app")
    return display ? `Configurada ${display}` : "Configurada"
  return "Sin configurar"
}

function KeyRow({
  secret,
  id,
  label,
  source,
  display,
  updatedAt,
  onEdit,
}: {
  secret: boolean
  id: string
  label: string
  source: "env" | "app" | "none"
  display: string | null
  updatedAt: string | null
  onEdit: () => void
}) {
  const content = (
    <span className="grid min-w-0 flex-1">
      <span className="text-body">{label}</span>
      <span
        className={cn(
          "truncate text-footnote",
          source === "none" ? "text-muted-foreground" : "text-foreground/80"
        )}
      >
        {statusText(source, display)}
      </span>
      {/* Del entorno, lo que no es secreto (client id, tenant, modelo) se ve completo. */}
      {source === "env" && !secret && display && (
        <span className="text-footnote break-all text-muted-foreground">
          {display}
        </span>
      )}
      {source === "app" && updatedAt && (
        <span className="text-footnote text-muted-foreground">
          Actualizada el {dateFmt.format(new Date(updatedAt))}
        </span>
      )}
    </span>
  )

  // Del entorno: manda el servidor y no se edita aquí. Fila quieta, con candado, no un botón.
  if (source === "env")
    return (
      <div
        id={id}
        aria-disabled
        className="flex min-h-11 items-center gap-3 px-4 py-2.5 text-muted-foreground"
      >
        {content}
        <Lock aria-hidden className="size-4 shrink-0" />
      </div>
    )

  return (
    <button
      id={id}
      type="button"
      aria-haspopup="dialog"
      onClick={onEdit}
      className="press flex min-h-11 w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-accent/60"
    >
      {content}
      <ChevronRight aria-hidden className="disclosure" />
    </button>
  )
}

function RedirectUriRow({ uri }: { uri: string }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(uri)
      haptic("light")
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error(
        "No se pudo copiar. Selecciona la dirección y cópiala a mano."
      )
    }
  }

  return (
    <div className="flex min-h-11 items-center gap-3 py-1.5 pr-2 pl-4">
      <span className="grid min-w-0 flex-1">
        <span className="text-body">Redirect URI</span>
        <span className="text-footnote break-all text-muted-foreground select-all">
          {uri}
        </span>
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={copy}
        aria-label={copied ? "Redirect URI copiada" : "Copiar Redirect URI"}
        className="size-11 shrink-0 text-primary"
      >
        {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
      </Button>
    </div>
  )
}
