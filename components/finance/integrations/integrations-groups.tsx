"use client"

import { Suspense, use, useState, useSyncExternalStore } from "react"
import {
  Check,
  ChevronRight,
  Copy,
  ExternalLink,
  Info,
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
import { IconTile, InlineNotice } from "../blocks"
import { ApiError, getIntegrations, updateIntegrations } from "./http"
import { IntegrationGuideModal } from "./integration-guide"
import {
  IntegrationModal,
  KEY_LABEL,
  type SaveIntegrations,
} from "./integration-modal"

// Cada proveedor es un grupo en tono dentro de la tarjeta de Ajustes (sin tarjeta dentro de
// tarjeta). Sus filas sangran hasta el borde del grupo y se marcan en un tono más al pasar.
const GROUP = "flex min-w-0 flex-col gap-1 rounded-lg bg-secondary p-3"
const ROW =
  "press -mx-2 flex min-h-11 w-[calc(100%+1rem)] items-center gap-3 rounded-md px-2 py-2 text-left"

const README_OUTLOOK =
  "https://github.com/WDCPrado/lucaplan-app#-conectar-outlook-banco-de-chile-paso-a-paso"

export type IntegrationGroup = "openai" | "outlook" | "resend"

const GROUPS: {
  id: IntegrationGroup
  name: string
  purpose: string
  icon: typeof Sparkles
  keys: IntegrationKey[]
  // Dónde se saca cada clave: la consola del proveedor y, si hay, la guía paso a paso.
  links: { label: string; href: string }[]
}[] = [
  {
    id: "openai",
    name: "OpenAI",
    purpose: "Categoriza tus movimientos y propone categorías.",
    icon: Sparkles,
    keys: ["OPENAI_API_KEY", "OPENAI_MODEL"],
    links: [
      { label: "Crear una API key en OpenAI", href: "https://platform.openai.com/api-keys" },
      { label: "Ver los modelos disponibles", href: "https://platform.openai.com/docs/models" },
    ],
  },
  {
    id: "outlook",
    name: "Outlook",
    purpose: "Lee los avisos de tu banco que llegan al correo.",
    icon: Mail,
    keys: ["OUTLOOK_CLIENT_ID", "OUTLOOK_CLIENT_SECRET", "OUTLOOK_TENANT"],
    links: [
      {
        label: "Registrar la app en Microsoft Entra",
        href: "https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade",
      },
      { label: "Guía paso a paso", href: README_OUTLOOK },
    ],
  },
  {
    id: "resend",
    name: "Resend",
    purpose: "Envía los códigos de acceso por correo.",
    icon: Send,
    keys: ["RESEND_API_KEY", "RESEND_FROM"],
    links: [
      { label: "Crear una API key en Resend", href: "https://resend.com/api-keys" },
      { label: "Verificar el dominio del remitente", href: "https://resend.com/domains" },
    ],
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
      {/* El mensaje de la API puede ser largo: se deja envolver en vez de cortarse. */}
      <InlineNotice tone="alert" label={message} wrap />
      <Button type="button" variant="secondary" onClick={onRetry}>
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
    <div className="@container" aria-busy>
      <div className="grid gap-3 @3xl:grid-cols-3">
        {GROUPS.map((g) => (
          <Skeleton key={g.id} className="h-56 rounded-lg" />
        ))}
      </div>
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
  const [guide, setGuide] = useState<IntegrationGroup | null>(null)
  const byKey = new Map(status.entries.map((e) => [e.key, e]))

  return (
    <div className="@container">
      {/* Tres proveedores lado a lado solo si el contenedor da (Ajustes ancho); si no, uno bajo otro. */}
      <div className="grid items-start gap-3 @3xl:grid-cols-3">
      {GROUPS.filter((g) => !groups || groups.includes(g.id)).map((group) => (
        <div key={group.id} className={GROUP}>
          <div className="mb-1 flex items-center gap-3">
            <IconTile>
              <group.icon />
            </IconTile>
            <span className="grid min-w-0 flex-1">
              <h3 className="font-semibold">{group.name}</h3>
              <span className="text-callout text-ink-2">
                {group.purpose}
              </span>
            </span>
            <Button
             
              type="button"
              variant="ghost"
              size="icon"
              aria-haspopup="dialog"
              aria-label={`Cómo conseguir las claves de ${group.name}`}
              onClick={() => setGuide(group.id)}
              className="-mr-1 size-11 shrink-0 text-primary hover:bg-primary-soft hover:text-primary"
            >
              <Info aria-hidden className="size-5" />
            </Button>
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
          {group.id === "outlook" && <RedirectUriRow uri={redirectUri} />}
          {group.links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              target="_blank"
              rel="noreferrer"
              className={cn(ROW, "font-semibold text-primary hover:bg-primary-soft")}
            >
              <span className="min-w-0 flex-1">{link.label}</span>
              <ExternalLink aria-hidden className="size-4 shrink-0" />
            </a>
          ))}
        </div>
      ))}
      </div>
      <IntegrationGuideModal
        group={GROUPS.find((g) => g.id === guide) ?? null}
        onOpenChange={(open) => !open && setGuide(null)}
        redirectUri={redirectUri}
      />
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
      <span className="font-semibold">{label}</span>
      <span
        className={cn(
          "truncate text-callout",
          source === "none" ? "text-ink-3" : "text-ink-2"
        )}
      >
        {statusText(source, display)}
      </span>
      {/* Del entorno, lo que no es secreto (client id, tenant, modelo) se ve completo. */}
      {source === "env" && !secret && display && (
        <span className="text-caption break-all text-ink-3">
          {display}
        </span>
      )}
      {source === "app" && updatedAt && (
        <span className="text-caption text-ink-3">
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
        className={cn(ROW, "text-ink-2")}
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
      className={cn(ROW, "hover:bg-surface-3")}
    >
      {content}
      <ChevronRight aria-hidden className="size-4 shrink-0 text-ink-3" />
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
    <div className={cn(ROW, "pr-0")}>
      <span className="grid min-w-0 flex-1">
        <span className="font-semibold">Redirect URI</span>
        <span className="text-caption break-all text-ink-3 select-all">
          {uri}
        </span>
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={copy}
        aria-label={copied ? "Redirect URI copiada" : "Copiar Redirect URI"}
        className="size-11 shrink-0 text-primary hover:bg-primary-soft hover:text-primary"
      >
        {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
      </Button>
    </div>
  )
}
