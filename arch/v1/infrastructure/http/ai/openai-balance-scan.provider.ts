// Lector de capturas de saldos con la API de OpenAI (Chat Completions con imagen). Implementa el
// port `BalanceScanReader`. Best-effort: ante cualquier fallo (no configurado, red, timeout, JSON
// inválido) devuelve null ⇒ la UI pide los montos a mano, sin lanzar.
//
// Optimizado para gastar lo mínimo:
//  - `detail: "low"` primero: costo fijo por imagen, sin importar el tamaño de la captura. Solo si
//    no reconoció NADA se reintenta en "high" (se paga caro únicamente cuando hizo falta).
//  - Se piden solo los campos que ese tipo de cuenta puede tener, con claves cortas.
//  - Structured Outputs (`json_schema` strict): la respuesta no puede venir mal formada, así que no
//    hay reintentos por parseo —el gasto que más duele.
//  - `max_completion_tokens` acotado: la respuesta son un puñado de números.
// La imagen viaja en el request y no se guarda en ninguna parte.
import type {
  BalanceReading,
  BalanceScanReader,
  BucketReading,
} from "../../../domain/finance/balance-scan.domain.ts"
import { EMPTY_BUCKET } from "../../../domain/finance/balance-scan.domain.ts"
import { openaiConfig, openaiConfigured } from "./openai-config.ts"
import { integrationDeps } from "../../database/prisma/integration-deps.ts"

const TIMEOUT_MS = 45_000
const MAX_TOKENS = 200

// Formato chileno: el punto separa miles y la coma decimales. Sin esto el modelo devuelve 1.334
// donde dice "$1.334.697", que es el error que más caro sale.
const SYSTEM =
  "Lees capturas de pantalla de apps bancarias chilenas y devuelves los montos que VES. " +
  "Formato chileno: el punto separa miles y la coma decimales, así que $1.334.697 es 1334697 y " +
  "USD 2.069,00 es 2069.00. Devuelve números sin símbolos ni separadores. " +
  "Un monto en rojo, entre paréntesis o con signo menos es NEGATIVO. " +
  "Usa null en todo campo que no aparezca EXPLÍCITAMENTE en las imágenes: nunca lo calcules, lo " +
  "estimes ni lo deduzcas de otro. Si una captura muestra varias tarjetas o cuentas, usa solo la que " +
  "está en primer plano.\n" +
  "Pueden venir VARIAS capturas: son pantallas distintas del MISMO instrumento (el banco reparte los " +
  "datos, por ejemplo el cupo internacional en otra vista). Combínalas en una sola respuesta y toma " +
  "cada dato de la captura donde aparezca."

// Un campo del schema: número o null (strict exige el tipo explícito).
const num = (description: string) => ({
  type: ["number", "null"],
  description,
})

// Solo los campos que ese tipo de cuenta puede mostrar: menos campos = menos tokens y menos ruido.
const FIELDS = {
  checking: {
    saldo: num(
      "Saldo o Disponible de la cuenta corriente. Negativo si está en rojo o con signo menos"
    ),
    lineaDisp: num("Línea de crédito disponible"),
    lineaCupo: num("Cupo total de la línea de crédito"),
  },
  credit_card: {
    clpDisp: num("Cupo nacional disponible, en pesos"),
    clpCupo: num("Cupo nacional total, en pesos"),
    clpUsado: num("Cupo nacional utilizado, en pesos"),
    usdDisp: num("Cupo internacional disponible, en dólares"),
    usdCupo: num("Cupo internacional total, en dólares"),
    usdUsado: num("Cupo internacional utilizado, en dólares"),
  },
} as const

function schemaFor(accountType: "checking" | "credit_card") {
  const properties = {
    l4: {
      type: ["string", "null"],
      description: "Últimos 4 dígitos de la tarjeta o cuenta que muestra la captura",
    },
    ...FIELDS[accountType],
  }
  return {
    name: "saldos",
    strict: true,
    schema: {
      type: "object",
      properties,
      required: Object.keys(properties),
      additionalProperties: false,
    },
  }
}

// number finito → valor; cualquier otra cosa (null, string, NaN) → null.
function n(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function bucket(
  limit: unknown,
  available: unknown,
  used: unknown
): BucketReading {
  return { limit: n(limit), available: n(available), used: n(used) }
}

function toReading(
  raw: Record<string, unknown>,
  accountType: "checking" | "credit_card"
): BalanceReading {
  const last4 = String(raw.l4 ?? "").replace(/\D/g, "")
  return {
    last4: /^\d{4}$/.test(last4) ? last4 : null,
    cash: accountType === "checking" ? n(raw.saldo) : null,
    overdraft:
      accountType === "checking"
        ? bucket(raw.lineaCupo, raw.lineaDisp, null)
        : EMPTY_BUCKET,
    national:
      accountType === "credit_card"
        ? bucket(raw.clpCupo, raw.clpDisp, raw.clpUsado)
        : EMPTY_BUCKET,
    international:
      accountType === "credit_card"
        ? bucket(raw.usdCupo, raw.usdDisp, raw.usdUsado)
        : EMPTY_BUCKET,
  }
}

// ¿Sirvió de algo la lectura? Sin un solo monto no hay nada que calcular.
function hasAmounts(r: BalanceReading): boolean {
  return [r.overdraft, r.national, r.international].some(
    (b) => b.limit !== null || b.available !== null || b.used !== null
  ) || r.cash !== null
}

async function ask(
  imageDataUrls: string[],
  accountType: "checking" | "credit_card",
  detail: "low" | "high"
): Promise<BalanceReading | null> {
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
        max_completion_tokens: MAX_TOKENS,
        response_format: { type: "json_schema", json_schema: schemaFor(accountType) },
        messages: [
          { role: "system", content: SYSTEM },
          {
            // Todas las capturas en UN solo mensaje: una llamada, un system prompt y una respuesta
            // ya combinada. Leerlas por separado multiplicaría el prompt y obligaría a fusionar acá.
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
    if (!res.ok) return null
    const data = await res.json()
    const content = data?.choices?.[0]?.message?.content
    if (typeof content !== "string") return null
    return toReading(JSON.parse(content), accountType)
  } catch {
    return null // red, timeout/abort o JSON inválido
  } finally {
    clearTimeout(timer)
  }
}

export const openaiBalanceScanReader: BalanceScanReader = {
  async read({ imageDataUrls, accountType }) {
    if (imageDataUrls.length === 0 || !(await openaiConfigured(integrationDeps))) return null
    const cheap = await ask(imageDataUrls, accountType, "low")
    if (cheap && hasAmounts(cheap)) return cheap
    // Las capturas no se leyeron en baja: recién ahí vale la pena pagar el detalle alto.
    return ask(imageDataUrls, accountType, "high")
  },
}
