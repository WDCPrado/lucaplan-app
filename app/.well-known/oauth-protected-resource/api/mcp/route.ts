import { getPluginConfig } from "@/arch/v1/infrastructure/auth/plugin-config"

export function GET() {
  try {
    const config = getPluginConfig()
    return Response.json(
      {
        resource: config.resource,
        authorization_servers: [config.issuer],
        scopes_supported: ["finance:read", "finance:write"],
        bearer_methods_supported: ["header"],
        resource_name: "Luca Plan",
      },
      { headers: { "Cache-Control": "no-store" } }
    )
  } catch {
    return Response.json(
      { error: "El plugin no está configurado." },
      { status: 503 }
    )
  }
}
