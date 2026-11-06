// Adapter de categorización con IA usando la API de OpenAI (Chat Completions). Implementa el port
// `CategorizationProvider`. Best-effort: ante cualquier fallo (no configurado, red, timeout, JSON
// inválido) devuelve un mapa vacío ⇒ los movimientos quedan sin categoría, sin lanzar.
//
// Clave de rendimiento: al modelo se le dan **claves cortas** (c0..cN para categorías, m0..mN para
// movimientos) y se le pide echar solo esas claves. Así la respuesta es diminuta (no repite UUIDs de
// 36 chars por ítem), lo que baja latencia y costo drásticamente. Luego se mapea de vuelta a los ids
// reales y se valida contra el conjunto permitido (el caso de uso ya filtró por lado).
import type {
  CategorizationCategory,
  CategorizationCorrectionHint,
  CategorizationMovement,
  CategorizationProvider,
} from "../../../domain/finance/categorization.port.ts"
import { openaiConfig, openaiConfigured } from "./openai-config.ts"
import { integrationDeps } from "../../database/prisma/integration-deps.ts"
import {
  buildMerchantIndex,
  findMerchant,
  type MerchantCompany,
} from "./merchant-hints.ts"
import catalog from "./merchants-catalog.json" with { type: "json" }

const TIMEOUT_MS = 45_000

// Catálogo de comercios chilenos → índice de matching, construido una vez (module-level).
const MERCHANT_INDEX = buildMerchantIndex(
  (catalog as unknown as { companies: MerchantCompany[] }).companies
)

const SYSTEM =
  "Eres un clasificador de movimientos bancarios chilenos. Recibes categorías (con clave, nombre y " +
  "descripción) y movimientos (con clave y descripción). Lee con atención las descripciones de las " +
  "categorías: incluyen ejemplos concretos de comercios y reglas (a veces dicen qué NO incluir). Asigna " +
  "a CADA movimiento la categoría MÁS PROBABLE.\n" +
  "REGLA CLAVE: para cualquier COMPRA o GASTO en un comercio, SIEMPRE elige la categoría más cercana, " +
  "aunque NO reconozcas el comercio — usa tu conocimiento de comercios chilenos para adivinar. Pistas: " +
  "PAYU*UBER / CABIFY / RED MOVILIDAD / MP*BIP / metro = transporte; UBER EATS / RAPPI / DUNKIN / " +
  "restaurantes / sushi / coffee = comida; JUMBO / LIDER / UNIMARC / SB / market / DBS = supermercado; " +
  "SALCOBRAND / farmacia / CLINICA / DR. / gimnasio / SMART FIT = salud; OPENAI / CHATGPT / PARAMOUNT / " +
  "spotify / netflix / suscripción = subscripciones o servicios digitales; ENEL / AGUAS ANDINAS / ENTEL / " +
  "GTD = servicios/cuentas; MERPAGO / MERCADOPAGO / MERCADOLIBRE / tiendas = compras. " +
  "Devuelve null SOLO para transferencias o pagos entre personas sin contexto de compra (ej.: " +
  '"Traspaso a Juan", "Pago:Rosa"). NUNCA dejes null una compra por no reconocer el comercio.\n' +
  'Algunos movimientos incluyen "pista": el comercio más probable identificado por un catálogo de ' +
  "comercios chilenos (nombre · rubro). Trátala como indicio FUERTE del comercio real —aunque la " +
  "descripción traiga códigos de pasarela (MERPAGO, PAYU, TBK...)— y elige la categoría acorde; " +
  "ignórala solo si contradice claramente la descripción.\n" +
  "Puede venir una sección CORRECCIONES DEL USUARIO: movimientos que el usuario YA clasificó a mano " +
  "(texto → su categoría, a veces con una nota que explica qué es). Son la máxima autoridad: si la " +
  "descripción de un movimiento coincide (ignorando números y fechas) con el texto de una corrección, " +
  "usa ESA categoría, OBLIGATORIO, por encima de cualquier pista o criterio propio. Si solo se " +
  "parece (mismo comercio con otro formato), trátala como pista muy fuerte.\n" +
  "Usa SOLO las claves de categoría provistas (c0, c1, ...). Responde ÚNICAMENTE un JSON: " +
  '{"asignaciones":[{"m":"m0","c":"c1"}]} donde "c" es la clave de la categoría o null.'

