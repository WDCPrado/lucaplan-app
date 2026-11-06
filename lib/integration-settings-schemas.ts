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

// Solo RESEND_FROM admite espacios («Luca Plan <codigos@tu-dominio.cl>»); las claves, ids, modelo y
// tenant no los llevan nunca.
export const KEYS_WITH_SPACES: readonly IntegrationKey[] = ["RESEND_FROM"]
export const valueFor = (key: IntegrationKey) =>
  KEYS_WITH_SPACES.includes(key)
    ? integrationValue
    : integrationValue.refine((v) => !/\s/.test(v), "No puede tener espacios")

export const updateIntegrationsInput = z
  .object({
    values: z.partialRecord(integrationKey, integrationValue.nullable()),
  })
  .superRefine(({ values }, ctx) => {
    for (const [key, value] of Object.entries(values)) {
      if (value == null) continue
      const result = valueFor(key as IntegrationKey).safeParse(value)
      if (!result.success)
        ctx.addIssue({
          code: "custom",
          path: ["values", key],
          message: result.error.issues[0]?.message ?? "Valor inválido",
        })
    }
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

// --- Instalación inicial (/setup) --------------------------------------------------------------
// Corre SOLO mientras la base no tiene ninguna cuenta. Lo primero que ve quien levanta una
// instalación nueva: antes del login, porque sin cuenta no hay ADMIN que entre a Ajustes.
//
// Protección: al arrancar sin cuentas, el servidor genera un código de instalación aleatorio y lo
// imprime en su consola («[setup] Código de instalación: XXXX-XXXX»). Solo quien opera el servidor
// lo ve. Verificarlo deja una cookie httpOnly firmada que habilita los pasos del asistente. En
// cuanto existe una cuenta, /setup y sus rutas responden 404 y el código deja de servir.
//
// 1. Estado    GET  /api/setup                  público  salida: setupStatus
// 2. Verificar POST /api/setup/verify           público  entrada: setupVerifyInput  204 · 401 código
//    inválido · 404 ya instalado · 429 más de 5 intentos por hora por IP
// 3. Claves    PUT  /api/setup/integrations     cookie de setup  entrada: updateIntegrationsInput
//    salida: integrationsStatus  mismas reglas que PUT /api/integrations (409 si viene del entorno)
//    401 sin cookie · 404 ya instalado
// 4. La cuenta se crea con el login de siempre (código por correo): con la base vacía el registro
//    queda abierto aunque SIGNUP_OPEN no esté, y esa primera cuenta queda ADMIN. Después sigue el
//    onboarding.
//
// Mínimo para entrar: en producción RESEND_API_KEY y RESEND_FROM (sin ellos el código no llega);
// en local nada, porque el código sale en la consola. OpenAI y Outlook son opcionales.

export const setupStatus = z.object({
  needed: z.boolean(), // la base no tiene cuentas
  verified: z.boolean(), // esta sesión ya validó el código de instalación
  local: z.boolean(), // el código de acceso se imprime en consola (no hace falta Resend)
  missingRequired: z.array(integrationKey), // claves mínimas que faltan para poder entrar
})
export type SetupStatus = z.infer<typeof setupStatus>

export const setupVerifyInput = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{4}-?[A-Z0-9]{4}$/, "El código tiene 8 caracteres, como ABCD-1234"),
})
