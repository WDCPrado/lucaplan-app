"use client"

import type { ReactNode } from "react"
import { ExternalLink, Globe } from "lucide-react"
import { ModalSection, ResponsiveModal } from "@/components/ui/responsive-modal"

export type GuideLink = { label: string; href: string }

// Lo que hay que copiar o escribir tal cual: en monoespaciada, seleccionable de un toque.
function Mono({ children }: { children: ReactNode }) {
  return (
    <code className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-subheadline break-all select-all">
      {children}
    </code>
  )
}

// Paso a paso para conseguir cada clave del grupo, en el orden en que se hace en la consola.
function steps(group: string, redirectUri: string): ReactNode[] {
  if (group === "openai")
    return [
      <>
        Entra a <Mono>platform.openai.com/api-keys</Mono> y toca{" "}
        <strong>Create new secret key</strong>.
      </>,
      <>
        Copia la clave (empieza con <Mono>sk-</Mono>): OpenAI la muestra una
        sola vez. Pégala en <strong>Clave de API</strong>.
      </>,
      <>
        En <strong>Settings → Billing</strong> agrega un medio de pago y
        carga saldo. Sin saldo la clave responde con error y no se categoriza
        nada.
      </>,
      <>
        <strong>Modelo</strong> es opcional: si no lo configuras se usa el del
        servidor (<Mono>gpt-4o-mini</Mono>). Para cambiarlo, copia el nombre
        exacto desde{" "}
        <a
          href="https://platform.openai.com/docs/models"
          target="_blank"
          rel="noreferrer"
          className="text-primary underline underline-offset-2"
        >
          los modelos disponibles
        </a>
        , por ejemplo <Mono>gpt-4.1-mini</Mono>.
      </>,
    ]
  if (group === "outlook")
    return [
      <>
        En Microsoft Entra ve a <strong>App registrations → New registration</strong>{" "}
        y ponle un nombre, por ejemplo <Mono>Luca Plan</Mono>.
      </>,
      <>
        En <strong>Supported account types</strong> elige{" "}
        <strong>Personal Microsoft accounts only</strong>: los avisos del banco
        llegan a tu Outlook o Hotmail personal.
      </>,
      <>
        En <strong>Redirect URI</strong> elige la plataforma{" "}
        <strong>Web</strong> y pega la de la fila «Redirect URI»:{" "}
        <Mono>{redirectUri}</Mono>. Toca <strong>Register</strong>.
      </>,
      <>
        En <strong>Overview</strong> copia <strong>Application (client) ID</strong>:
        es el <strong>Client ID</strong>.
      </>,
      <>
        En <strong>Certificates &amp; secrets → New client secret</strong>{" "}
        crea uno y copia su <strong>Value</strong> al tiro, no el Secret ID:
        se muestra una sola vez. Es el <strong>Client secret</strong>.
      </>,
      <>
        En <strong>API permissions → Add a permission → Microsoft Graph →
        Delegated permissions</strong> marca solo <Mono>Mail.Read</Mono>. Nada más: Luca Plan solo lee; el
        acceso sin conexión se pide solo al conectar.
      </>,
      <>
        En <strong>Tenant</strong> escribe <Mono>consumers</Mono>, que calza con
        las cuentas personales del paso 2. Si lo dejas sin configurar, se usa ese.
      </>,
    ]
  return [
    <>
      En <Mono>resend.com/api-keys</Mono> toca <strong>Create API key</strong>{" "}
      con permiso <strong>Sending access</strong>. Cópiala y pégala en{" "}
      <strong>Clave de API</strong>.
    </>,
    <>
      En <Mono>resend.com/domains</Mono> agrega tu dominio, por ejemplo{" "}
      <Mono>lucaplan.cl</Mono>.
    </>,
    <>
      Copia los registros DNS que te muestra Resend (MX, SPF y DKIM) en el
      panel de tu dominio y espera a que quede <strong>Verified</strong>.
    </>,
    <>
      En <strong>Remitente</strong> escribe el dominio y después el nombre y
      la dirección. Se arma solo:{" "}
      <Mono>Lucaplan &lt;notificaciones@lucaplan.cl&gt;</Mono>.
    </>,
  ]
}

export function IntegrationGuideModal({
  group,
  onOpenChange,
  redirectUri,
}: {
  group: { id: string; name: string; links: GuideLink[] } | null
  onOpenChange: (open: boolean) => void
  redirectUri: string
}) {
  return (
    <ResponsiveModal
      className="sm:max-w-lg"
      open={group !== null}
      onOpenChange={onOpenChange}
      title={group ? `Cómo conseguir las claves de ${group.name}` : ""}
    >
      {group && (
        <div className="flex flex-col gap-6 px-5 pb-6">
          <ol className="flex flex-col gap-4">
            {steps(group.id, redirectUri).map((step, i) => (
              <li key={i} className="flex gap-3 text-body text-pretty">
                <span
                  aria-hidden
                  className="tabular grid size-6 shrink-0 place-items-center rounded-full bg-primary text-footnote font-semibold text-primary-foreground"
                >
                  {i + 1}
                </span>
                <span className="min-w-0 pt-px">{step}</span>
              </li>
            ))}
          </ol>
          {group.id === "outlook" && (
            <div className="sheet-group flex items-start gap-3 rounded-xl p-4">
              <Globe aria-hidden className="mt-0.5 size-5 shrink-0 text-primary" />
              <div className="flex min-w-0 flex-col gap-2 text-subheadline text-pretty">
                <p className="font-semibold">¿Hace falta un dominio público?</p>
                <p>
                  Para conectar el buzón y hacer la primera importación, no: el
                  login con Microsoft vuelve a <Mono>localhost</Mono> porque lo
                  abre tu propio navegador.
                </p>
                <p>
                  Los avisos automáticos de correos nuevos sí: Microsoft tiene que
                  llegar a una URL HTTPS pública, que va en la variable del
                  servidor{" "}
                  <Mono>OUTLOOK_WEBHOOK_URL=https://tu-dominio/api/email-connection/webhook</Mono>.
                  Sin ella, en local sincronizas con el botón «Sincronizar».
                </p>
                <p>
                  En producción, la Redirect URI de Entra es la de tu dominio
                  público, en HTTPS.
                </p>
              </div>
            </div>
          )}
          <ModalSection title="Enlaces">
            {group.links.map((link) => (
              <a
                key={link.href}
                href={link.href}
                target="_blank"
                rel="noreferrer"
                className="press flex min-h-11 items-center gap-3 px-4 py-2.5 text-body text-primary hover:bg-accent/60"
              >
                <span className="flex-1">{link.label}</span>
                <ExternalLink aria-hidden className="size-4 shrink-0" />
              </a>
            ))}
          </ModalSection>
        </div>
      )}
    </ResponsiveModal>
  )
}
