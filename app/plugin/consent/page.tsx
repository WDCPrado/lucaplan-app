import { headers } from "next/headers"
import { redirect } from "next/navigation"
import Link from "next/link"
import { auth } from "@/arch/v1/infrastructure/auth/auth"
import { verifyPluginConsentQuery } from "@/arch/v1/infrastructure/auth/plugin-consent"
import { ConsentForm } from "@/components/plugin/consent-form"
import { PluginFrame } from "@/components/plugin/plugin-frame"

export default async function PluginConsentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(await searchParams)) {
    if (Array.isArray(value)) value.forEach((item) => query.append(key, item))
    else if (value !== undefined) query.append(key, value)
  }
  const oauthQuery = query.toString()
  let request
  try {
    request = await verifyPluginConsentQuery(oauthQuery)
  } catch {
    return (
      <PluginFrame>
        <h2 className="font-heading text-2xl font-semibold tracking-tight">
          No se pudo iniciar la conexión
        </h2>
        <p
          id="plugin-consent-error"
          role="alert"
          className="mt-4 text-base text-muted-foreground"
        >
          El enlace de conexión no es válido o venció. Vuelve al asistente e
          inicia la conexión de nuevo.
        </p>
        <Link
          href="/plugin"
          className="mt-6 inline-flex min-h-11 items-center text-sm underline underline-offset-4"
        >
          Ver mis conexiones
        </Link>
      </PluginFrame>
    )
  }
  const requestHeaders = await headers()
  const session = await auth.api.getSession({
    headers: requestHeaders,
    query: { disableCookieCache: true },
  })
  if (!session || session.user.banned) redirect(`/login?${oauthQuery}`)
  return (
    <PluginFrame>
      <ConsentForm
        email={session.user.email}
        clientName={request.clientName || "El asistente"}
        scopes={request.scopes}
        oauthQuery={oauthQuery}
      />
    </PluginFrame>
  )
}
