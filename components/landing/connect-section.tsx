import Image from "next/image"
import { Bell, Bot, Lock, Mail, ShieldCheck } from "lucide-react"
import { GmailIcon, OutlookIcon } from "@/app/login/mail-app-icons"
import { newMovementsMessage } from "@/arch/v1/application/notification-use-cases/notification-rules"
import { BANK_EMAIL_REGISTRY } from "@/arch/v1/application/finance-use-cases/bank-email-registry"
import { COMING_SOON_BANKS } from "@/lib/coming-soon-banks"
import { CopyButton } from "./copy-button"
import { GITHUB_URL, homeMovements } from "./landing-data"

const delay = (ms: number) =>
  ({ "--reveal-delay": `${ms}ms` }) as React.CSSProperties

// Los bancos con adaptador salen del registro que usa la importación (componente de servidor: los
// parsers no viajan al cliente); los que vienen después, de la misma lista que muestra la app.
const BANK_DETAIL: Record<string, string> = {
  machbank: "Solo débito",
}
const connectedBanks = BANK_EMAIL_REGISTRY.map((b) => ({
  name: b.name,
  note: BANK_DETAIL[b.key] ?? "Cuentas y tarjetas",
}))

// Cómo se conecta cada asistente al servidor MCP de tu instancia (docs/plugin-luca-plan.md).
const MCP_URL = "https://<tu-dominio>/api/mcp"
const PLUGIN_DOCS_URL = `${GITHUB_URL}/blob/master/docs/plugin-luca-plan.md`
const MCP_PATHS = [
  {
    name: "Claude (web y Desktop)",
    step: "Ajustes → Conectores → Agregar conector personalizado, con esta URL.",
    copy: MCP_URL,
  },
  {
    name: "ChatGPT",
    step: "En modo desarrollador, Add custom MCP server con esta URL y autenticación OAuth.",
    copy: MCP_URL,
  },
  {
    name: "Claude Code",
    step: "Agrégalo desde la terminal.",
    copy: `claude mcp add --transport http luca-plan ${MCP_URL}`,
  },
] as const

const privacy = [
  [Lock, "Permiso de solo lectura (Mail.Read), revocable. No puede enviar, mover ni borrar correos."],
  [Mail, "Solo se procesan los remitentes oficiales del banco. El resto de tu correo no se lee."],
  [ShieldCheck, "Nunca conoce tus claves bancarias y no puede mover tu dinero."],
] as const

