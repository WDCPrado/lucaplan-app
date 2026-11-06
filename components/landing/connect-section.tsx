import Image from "next/image"
import { Bell, Bot, Lock, Mail, ShieldCheck } from "lucide-react"
import { GmailIcon, OutlookIcon } from "@/app/login/mail-app-icons"
import { newMovementsMessage } from "@/arch/v1/application/notification-use-cases/notification-rules"
import { homeMovements } from "./landing-data"

const delay = (ms: number) =>
  ({ "--reveal-delay": `${ms}ms` }) as React.CSSProperties

const banks = [
  { name: "Banco de Chile", note: "Cuentas y tarjetas" },
  { name: "Banco BICE", note: "Cuentas y tarjetas" },
  { name: "MACHBANK", note: "Solo débito" },
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
        <h2 className="text-[clamp(2rem,4.5vw,3rem)] leading-[1.05] font-bold tracking-[-0.03em] text-balance">
          Tu banco ya te avisa. Luca Plan escucha.
        </h2>
        <p className="mt-5 text-title-3 font-normal text-pretty text-muted-foreground">
          Cada compra genera un correo del banco. Luca Plan lee solo esos
          avisos y los convierte en movimientos, sin agregadores de por medio.
        </p>
      </div>

      <div className="mt-12 grid gap-4 lg:grid-cols-3">
        <div data-reveal className="flex flex-col gap-6 rounded-xl bg-card p-5 lg:col-span-2 lg:row-span-2 lg:p-6">
          <div>
            <h3 className="text-footnote tracking-wide text-muted-foreground uppercase">
              Bancos disponibles
            </h3>
            <ul className="mt-3 grid gap-2 sm:grid-cols-3">
              {banks.map((b) => (
                <li key={b.name} className="rounded-lg bg-secondary px-4 py-3">
                  <p className="text-headline font-semibold">{b.name}</p>
                  <p className="text-footnote text-muted-foreground">{b.note}</p>
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

        <div data-reveal style={delay(200)} className="flex flex-col gap-4 rounded-xl bg-card p-5 lg:p-6">
          <ul aria-hidden className="flex flex-wrap gap-1.5">
            {["lucaplan_resumen_mes", "lucaplan_buscar_movimientos", "lucaplan_conciliar_cartola"].map(
              (t) => (
                <li key={t} className="rounded-md bg-secondary px-2 py-1 font-mono text-caption text-muted-foreground">
                  {t}
                </li>
              )
            )}
          </ul>
          <div>
            <h3 className="flex items-center gap-2 text-headline font-semibold">
              <Bot aria-hidden className="size-4 text-primary" />
              Desde tu asistente
            </h3>
            <p className="mt-1 text-subheadline text-pretty text-muted-foreground">
              El plugin MCP consulta y administra tu plan desde un asistente
              compatible. Tú autorizas la conexión con OAuth.
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
