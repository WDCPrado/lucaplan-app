import { verifyJwsAccessToken } from "better-auth/oauth2"
import { auth } from "./auth.ts"
import { getPluginConfig } from "./plugin-config.ts"
import { prisma } from "../database/prisma/client.ts"
import {
  authorizePluginClaims,
  PluginAuthenticationError,
} from "../../application/plugin-use-cases/plugin-auth-use-cases.ts"
import type { PluginConnectionStore } from "../../domain/plugin/plugin-auth.domain.ts"
import type { PluginActor } from "../../domain/plugin/plugin.domain.ts"

export async function getPluginActor(headers: Headers): Promise<PluginActor> {
  const value = headers.get("authorization")
  const match = value?.match(/^Bearer ([A-Za-z0-9_.-]+)$/i)
  if (!match) throw new PluginAuthenticationError()
  try {
    const config = getPluginConfig()
    const claims = await verifyJwsAccessToken(match[1], {
      jwksFetch: () => auth.api.getJwks(),
      jwksCacheKey: auth,
      verifyOptions: { issuer: config.issuer, audience: config.resource },
    })
    if (typeof claims.sub !== "string" || typeof claims.azp !== "string")
      throw new PluginAuthenticationError()
    const [user, client, consent, revocation] = await Promise.all([
      prisma.user.findUnique({
        where: { id: claims.sub },
        select: { id: true, banned: true },
      }),
      prisma.oAuthClient.findUnique({
        where: { clientId: claims.azp },
        select: { clientId: true, disabled: true },
      }),
      prisma.oAuthConsent.findFirst({
        where: { userId: claims.sub, clientId: claims.azp },
        select: { scopes: true },
      }),
      prisma.pluginGrantRevocation.findUnique({
        where: {
          userId_clientId: { userId: claims.sub, clientId: claims.azp },
        },
      }),
    ])
    return authorizePluginClaims(
      claims,
      { user, client, consent, revokedAt: revocation?.revokedAt ?? null },
      { ...config, now: new Date() }
    )
  } catch {
    // Nunca reflejar token, claims ni errores criptográficos/SQL al cliente o al log.
    throw new PluginAuthenticationError()
  }
}

export const pluginConnectionStore: PluginConnectionStore = {
  async list(userId) {
    const rows = await prisma.oAuthConsent.findMany({
      where: { userId },
      include: { client: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    })
    return rows.map((row) => ({
      id: row.id,
      clientId: row.clientId,
      clientName: row.client.name,
      scopes: row.scopes,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }))
  },
  async revoke(userId, connectionId) {
    return prisma.$transaction(async (tx) => {
      const consent = await tx.oAuthConsent.findFirst({
        where: { id: connectionId, userId },
      })
      if (!consent) return false
      const pair = { userId, clientId: consent.clientId }
      await tx.pluginGrantRevocation.upsert({
        where: { userId_clientId: pair },
        create: { ...pair, revokedAt: new Date() },
        update: { revokedAt: new Date() },
      })
      await tx.oAuthAccessToken.deleteMany({ where: pair })
      await tx.oAuthRefreshToken.deleteMany({ where: pair })
      await tx.oAuthConsent.deleteMany({ where: pair })
      return true
    })
  },
}

// RFC 7009: el provider no persiste JWT y su revoke nativo es un no-op para ellos.
// Reutilizamos el mismo corte que la pantalla, después de autenticar al cliente y el token.
export async function revokePluginCredential(
  headers: Headers,
  body: Record<string, unknown>
): Promise<void> {
  const { createHash, timingSafeEqual } = await import("node:crypto")
  let clientId = body.client_id
  let secret = body.client_secret
  const basic = headers.get("authorization")
  if (basic?.startsWith("Basic ")) {
    const decoded = Buffer.from(basic.slice(6), "base64").toString("utf8")
    const separator = decoded.indexOf(":")
    if (separator < 1) throw new PluginAuthenticationError()
    clientId = decoded.slice(0, separator)
    secret = decoded.slice(separator + 1)
  }
  if (typeof clientId !== "string") throw new PluginAuthenticationError()
  const client = await prisma.oAuthClient.findUnique({ where: { clientId } })
  if (!client || client.disabled) throw new PluginAuthenticationError()
  if (client.tokenEndpointAuthMethod !== "none") {
    if (typeof secret !== "string" || !client.clientSecret)
      throw new PluginAuthenticationError()
    const hashed = createHash("sha256").update(secret).digest("base64url")
    const expected = Buffer.from(client.clientSecret)
    const supplied = Buffer.from(hashed)
    if (
      expected.length !== supplied.length ||
      !timingSafeEqual(expected, supplied)
    )
      throw new PluginAuthenticationError()
  }
  if (
    typeof body.token !== "string" ||
    !body.token ||
    body.token.length > 16000
  )
    return
  const token = body.token.replace(/^Bearer /, "")
  let userId: string | undefined
  if (token.split(".").length === 3) {
    try {
      const actor = await getPluginActor(
        new Headers({ authorization: `Bearer ${token}` })
      )
      if (actor.clientId !== clientId) return
      userId = actor.userId
    } catch {
      return
    }
  } else {
    // Configuración explícita storeTokens:"hashed", sin prefijo ni formato personalizado.
    const stored = await prisma.oAuthRefreshToken.findUnique({
      where: { token: createHash("sha256").update(token).digest("base64url") },
    })
    if (
      !stored ||
      stored.clientId !== clientId ||
      stored.revoked ||
      stored.expiresAt <= new Date()
    )
      return
    userId = stored.userId
  }
  const consent = await prisma.oAuthConsent.findFirst({
    where: { userId, clientId },
    select: { id: true },
  })
  if (consent) await pluginConnectionStore.revoke(userId, consent.id)
}
