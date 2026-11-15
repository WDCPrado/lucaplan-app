// Lee una cartola con OpenAI (Responses API, Structured Outputs). Implementa el port
// `StatementReader`: devuelve el JSON crudo y el caso de uso lo valida con statementDocumentSchema.
// Ante cualquier fallo (sin key, red, timeout, status, sin contenido) lanza. El archivo viaja en el
// request y no se guarda en ninguna parte.
import type { StatementReader } from "../../../domain/finance/bank-reconciliation.domain.ts"
import { STATEMENT_ROW_KINDS } from "../../../domain/finance/bank-reconciliation.domain.ts"
import { openaiConfig } from "./openai-config.ts"
import { integrationDeps } from "../../database/prisma/integration-deps.ts"

const TIMEOUT_MS = 120_000

const MIME: Record<string, string> = {
  pdf: "application/pdf",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}

const SYSTEM =
  "Lees la cartola o el estado de cuenta de UNA cuenta de un banco chileno y devuelves exactamente " +
  "lo que dice, sin inventar ni completar. snapshotAt: fecha y hora en que el banco emitió o se " +
  "descargó el documento (p. ej. «emitido el», «fecha de consulta», «saldo al»), ISO 8601 con zona de " +
  "Chile (p. ej. 2026-11-10T14:32:00-03:00); si no trae hora, usa 23:59 del día del corte. source: banco, cuenta (últimos dígitos) y período. buckets: en cuenta corriente, cash " +
  "(limit 0, used 0, available = saldo disponible de la cuenta) y overdraft si hay línea de crédito " +
  "(limit = cupo, used = utilizado, available = disponible); en tarjeta, credit_national (CLP) y " +
  "credit_international (USD) si existe, con available = limit − used. Incluye solo los buckets que " +
  "la cuenta tiene (se indican abajo). rows: cada movimiento con " +
  "fecha YYYY-MM-DD, la glosa tal cual, amount positivo (CLP en pesos enteros, USD con 2 decimales), " +
  "currency de la fila, direction debit (cargo) o credit (abono) y kind: purchase (compra), fee " +
  "(comisión, impuesto, interés), income (sueldo u otro ingreso), reimbursement (devolución de un " +
  "tercero), reversal (reverso o anulación de un cargo), overdraft_draw (traspaso desde la línea a la " +
  "cuenta), overdraft_payment (pago de la línea), own_transfer (traspaso entre cuentas propias), " +
  "card_payment (pago de tarjeta) o installment (cuota de una compra en cuotas, con installment n de " +
  "of). originalAmount: monto y moneda de origen de una compra internacional; null si no aplica. " +
  "installment null si no es cuota. No incluyas totales, saldos ni encabezados como filas."

const money = { type: "number" }
const currency = { type: "string", enum: ["CLP", "USD"] }
const nullable = (schema: object) => ({ anyOf: [schema, { type: "null" }] })
const object = (properties: Record<string, object>) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
})

// Equivalente a statementDocumentSchema; strict exige todos los campos y los opcionales como null.
const SCHEMA = object({
  snapshotAt: { type: "string" },
  source: { type: "string" },
  buckets: {
    type: "array",
    items: object({
      kind: {
        type: "string",
        enum: ["cash", "overdraft", "credit_national", "credit_international"],
      },
      currency,
      limit: money,
      used: money,
      available: money,
    }),
  },
  rows: {
    type: "array",
    items: object({
      date: { type: "string" },
      description: { type: "string" },
      amount: money,
      currency,
      direction: { type: "string", enum: ["debit", "credit"] },
      kind: { type: "string", enum: [...STATEMENT_ROW_KINDS] },
      installment: nullable(object({ n: { type: "integer" }, of: { type: "integer" } })),
      originalAmount: nullable(object({ amount: money, currency })),
    }),
  },
})

export const openaiStatementReader: StatementReader = {
  async read(file, context) {
    const cfg = await openaiConfig(integrationDeps)
    const extension = file.name.split(".").pop()?.toLowerCase() ?? ""
    // El CSV es texto: va como texto. PDF y planillas, como archivo en base64.
    const document =
      extension === "csv"
        ? { type: "input_text", text: new TextDecoder().decode(file.data) }
        : {
            type: "input_file",
            filename: file.name,
            file_data: `data:${MIME[extension] ?? file.type};base64,${Buffer.from(file.data).toString("base64")}`,
          }
    const res = await fetch(`${cfg.baseUrl}/responses`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        store: false,
        input: [
          { role: "system", content: SYSTEM },
          {
            role: "user",
            content: [
              document,
              {
                type: "input_text",
                text:
                  `Tipo de cuenta: ${context.accountType === "checking" ? "cuenta corriente" : "tarjeta de crédito"}. ` +
                  `Buckets de la cuenta: ${context.buckets.map((b) => `${b.kind} ${b.currency}`).join(", ") || "ninguno"}.`,
              },
            ],
          },
        ],
        text: {
          format: { type: "json_schema", name: "cartola", strict: true, schema: SCHEMA },
        },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) throw new Error(`OpenAI ${res.status}`)
    const data = await res.json()
    const text = (data?.output ?? [])
      .flatMap((o: { content?: { type: string; text?: string }[] }) => o.content ?? [])
      .find((c: { type: string }) => c.type === "output_text")?.text
    if (typeof text !== "string") throw new Error("OpenAI sin contenido")
    return JSON.parse(text)
  },
}
