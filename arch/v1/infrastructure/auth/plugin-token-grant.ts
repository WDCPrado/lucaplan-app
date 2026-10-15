import { createHash } from "node:crypto"
import { prisma } from "../database/prisma/client.ts"
import { getPluginGrant, setPluginGrant } from "./plugin-request.ts"

type Grant = ReturnType<typeof getPluginGrant>

// El corte persiste por usuario/cliente aunque se autorice una conexión nueva. La época
// original se conserva durante todas las rotaciones; ninguna credencial anterior revive.
export async function assertPluginGrantActive(
  grant: Grant,
  scopes: readonly string[]
): Promise<void> {
  if (
    !Number.isSafeInteger(grant.epoch) ||
    grant.epoch <= 0 ||
    grant.epoch > Date.now()
  )
    throw new Error("Grant inválido.")
  const [user, client, consent, revocation] = await Promise.all([
    prisma.user.findUnique({
      where: { id: grant.userId },
      select: { banned: true },
    }),
    prisma.oAuthClient.findUnique({
      where: { clientId: grant.clientId },
      select: { disabled: true },
    }),
    prisma.oAuthConsent.findFirst({
      where: { userId: grant.userId, clientId: grant.clientId },
      select: { scopes: true },
    }),
    prisma.pluginGrantRevocation.findUnique({
      where: {
        userId_clientId: { userId: grant.userId, clientId: grant.clientId },
      },
    }),
  ])
  if (
    !user ||
    user.banned ||
    !client ||
    client.disabled ||
    !consent ||
    !scopes.every((scope) => consent.scopes.includes(scope)) ||
    (revocation && grant.epoch <= revocation.revokedAt.getTime())
  )
    throw new Error("Grant revocado.")
}

export async function preparePluginTokenGrant(
  headers: Headers,
  body: Record<string, unknown>
): Promise<void> {
  let clientId = body.client_id
  const basic = headers.get("authorization")
  if (basic?.startsWith("Basic ")) {
    const decoded = Buffer.from(basic.slice(6), "base64").toString("utf8")
    clientId = decoded.slice(0, decoded.indexOf(":"))
  }
  if (typeof clientId !== "string" || !clientId)
    throw new Error("Cliente inválido.")
  const hash = (value: string) =>
    createHash("sha256").update(value).digest("base64url")
  let grant: Grant
  let scopes: string[]
  if (body.grant_type === "refresh_token") {
    const token = body.refresh_token
    if (typeof token !== "string" || token.length > 16000)
      throw new Error("Token inválido.")
    const match = token.match(/^(\d{13,16})_[A-Za-z0-9_-]{43}$/)
    if (!match) throw new Error("Token inválido.")
    const row = await prisma.oAuthRefreshToken.findUnique({
      where: { token: hash(token) },
    })
    if (
      !row ||
      row.clientId !== clientId ||
      row.revoked ||
      row.expiresAt <= new Date()
    )
      throw new Error("Token inválido.")
    grant = { userId: row.userId, clientId, epoch: Number(match[1]) }
    scopes = row.scopes
  } else if (body.grant_type === "authorization_code") {
    if (typeof body.code !== "string" || body.code.length > 16000)
      throw new Error("Código inválido.")
    const row = await prisma.verification.findFirst({
      where: { identifier: hash(body.code) },
    })
    if (!row || row.expiresAt <= new Date()) throw new Error("Código inválido.")
    const value = JSON.parse(row.value)
    if (
      value?.type !== "authorization_code" ||
      typeof value.userId !== "string" ||
      value.query?.client_id !== clientId ||
      typeof value.query?.scope !== "string"
    )
      throw new Error("Código inválido.")
    grant = {
      userId: value.userId,
      clientId,
      epoch: value.plugin_grant_epoch_ms,
    }
    scopes = value.query.scope.split(" ")
  } else {
    throw new Error("Grant inválido.")
  }
  // El provider conserva la validación de secreto, PKCE, sesión, scopes y consumo atómico.
  // Este control agrega la vigencia del grant antes de cualquier emisión/rotación.
  await assertPluginGrantActive(grant, scopes)
  setPluginGrant(grant)
}
