import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { auth } from "@/arch/v1/infrastructure/auth/auth"
import { pluginConnectionStore } from "@/arch/v1/infrastructure/auth/plugin-auth"
import { pluginConnectionsSchema } from "@/lib/schemas/plugin-auth"
import { ConnectionsView } from "@/components/plugin/connections-view"
import { PluginFrame } from "@/components/plugin/plugin-frame"

export default async function PluginPage() {
  const session = await auth.api.getSession({
    headers: await headers(),
    query: { disableCookieCache: true },
  })
  if (!session || session.user.banned) redirect("/login")
  let connections = null
  try {
    const rows = await pluginConnectionStore.list(session.user.id)
    connections = pluginConnectionsSchema.parse({
      connections: rows.map((row) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
    }).connections
  } catch {
    // La vista permite reintentar sin exponer detalles de infraestructura.
  }
  return (
    <PluginFrame>
      <ConnectionsView
        email={session.user.email}
        initialConnections={connections}
      />
    </PluginFrame>
  )
}
