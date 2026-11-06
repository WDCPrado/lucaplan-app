import { z } from "zod"

// Contrato de las claves de terceros en Ajustes → Integraciones (WDC-181). Lo usan la API
// (app/api/integrations/route.ts) y la pantalla. Se congela al lanzar: si falta algo se agrega.
//
// Son de la INSTALACIÓN, no de cada persona: la app de Outlook (Entra) y la cuenta de OpenAI o
// Resend sirven a todos los usuarios del servidor. Solo ADMIN las lee o cambia (permiso nuevo
// `integrations: ["read", "update"]`). La primera cuenta creada en una instalación sin ADMIN queda
// como ADMIN.
//
// Resolución, en orden: variable de entorno no vacía → valor guardado en Ajustes → nada. Si la
// variable de entorno existe, manda y la clave no se puede editar desde Ajustes (source "env").
//
// Protección:
// - Los secretos se guardan cifrados (AES-256-GCM, arch/v1/infrastructure/crypto/secret-crypto.ts,
//   con su propio `purpose`) en app_setting; nunca en texto plano ni en logs.
// - Solo se escriben: GET nunca devuelve un secreto, solo si está configurado y sus últimos 4
//   caracteres. Los valores que no son secretos (modelo, tenant, remitente, client id) sí se ven.
// - Cambiar o borrar una clave queda en un log de servidor con quién y cuál, sin el valor.
//
// 1. Ver     GET /api/integrations   ADMIN   salida: integrationsStatus   401 · 403
// 2. Cambiar PUT /api/integrations   ADMIN   entrada: updateIntegrationsInput (solo las claves que
//    cambian; null borra) salida: integrationsStatus   401 · 403 · 409 si la clave viene del
//    entorno · 422 entrada inválida
// El cambio rige en el siguiente uso, sin reiniciar el servidor.

export const INTEGRATION_KEYS = {
  OPENAI_API_KEY: { group: "openai", secret: true },
  OPENAI_MODEL: { group: "openai", secret: false },
  OUTLOOK_CLIENT_ID: { group: "outlook", secret: false },
  OUTLOOK_CLIENT_SECRET: { group: "outlook", secret: true },
  OUTLOOK_TENANT: { group: "outlook", secret: false },
  RESEND_API_KEY: { group: "resend", secret: true },
  RESEND_FROM: { group: "resend", secret: false },
} as const

export type IntegrationKey = keyof typeof INTEGRATION_KEYS
export const integrationKey = z.enum(
  Object.keys(INTEGRATION_KEYS) as [IntegrationKey, ...IntegrationKey[]]
)

export const integrationValue = z
  .string()
  .trim()
  .min(1, "No puede quedar vacío; usa Quitar para borrarla")
  .max(500, "Máximo 500 caracteres")
  .refine((v) => !/\s/.test(v), "No puede tener espacios")

export const updateIntegrationsInput = z.object({
  values: z.partialRecord(integrationKey, integrationValue.nullable()),
})
export type UpdateIntegrationsInput = z.infer<typeof updateIntegrationsInput>

export const integrationEntry = z.object({
  key: integrationKey,
  source: z.enum(["env", "app", "none"]),
  // Secreto: «••••abcd» (últimos 4) o null. No secreto: el valor completo o null.
  display: z.string().nullable(),
  updatedAt: z.string().nullable(), // ISO, solo si source "app"
})

export const integrationsStatus = z.object({
  entries: z.array(integrationEntry),
})
export type IntegrationsStatus = z.infer<typeof integrationsStatus>
