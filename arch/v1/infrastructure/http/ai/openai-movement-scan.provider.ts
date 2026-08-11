// Lector de fotos de la cartola del banco con la API de OpenAI (Chat Completions con imagen).
// Implementa el port `MovementScanReader`. Best-effort: ante cualquier fallo (no configurado, red,
// timeout, JSON inválido) devuelve [] ⇒ la UI ofrece escribir los movimientos a mano, sin lanzar.
//
// Mismas decisiones de costo que el lector de saldos (`openai-balance-scan.provider.ts`):
//  - `detail: "low"` primero; solo si no reconoció NADA se reintenta en "high".
//  - Structured Outputs (`json_schema` strict): la respuesta no puede venir mal formada.
//  - Claves cortas y `max_completion_tokens` acotado — acá la respuesta sí es larga (una fila por
//    movimiento), así que el tope se dimensiona con `MAX_SCAN_MOVEMENTS`.
// Las fotos viajan en el request y no se guardan en ninguna parte.
import {
  MAX_SCAN_MOVEMENTS,
  type MovementReading,
  type MovementScanReader,
} from "../../../domain/finance/movement-scan.domain.ts"
import { openaiConfig, openaiConfigured } from "./openai-config.ts"

const TIMEOUT_MS = 60_000
// ~30 tokens por fila más el envoltorio; de sobra para el tope de movimientos.
const MAX_TOKENS = 40 * MAX_SCAN_MOVEMENTS

const SYSTEM =
  "Lees fotos y capturas de cartolas de bancos chilenos y devuelves los movimientos que VES, uno " +
  "por fila de la lista, en el mismo orden. " +
  "Formato chileno: el punto separa miles y la coma decimales, así que $13.590 es 13590 y " +
  "USD 128,40 es 128.40. Devuelve el monto sin símbolos ni separadores y SIEMPRE positivo; la " +
  "dirección va en `tipo`: 'cargo' para compras, giros y pagos (lo que resta), 'abono' para " +
  "depósitos, transferencias recibidas y devoluciones (lo que suma). Un monto en rojo, entre " +
  "paréntesis o con signo menos es un cargo. " +
  "Las fechas van en campos separados: `d` día, `m` mes, `y` año. Si la fila no muestra el año, " +
  "deja `y` en null: NO lo inventes. " +
  "En `desc` copia el texto del comercio o la glosa tal como aparece. " +
  "No incluyas saldos, subtotales, cupos ni encabezados: solo movimientos con fecha y monto. " +
  `Devuelve a lo más ${MAX_SCAN_MOVEMENTS} movimientos.`

const SCHEMA = {
  name: "movimientos",
  strict: true,
  schema: {
    type: "object",
    properties: {
      movs: {
        type: "array",
        description: "Movimientos leídos, en el orden en que aparecen",
        items: {
          type: "object",
          properties: {
            d: { type: ["integer", "null"], description: "Día del mes" },
            m: { type: ["integer", "null"], description: "Mes (1-12)" },
            y: {
              type: ["integer", "null"],
              description: "Año de 4 dígitos, o null si la fila no lo muestra",
            },
            desc: {
              type: ["string", "null"],
              description: "Comercio o glosa, tal como aparece",
            },
            monto: {
              type: ["number", "null"],
              description:
                "Monto positivo, sin símbolos ni separadores de miles",
            },
            tipo: {
              type: ["string", "null"],
              description: "'cargo' si resta, 'abono' si suma",
            },
          },
          required: ["d", "m", "y", "desc", "monto", "tipo"],
          additionalProperties: false,
        },
      },
    },
    required: ["movs"],
    additionalProperties: false,
  },
}

// number finito → valor; cualquier otra cosa (null, string, NaN) → null.
const n = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null

function toReading(raw: Record<string, unknown>): MovementReading {
  const tipo = String(raw.tipo ?? "").toLowerCase()
  return {
    day: n(raw.d),
    month: n(raw.m),
    year: n(raw.y),
    description: typeof raw.desc === "string" ? raw.desc : null,
    amount: n(raw.monto),
    kind: tipo === "abono" || tipo === "cargo" ? tipo : null,
  }
}

async function ask(
  imageDataUrls: string[],
  detail: "low" | "high"
): Promise<MovementReading[]> {
  const cfg = openaiConfig()
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
        max_completion_tokens: MAX_TOKENS,
        response_format: { type: "json_schema", json_schema: SCHEMA },
        messages: [
          { role: "system", content: SYSTEM },
          {
            // Todas las fotos en UN solo mensaje: suelen ser pantallas seguidas de la misma cartola.
            role: "user",
            content: imageDataUrls.map((url) => ({
              type: "image_url",
              image_url: { url, detail },
            })),
          },
        ],
      }),
      signal: controller.signal,
    })
    if (!res.ok) return []
    const data = await res.json()
    const content = data?.choices?.[0]?.message?.content
    if (typeof content !== "string") return []
    const movs = JSON.parse(content)?.movs
    return Array.isArray(movs) ? movs.map(toReading) : []
  } catch {
    return [] // red, timeout/abort o JSON inválido
  } finally {
    clearTimeout(timer)
  }
}

export const openaiMovementScanReader: MovementScanReader = {
  async read({ imageDataUrls }) {
    if (!openaiConfigured() || imageDataUrls.length === 0) return []
    const cheap = await ask(imageDataUrls, "low")
    // El texto de una cartola es chico y en detalle bajo se pierde con facilidad: si no salió ni una
    // fila con monto, recién ahí vale la pena pagar el detalle alto.
    if (cheap.some((m) => m.amount !== null)) return cheap
    return ask(imageDataUrls, "high")
  },
}
