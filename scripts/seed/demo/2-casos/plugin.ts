// Plugin de la cuenta demo: una conexión del asistente sin tokens, para revisar permisos y revocarla.
import type { DemoContext } from "../1-base/cuenta-demo.ts"

const SCOPES = ["openid", "email", "offline_access", "finance:read", "finance:write"]

export async function seed({ prisma, userId }: DemoContext) {
  const clientId = `demo-plugin-${userId}`
  const configured =
    process.env.BETTER_AUTH_URL ||
    (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : "http://localhost:3005")
  const now = new Date()
  await prisma.oAuthClient.upsert({
    where: { clientId },
    create: {
      id: clientId, clientId, userId, name: "Asistente de demostración", scopes: SCOPES,
      redirectUris: [`${new URL(configured).origin}/plugin`], contacts: [], postLogoutRedirectUris: [],
      tokenEndpointAuthMethod: "none", grantTypes: ["authorization_code", "refresh_token"], responseTypes: ["code"],
      public: true, requirePKCE: true, skipConsent: false, createdAt: now, updatedAt: now,
    },
    update: {},
  })
  const id = `demo-consent-${userId}`
  await prisma.oAuthConsent.upsert({
    where: { id },
    create: { id, userId, clientId, scopes: SCOPES, createdAt: now, updatedAt: now },
    update: {},
  })
}
