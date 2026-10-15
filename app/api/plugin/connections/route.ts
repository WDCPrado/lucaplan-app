import { auth } from "@/arch/v1/infrastructure/auth/auth"
import { pluginConnectionStore } from "@/arch/v1/infrastructure/auth/plugin-auth"

export async function GET(request: Request) {
  const session = await auth.api.getSession({
    headers: request.headers,
    query: { disableCookieCache: true },
  })
  if (!session || session.user.banned)
    return Response.json({ error: "No autorizado." }, { status: 401 })
  try {
    const connections = await pluginConnectionStore.list(session.user.id)
    return Response.json(
      { connections },
      { headers: { "Cache-Control": "no-store" } }
    )
  } catch {
    return Response.json(
      { error: "No se pudieron consultar las conexiones." },
      { status: 500 }
    )
  }
}
