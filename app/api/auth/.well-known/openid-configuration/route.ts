import { auth } from "@/arch/v1/infrastructure/auth/auth"
import { getPluginConfig } from "@/arch/v1/infrastructure/auth/plugin-config"

export async function GET() {
  try {
    getPluginConfig()
    const metadata: Record<string, unknown> = {
      ...(await auth.api.getOpenIdConfig()),
    }
    delete metadata.introspection_endpoint
    delete metadata.introspection_endpoint_auth_methods_supported
    return Response.json(metadata, { headers: { "Cache-Control": "no-store" } })
  } catch {
    return Response.json(
      { error: "El plugin no está configurado." },
      { status: 503 }
    )
  }
}
