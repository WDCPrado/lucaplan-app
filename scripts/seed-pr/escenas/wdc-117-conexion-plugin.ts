import type { EscenaContext } from "../sembrar-usuario.ts"

export const correo = "wdc-117@lucaplan.cl"
export const titulo = "WDC-117 — conexiones del plugin"

// Una conexión de demostración sin tokens: permite revisar permisos y revocación.
export async function seed({ prisma, userId }: EscenaContext) {
  const clientId = `demo-plugin-${userId}`
  const scopes = [
    "openid",
    "email",
    "offline_access",
    "finance:read",
    "finance:write",
  ]
  const configured =
    process.env.BETTER_AUTH_URL ||
    (process.env.RAILWAY_PUBLIC_DOMAIN
      ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
      : "http://localhost:3005")
  const origin = new URL(configured).origin
  await prisma.oAuthClient.upsert({
    where: { clientId },
    create: {
      id: clientId,
      clientId,
      userId,
      name: "Asistente de demostración",
      scopes,
      redirectUris: [`${origin}/plugin`],
      contacts: [],
      postLogoutRedirectUris: [],
      tokenEndpointAuthMethod: "none",
      grantTypes: ["authorization_code", "refresh_token"],
      responseTypes: ["code"],
      public: true,
      requirePKCE: true,
      skipConsent: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    update: {},
  })
  const id = `demo-consent-${userId}`
  await prisma.oAuthConsent.upsert({
    where: { id },
    create: {
      id,
      userId,
      clientId,
      scopes,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    update: {},
  })
}
