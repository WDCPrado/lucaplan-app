import { z } from "zod"

export const pluginOAuthScopeSchema = z.enum([
  "openid",
  "email",
  "offline_access",
  "finance:read",
  "finance:write",
])

// oauth_query conserva la firma generada por Better Auth; el servidor la valida.
export const pluginConsentSchema = z.strictObject({
  accept: z.boolean(),
  scope: z.string().max(200).optional(),
  oauth_query: z.string().min(1).max(12000),
})

export const pluginConnectionSchema = z.strictObject({
  id: z.string().min(1),
  clientId: z.string().min(1),
  clientName: z.string().nullable(),
  scopes: z.array(pluginOAuthScopeSchema),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
})

export const pluginConnectionsSchema = z.strictObject({
  connections: z.array(pluginConnectionSchema),
})

export type PluginConsentInput = z.infer<typeof pluginConsentSchema>
export type PluginConnectionResponse = z.infer<typeof pluginConnectionSchema>
