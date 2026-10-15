import { auth } from "@/arch/v1/infrastructure/auth/auth"
import { getPluginConfig } from "@/arch/v1/infrastructure/auth/plugin-config"
import { pluginConnectionStore } from "@/arch/v1/infrastructure/auth/plugin-auth"
import {
  revokePluginConnection,
  PluginConnectionNotFoundError,
} from "@/arch/v1/application/plugin-use-cases/plugin-auth-use-cases"

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const session = await auth.api.getSession({
    headers: request.headers,
    query: { disableCookieCache: true },
  })
  if (!session || session.user.banned)
    return Response.json({ error: "No autorizado." }, { status: 401 })
  try {
    const { origin } = getPluginConfig()
    // Las cookies solo autorizan mutaciones iniciadas desde el origen canónico de Luca Plan.
    if (
      request.headers.get("origin") !== origin ||
      request.headers.get("sec-fetch-site") === "cross-site"
    ) {
      return Response.json({ error: "Origen no autorizado." }, { status: 403 })
    }
    const { id } = await context.params
    await revokePluginConnection(pluginConnectionStore, session.user.id, id)
    return new Response(null, {
      status: 204,
      headers: { "Cache-Control": "no-store" },
    })
  } catch (error) {
    if (error instanceof PluginConnectionNotFoundError)
      return Response.json({ error: error.message }, { status: 404 })
    return Response.json(
      { error: "No se pudo revocar la conexión." },
      { status: 500 }
    )
  }
}
