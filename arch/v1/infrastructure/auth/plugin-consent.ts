import { auth } from "./auth.ts"
import { pluginOAuthScopeSchema } from "../../../../lib/schemas/plugin-auth.ts"

// La misma firma y caducidad que exige el proveedor al aceptar el consentimiento.
// No mostramos permisos tomados de una URL sin verificar.
export async function verifyPluginConsentQuery(oauthQuery: string) {
  if (!oauthQuery || oauthQuery.length > 12000)
    throw new Error("Solicitud de conexión inválida")
  const query = new URLSearchParams(oauthQuery)
  if (
    query.getAll("client_id").length !== 1 ||
    query.getAll("scope").length !== 1
  )
    throw new Error("Solicitud de conexión inválida")
  const clientId = query.get("client_id")!
  const client = await auth.api.getOAuthClientPublicPrelogin({
    body: { client_id: clientId, oauth_query: oauthQuery },
  })
  const scopes = query
    .get("scope")!
    .split(/\s+/)
    .filter(Boolean)
    .map((scope) => pluginOAuthScopeSchema.parse(scope))
  if (!scopes.some((scope) => scope.startsWith("finance:")))
    throw new Error("Faltan permisos financieros")
  return { clientId, scopes, clientName: client.client_name ?? null }
}