// Conexión, avisos y asistentes en una grilla: la celda grande es la conexión por correo (lo que
// hace distinto al producto); las dos chicas, lo que pasa después: push y el plugin MCP.
export function ConnectSection() {
  // El texto del aviso sale de la misma regla que arma los push reales.
  const m = homeMovements[0]
  const push = newMovementsMessage([
    { description: m.description, amount: m.amount, currency: "CLP", direction: "debit", category: m.categoryName },
  ])
  return (
    <section
      id="conecta"
      className="mx-auto max-w-6xl scroll-mt-24 px-5 py-20 lg:px-8 lg:py-28"
    >
      <div data-reveal className="max-w-2xl">
        <h2 className="landing-title text-balance">
          Tu banco ya te avisa. Luca Plan escucha.
        </h2>
        <p className="mt-5 text-title-3 font-normal text-pretty text-muted-foreground">
          Cada compra genera un correo del banco. Luca Plan lee solo esos
          avisos y los convierte en movimientos, sin agregadores de por medio.
        </p>
      </div>

      <div className="mt-12 grid gap-4 lg:grid-cols-3">
        <div data-reveal className="flex flex-col gap-6 rounded-xl bg-card p-5 lg:col-span-2 lg:p-6">
          <div>
            <h3 className="text-footnote tracking-wide text-muted-foreground uppercase">
              Conectados hoy
            </h3>
            <ul className="mt-3 grid gap-2 sm:grid-cols-3">
              {connectedBanks.map((b) => (
                <li key={b.name} className="rounded-lg bg-secondary px-4 py-3">
                  <p className="text-headline font-semibold">{b.name}</p>
                  <p className="text-footnote text-muted-foreground">{b.note}</p>
                </li>
              ))}
            </ul>
            <h3 className="mt-6 text-footnote tracking-wide text-muted-foreground uppercase">
              Próximamente
            </h3>
            <ul className="mt-3 flex flex-wrap gap-2">
              {COMING_SOON_BANKS.map((name) => (
                <li
                  key={name}
                  className="rounded-lg border border-dashed border-border px-3 py-1.5 text-subheadline text-muted-foreground"
                >
                  {name}
                </li>
              ))}
            </ul>
            <p className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-subheadline text-muted-foreground">
              Vía
              <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                <OutlookIcon aria-hidden /> Outlook
              </span>
              hoy. Un mismo correo puede alimentar varios bancos.
              <span className="inline-flex items-center gap-1.5">
                <GmailIcon aria-hidden /> Gmail, próximamente.
              </span>
            </p>
          </div>
          <ul className="inset-list overflow-hidden rounded-xl bg-secondary [--inset:3.25rem]">
            {privacy.map(([Icon, text]) => (
              <li key={text} className="flex min-h-11 items-start gap-3 px-4 py-3">
                <Icon aria-hidden className="mt-0.5 size-5 shrink-0 text-primary" />
                <span className="text-subheadline text-pretty">{text}</span>
              </li>
            ))}
          </ul>
        </div>

        <div data-reveal style={delay(120)} className="flex flex-col gap-4 rounded-xl bg-card p-5 lg:p-6">
          {/* El aviso tal como llega: banner de sistema con el ícono de la app. */}
          <div aria-hidden className="material flex items-start gap-3 rounded-(--radius-sheet) p-3">
            <Image
              src="/icons/icon-192.png"
              alt=""
              width={36}
              height={36}
              className="size-9 shrink-0 rounded-lg"
            />
            <div className="min-w-0 text-footnote">
              <p className="font-semibold">{push?.title}</p>
              <p className="truncate text-muted-foreground">{push?.body}</p>
            </div>
          </div>
          <div>
            <h3 className="flex items-center gap-2 text-headline font-semibold">
              <Bell aria-hidden className="size-4 text-primary" />
              Avisos donde estés
            </h3>
            <p className="mt-1 text-subheadline text-pretty text-muted-foreground">
              Movimientos nuevos, umbrales de presupuesto que tú defines y pagos
              por vencer. En Android, Windows e iOS 16.4+ con la app en inicio.
            </p>
          </div>
        </div>

        <div data-reveal style={delay(200)} className="grid gap-6 rounded-xl bg-card p-5 lg:col-span-3 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] lg:gap-10 lg:p-6">
          <div>
            <h3 className="flex items-center gap-2 text-headline font-semibold">
              <Bot aria-hidden className="size-4 text-primary" />
              Conecta tu asistente
            </h3>
            <p className="mt-1 text-subheadline text-pretty text-muted-foreground">
              El plugin MCP consulta y administra tu plan desde un asistente
              compatible. Inicias sesión en Luca Plan y apruebas los permisos;
              lo revocas cuando quieras.
            </p>
            <a
              href={PLUGIN_DOCS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex min-h-11 items-center text-subheadline text-primary underline-offset-2 hover:underline"
            >
              Guía del plugin
            </a>
          </div>
          <ul className="inset-list overflow-hidden rounded-xl bg-secondary">
            {MCP_PATHS.map((p) => (
              <li key={p.name} className="flex flex-col gap-2 px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-body font-semibold">{p.name}</p>
                    <p className="text-footnote text-pretty text-muted-foreground">{p.step}</p>
                  </div>
                  <CopyButton text={p.copy} />
                </div>
                <code className="block overflow-x-auto rounded-md bg-card px-3 py-2 font-mono text-footnote whitespace-nowrap">
                  {p.copy}
                </code>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}
