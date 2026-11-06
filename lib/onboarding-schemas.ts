import { z } from "zod"
import { CATEGORY_TYPES } from "../arch/v1/domain/finance/finance.domain.ts"

// Contrato del onboarding (WDC-181). Lo usan la API (app/api/onboarding/**) y la pantalla
// (components/finance/onboarding/**). Se congela al lanzar: si falta algo se agrega, no se reescribe.
//
// Casos de uso
// 1. Proponer categorías   POST /api/onboarding/categories/propose   sesión
//    entrada: proposeCategoriesInput  salida: proposeCategoriesOutput  no escribe
//    errores: 422 entrada inválida · 401 sin sesión · 429 más de 5 propuestas por hora (en memoria, en la ruta)
//    sin OPENAI_API_KEY o si OpenAI falla: 200 con source "default" y el set precreado.
// 2. Guardar categorías    PUT  /api/onboarding/categories           sesión
//    entrada: applyCategoriesInput    salida: { categories: OnboardingCategory[] }
//    upsert por nombre; las categorías del usuario que no vienen en el set se eliminan solo si
//    no tienen movimientos, presupuestos ni recurrentes (si tienen, se conservan).
//    errores: 422 entrada inválida (nombres repetidos, icono o color fuera de catálogo) · 401
// 3. Estado del onboarding GET  /api/onboarding                      sesión
//    salida: onboardingStatus
// 4. Terminar u omitir     POST /api/onboarding/complete             sesión
//    salida: onboardingStatus  idempotente; marca user.onboardingCompletedAt
// Registro: un correo nuevo entra con el mismo código por correo (emailOTP sign-in) si
// SIGNUP_OPEN=true, o siempre en NODE_ENV=development. Sin RESEND_API_KEY en desarrollo, el
// código se imprime en la consola del servidor. La cuenta nueva parte con el set precreado.

export const DESCRIPTION_MAX = 1500

export const proposeCategoriesInput = z.object({
  // Lo que la persona cuenta de su día a día: dónde compra, cómo se mueve, qué paga cada mes.
  description: z
    .string({ error: "Cuéntanos un poco de tu día a día" })
    .trim()
    .min(10, "Cuéntanos un poco más (al menos 10 caracteres)")
    .max(DESCRIPTION_MAX, `Máximo ${DESCRIPTION_MAX} caracteres`),
})

export const onboardingCategory = z.object({
  name: z.string().trim().min(1, "La categoría necesita un nombre").max(40),
  type: z.enum(CATEGORY_TYPES),
  // Literales del catálogo de components/finance/category-icons.tsx (CATEGORY_ICONS, CATEGORY_COLORS).
  icon: z.string().min(1),
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
  // Contexto que la IA usa al categorizar: comercios chilenos reconocibles en la glosa.
  description: z.string().trim().max(400).nullable(),
})
export type OnboardingCategory = z.infer<typeof onboardingCategory>

export const proposeCategoriesOutput = z.object({
  source: z.enum(["ai", "default"]),
  categories: z.array(
    onboardingCategory.extend({
      // Qué hizo la IA con cada una, para que la pantalla lo muestre.
      change: z.enum(["kept", "edited", "added"]),
      // Una frase de por qué (ej. «Mencionaste que vas al gimnasio»); null si no cambió.
      reason: z.string().max(160).nullable(),
    })
  ),
})
export type ProposeCategoriesOutput = z.infer<typeof proposeCategoriesOutput>

export const applyCategoriesInput = z.object({
  categories: z
    .array(onboardingCategory)
    .min(1, "Deja al menos una categoría")
    .max(30, "Máximo 30 categorías")
    .refine(
      (list) =>
        new Set(list.map((c) => c.name.trim().toLowerCase())).size ===
        list.length,
      "Hay categorías con el mismo nombre"
    ),
})

export const onboardingStatus = z.object({
  completed: z.boolean(),
  aiAvailable: z.boolean(), // hay OPENAI_API_KEY
  outlookAvailable: z.boolean(), // hay OUTLOOK_CLIENT_ID y OUTLOOK_CLIENT_SECRET
})
export type OnboardingStatus = z.infer<typeof onboardingStatus>

// Ventana del primer escaneo del correo al conectar un banco.
export const SCAN_LOOKBACK_MONTHS = 3
