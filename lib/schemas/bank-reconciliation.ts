import { z } from "zod"
import {
  CREDIT_KINDS,
  INTERNAL_KINDS,
} from "../../arch/v1/domain/finance/finance.domain.ts"
import { STATEMENT_ROW_KINDS } from "../../arch/v1/domain/finance/bank-reconciliation.domain.ts"

const id = z.string().trim().min(1).max(200)
const money = z.number().finite().nonnegative()
const currency = z.enum(["CLP", "USD"])
const evidence = z.string().trim().min(1).max(2000)
const bucket = z.strictObject({
  kind: z.enum([
    "cash",
    "overdraft",
    "credit_national",
    "credit_international",
  ]),
  currency,
  limit: money,
  used: money,
  available: z.number().finite(),
})
const settled = z.strictObject({
  date: z.iso.date(),
  description: z.string().trim().min(1).max(2000),
  amount: money.positive(),
  currency,
  categoryId: id
    .nullable()
    .describe(
      "Categoría final; conserva la actual salvo evidencia para cambiarla"
    ),
  evidence: evidence.describe(
    "Documento y fila bancaria que justifican la corrección"
  ),
})
export const bankReconciliationSchema = z.strictObject({
  accountId: id,
  snapshotAt: z.iso.datetime({ offset: true }),
  source: z.string().trim().min(1).max(2000),
  cardCorrections: z
    .array(
      z.strictObject({
        planId: id.describe(
          "Plan card de esta tarjeta; obtén el plan y todos sus IDs con ver_plan_cuotas"
        ),
        totalAmount: money
          .positive()
          .describe(
            "Total financiado respaldado por el banco, incluidos intereses cuando correspondan; debe sumar todas las cuotas. No cambia el importe de la compra origen."
          ),
        evidence: settled.shape.evidence.describe(
          "Documento y líneas que respaldan el total financiado y los importes del cronograma de tarjeta"
        ),
        items: z
          .array(
            z.strictObject({
              itemId: id,
              amount: money.describe(
                "Importe de la cuota. Solo cambian las pendientes; conserva exactamente los importes de las registradas o fuera de la app, incluidos ceros históricos."
              ),
            })
          )
          .min(1)
          .max(1000)
          .describe(
            "Todas las cuotas del plan una vez cada una, incluidas las ya registradas. Conserva fechas, IDs y vínculos; no registra gastos ni pagos."
          ),
      })
    )
    .max(20)
    .optional()
    .describe(
      "Corrige el total financiado y los importes pendientes de planes card con evidencia bancaria. Preserva la compra origen, las cuotas registradas y los saldos por este ajuste. No usar para loan ni repetir la compra o sus cuotas registradas en corrections."
    ),
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
  buckets: z.array(bucket).min(1).max(4),
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
  retentions: z
    .array(
      z.strictObject({
        transactionId: id,
        evidence: evidence.describe(
          "Por qué la cartola no trae este cargo del correo (documento y rango revisado)"
        ),
      })
    )
    .max(200)
    .optional()
    .describe(
      "Cargos del correo (confirmados, hasta el día del corte) sin par en la cartola: quedan anulados (reversed), no se borran. Se rechaza si el cargo tiene un reembolso vinculado (no se desvincula solo)"
    ),
  additions: z
    .array(
      settled
        .extend({
          direction: z.enum(["debit", "credit"]),
          isInternal: z.boolean(),
          creditKind: z
            .enum(CREDIT_KINDS)
            .optional()
            .describe(
              "Obligatorio en un abono no interno: income (cuenta como ingreso del plan; categoría de ingreso), reimbursement o reversal (sin categoría o de gasto)"
            ),
          internalKind: z
            .enum(INTERNAL_KINDS)
            .optional()
            .describe(
              "Obligatorio si isInternal. Altas permitidas: overdraft_draw, overdraft_payment y own_transfer en cuenta corriente; card_payment va por su flujo e installment_source lo crea el plan de cuotas"
            ),
          reversalOfId: id
            .optional()
            .describe(
              "Opcional y solo con creditKind reversal: el cargo de la app que este abono anula, que queda anulado (reversed). Sin él, el reverso se da de alta solo. Se rechaza si el cargo tiene un reembolso vinculado"
            ),
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
        .superRefine((a, ctx) => {
          const kindedCredit = a.direction === "credit" && !a.isInternal
          if (kindedCredit !== (a.creditKind !== undefined))
            ctx.addIssue({
              code: "custom",
              path: ["creditKind"],
              message: kindedCredit
                ? "Un abono no interno necesita creditKind"
                : "creditKind solo va en un abono no interno",
            })
          if (a.isInternal !== (a.internalKind !== undefined))
            ctx.addIssue({
              code: "custom",
              path: ["internalKind"],
              message: a.isInternal
                ? "Un movimiento interno necesita internalKind"
                : "internalKind solo va en un movimiento interno",
            })
          if (a.reversalOfId !== undefined && a.creditKind !== "reversal")
            ctx.addIssue({
              code: "custom",
              path: ["reversalOfId"],
              message: "reversalOfId solo va con creditKind reversal",
            })
        })
    )
    .max(200)
    .describe(
      "Solo movimientos sin contraparte tras revisar candidatos; no crear reemplazos para cambiar moneda"
    ),
})
export type BankReconciliationInput = z.infer<typeof bankReconciliationSchema>

// Dirección que fija cada tipo de fila; los que no están aquí van en ambos sentidos según la cuenta
// (un pago de tarjeta es cargo en la corriente y abono en la tarjeta).
const ROW_DIRECTION: Partial<
  Record<(typeof STATEMENT_ROW_KINDS)[number], "debit" | "credit">
> = {
  purchase: "debit",
  fee: "debit",
  installment: "debit",
  overdraft_payment: "debit",
  income: "credit",
  reimbursement: "credit",
  reversal: "credit",
  overdraft_draw: "credit",
}

const statementRow = z.strictObject({
  date: z.iso.date(),
  description: z.string().trim().min(1).max(2000),
  amount: money.positive(),
  currency,
  direction: z.enum(["debit", "credit"]),
  kind: z.enum(STATEMENT_ROW_KINDS),
  // ponytail: nullish para aceptar el null del json_schema strict de OpenAI y la omisión del MCP.
  installment: z
    .strictObject({
      n: z.int().positive(),
      of: z.int().positive(),
    })
    .refine((i) => i.n <= i.of, "La cuota no puede pasar del total")
    .nullish(),
  originalAmount: z
    .strictObject({ amount: money.positive(), currency })
    .nullish(),
})

/** La cartola tal como la lee la extracción (OpenAI o el agente del usuario). El archivo no se guarda. */
export const statementDocumentSchema = z.strictObject({
  snapshotAt: bankReconciliationSchema.shape.snapshotAt.describe(
    "Fecha y hora del corte de la cartola, con zona"
  ),
  source: bankReconciliationSchema.shape.source.describe(
    "Documento leído: banco, cuenta y período"
  ),
  buckets: z.array(bucket).min(1).max(4),
  rows: z
    .array(
      statementRow.refine(
        (r) => (ROW_DIRECTION[r.kind] ?? r.direction) === r.direction,
        {
          path: ["direction"],
          message: "La dirección no corresponde al tipo de fila",
        }
      )
    )
    .max(2000),
})
export type StatementDocument = z.infer<typeof statementDocumentSchema>

/** Salida de proponerConciliacion: `reconcileInput` va tal cual a previsualizar. */
export const reconciliationProposalSchema = z.strictObject({
  reconcileInput: bankReconciliationSchema,
  // Filas del documento que siguen tras descartar las anteriores al corte, con su índice original
  // (al que apuntan matched y ambiguous): la UI no tiene el documento cuando la extracción es del servidor.
  rows: z.array(statementRow.extend({ rowIndex: z.int().nonnegative() })),
  matched: z.array(
    z.strictObject({ rowIndex: z.int().nonnegative(), transactionId: id })
  ),
  ambiguous: z.array(
    z.strictObject({
      rowIndex: z.int().nonnegative(),
      // installment: se salda con pagar_cuota · reversal_without_charge: no hay cargo que anular
      // (se puede dar de alta igual) · multiple_candidates: más de un movimiento podría ser su par.
      reason: z.enum([
        "installment",
        "reversal_without_charge",
        "multiple_candidates",
      ]),
      candidates: z.array(id),
    })
  ),
  skippedBeforeCutoff: z.int().nonnegative(),
})
export type ReconciliationProposal = z.infer<
  typeof reconciliationProposalSchema
>
