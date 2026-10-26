import { z } from "zod"

const id = z.string().trim().min(1).max(200)
const money = z.number().finite().nonnegative()
const settled = z.strictObject({
  date: z.iso.date(),
  description: z.string().trim().min(1).max(2000),
  amount: money.positive(),
  currency: z.enum(["CLP", "USD"]),
  categoryId: id
    .nullable()
    .describe(
      "Categoría final; conserva la actual salvo evidencia para cambiarla"
    ),
  evidence: z
    .string()
    .trim()
    .min(1)
    .max(2000)
    .describe("Documento y fila bancaria que justifican la corrección"),
})
export const bankReconciliationSchema = z.strictObject({
  accountId: id,
  snapshotAt: z.iso.datetime({ offset: true }),
  source: z.string().trim().min(1).max(2000),
  buckets: z
    .array(
      z.strictObject({
        kind: z.enum([
          "cash",
          "overdraft",
          "credit_national",
          "credit_international",
        ]),
        currency: z.enum(["CLP", "USD"]),
        limit: money,
        used: money,
        available: z.number().finite(),
      })
    )
    .min(1)
    .max(4),
  includedSameDayIds: z
    .array(id)
    .max(500)
    .describe(
      "IDs del día del corte que el documento ya incluye; no asumir por fecha de importación"
    ),
  corrections: z.array(settled.extend({ transactionId: id })).max(200),
  additions: z
    .array(
      settled.extend({
        direction: z.enum(["debit", "credit"]),
        isInternal: z.boolean(),
      })
    )
    .max(200)
    .describe(
      "Solo movimientos sin contraparte tras revisar candidatos; no crear reemplazos para cambiar moneda"
    ),
})
export type BankReconciliationInput = z.infer<typeof bankReconciliationSchema>