function buildUserPrompt(
  movements: CategorizationMovement[],
  categories: CategorizationCategory[],
  corrections: CategorizationCorrectionHint[]
): string {
  const keyById = new Map(categories.map((c, i) => [c.id, `c${i}`]))
  const cats = categories.map((c, i) => ({
    clave: `c${i}`,
    nombre: c.name,
    descripcion: c.description ?? "",
  }))
  const movs = movements.map((m, i) => {
    const hint = findMerchant(MERCHANT_INDEX, m.description)
    const base = { clave: `m${i}`, descripcion: m.description }
    return hint ? { ...base, pista: `${hint.name} · ${hint.category}` } : base
  })
  // Correcciones con clave corta de categoría; se descartan las de categorías fuera del conjunto.
  const fixes = corrections.flatMap((c) => {
    const clave = keyById.get(c.categoryId)
    if (!clave) return []
    return [
      { texto: c.text, categoria: clave, ...(c.note ? { nota: c.note } : {}) },
    ]
  })
  const fixesBlock =
    fixes.length > 0
      ? `\n\nCORRECCIONES DEL USUARIO:\n${JSON.stringify(fixes)}`
      : ""
  return `CATEGORÍAS:\n${JSON.stringify(cats)}${fixesBlock}\n\nMOVIMIENTOS:\n${JSON.stringify(movs)}`
}

// Parsea el content (JSON) → mapa { claveMovimiento → claveCategoría | null }. Tolera "null"/""
// como null y formas inesperadas → {}.
function parseAssignments(content: unknown): Record<string, string | null> {
  if (typeof content !== "string") return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    return {}
  }
  const list =
    (parsed as { asignaciones?: unknown })?.asignaciones ??
    (parsed as { assignments?: unknown })?.assignments
  if (!Array.isArray(list)) return {}
  const out: Record<string, string | null> = {}
  for (const item of list) {
    const m = (item as { m?: unknown })?.m
    const c = (item as { c?: unknown })?.c
    if (typeof m !== "string") continue
    out[m] = typeof c === "string" && c !== "null" && c !== "" ? c : null
  }
  return out
}

export const openaiCategorizationProvider: CategorizationProvider = {
  async categorize({ movements, categories, corrections = [] }) {
    if (
      movements.length === 0 ||
      categories.length === 0 ||
      !(await openaiConfigured(integrationDeps))
    )
      return {}
    const cfg = await openaiConfig(integrationDeps)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    try {
      const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${cfg.apiKey}`,
        },
        body: JSON.stringify({
          model: cfg.model,
          temperature: 0,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: SYSTEM },
            {
              role: "user",
              content: buildUserPrompt(movements, categories, corrections),
            },
          ],
        }),
        signal: controller.signal,
      })
      if (!res.ok) return {}
      const data = await res.json()
      const byKey = parseAssignments(data?.choices?.[0]?.message?.content)
      // Mapea claves cortas → ids reales; valida que la clave de categoría exista (índice válido).
      const out: Record<string, string | null> = {}
      for (let i = 0; i < movements.length; i++) {
        const chosen = byKey[`m${i}`]
        const idx =
          chosen && chosen.startsWith("c") ? Number(chosen.slice(1)) : NaN
        out[movements[i].id] =
          Number.isInteger(idx) && idx >= 0 && idx < categories.length
            ? categories[idx].id
            : null
      }
      return out
    } catch {
      return {} // red, timeout/abort, JSON inválido → sin categoría
    } finally {
      clearTimeout(timer)
    }
  },
}
