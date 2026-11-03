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
  loanCorrections: z
    .array(
      z.strictObject({
        planId: id.describe(
          "Plan de tipo loan de esta cuenta; obtén sus IDs con ver_plan_cuotas"
        ),
        totalAmount: money
          .positive()
          .describe(
            "Total a devolver confirmado por el banco, en la moneda del plan; debe sumar todas las cuotas"
          ),
        evidence: settled.shape.evidence.describe(
          "Documento y líneas que justifican el total y el cronograma completo del préstamo o avance"
        ),
        items: z
          .array(
            z.strictObject({
              itemId: id,
              amount: money
                .positive()
                .describe(
                  "Monto bancario de esta cuota; corrige también su movimiento si ya existe, sin cambiar fechas ni vínculos"
                ),
            })
          )
          .min(1)
          .max(1000)
          .describe(
            "Todas las cuotas del plan, una vez cada una, incluidas las pagadas y fuera de la app. No crea movimientos para las pendientes."
          ),
      })
    )
    .max(20)
    .optional()
    .describe(
      "Corrección completa de préstamos/avances loan contra cartola. Conserva moneda, fechas, cuenta, categoría e IDs. No usar para planes card ni repetir sus movimientos en corrections."
    ),
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
  corrections: z
    .array(
      settled.extend({
        transactionId: id,
        settleRecurringCharge: z
          .boolean()
          .optional()
          .describe(
            "True solo para liquidar un cobro recurrente confirmado con evidencia bancaria. Conserva vínculo, categoría y condiciones futuras del plan; no aplica a ingresos ni cuotas."
          ),
      })
    )
    .max(200),
  additions: z
    .array(
      settled.extend({
        direction: z.enum(["debit", "credit"]),
        isInternal: z.boolean(),
        distinctFrom: z
          .array(
            z.strictObject({
              transactionId: id,
              evidence: z
                .string()
                .trim()
                .min(1)
                .max(2000)
                .describe(
                  "Fila bancaria independiente del candidato: explica por qué son dos operaciones distintas"
                ),
            })
          )
          .max(200)
          .optional()
          .describe(
            "Candidatos revisados que son otros cargos reales. Debe enumerar exactamente todos los candidatos detectados, sin IDs ajenos ni omisiones."
          ),
      })
    )
    .max(200)
    .describe(
      "Solo movimientos sin contraparte tras revisar candidatos; no crear reemplazos para cambiar moneda"
    ),
})
export type BankReconciliationInput = z.infer<typeof bankReconciliationSchema>
