import { z } from "zod"
import type { PluginScope } from "../../arch/v1/domain/plugin/plugin.domain.ts"
import { PERIODICITIES } from "../../arch/v1/domain/finance/recurring.domain.ts"
import {
  accountSchema,
  categorySchema,
  incomeSchema,
  monthlyBudgetSchema,
  transactionSchema,
  transactionUpdateSchema,
} from "../finance-form-schemas.ts"

const id = z.string().trim().min(1).max(200)
const operation = { operationId: id }
const name = z.string().trim().min(1).max(200)
const description = z.string().max(2000)
const categoryFields = {
  name,
  icon: z.string().max(100).nullable(),
  color: z.string().max(100).nullable(),
  description: description.nullable(),
}
const incomeFields = { accountId: id, categoryId: id, name }
// Límites técnicos de payload; no cambian la regla financiera del dominio.
const MAX_INSTALLMENTS = 1000
const MAX_SNAPSHOT_CARDS = 100
const period = monthlyBudgetSchema.pick({ year: true, month: true }).shape
const date = z.iso.date()
const amount = z.number().finite()
const positive = amount.positive()
const day = z.number().int().min(1).max(31)
const empty = z.strictObject({})
const page = {
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(100).default(50),
}

const recurring = {
  accountId: id,
  categoryId: id,
  label: name,
  direction: z.enum(["debit", "credit"]),
  baseAmount: positive,
  tolerancePct: amount.min(0).max(100),
  periodicity: z.enum(PERIODICITIES),
  dayOfMonth: day.nullable(),
  startDate: date,
  endDate: date.nullable(),
}
const snapshotBucket = (money: z.ZodNumber) =>
  z
    .strictObject({
      limit: money,
      used: money,
    })
    .refine((value) => value.used <= value.limit, {
      message: "El utilizado debe estar entre cero y el cupo total",
      path: ["used"],
    })
const clp = amount.int().nonnegative()
const usd = amount.nonnegative().multipleOf(0.01)
const snapshotClpBucket = snapshotBucket(clp)
const snapshotUsdBucket = snapshotBucket(usd)
const bucket = z.strictObject({
  available: amount.nullable(),
  used: amount.nullable(),
})

function read<S extends z.ZodObject>(description: string, inputSchema: S) {
  return {
    description,
    inputSchema,
    scope: "finance:read" as const satisfies PluginScope,
    readOnly: true as const,
  }
}
function write<S extends z.ZodObject>(description: string, inputSchema: S) {
  return {
    description,
    inputSchema,
    scope: "finance:write" as const satisfies PluginScope,
    readOnly: false as const,
  }
}

// Contrato compartido de herramientas. Todas las entradas rechazan claves adicionales,
// incluidas userId/email/scopes. Los IDs de recursos requieren autorización en el caso de uso.
// Los importes conservan su moneda; jamás sumar CLP y USD como si fueran equivalentes.
export const pluginTools = {
  lucaplan_ver_operacion: read(
    "Consulta una operación por su clave, solo para el usuario y cliente autenticados. Ante pending o uncertain no repetir la escritura ni cambiar la clave: comprobar el estado y los datos afectados antes de decidir cómo recuperar.",
    z.strictObject({ operationId: id })
  ),
  lucaplan_crear_cuenta: write(
    "Crea una cuenta manual para el usuario autenticado. No conecta correos ni crea una conexión bancaria. Checking y credit_card requieren los últimos cuatro dígitos.",
    accountSchema
      .safeExtend({
        bankName: name,
        name,
        color: z.string().max(100).nullable(),
        cardLast4: z
          .string()
          .regex(/^\d{4}$/)
          .nullable(),
        ...operation,
      })
      .strict()
  ),
  lucaplan_reconciliar_saldos_correo: write(
    "Reconciliación explícita de un banco conectado por correo con fecha y valores del documento. El servidor valida propiedad de linkId, cuentas y tarjetas; national, cash y overdraft son CLP, international USD. Rechaza fechas futuras o anteriores a la reconciliación y movimientos ya importados cuando no se pueden reproyectar con garantía, antes de escribir. No genera movimientos desde una cartola.",
    z.strictObject({
      linkId: id,
      snapshotAt: z.iso
        .datetime({ offset: true })
        .refine(
          (value) => new Date(value).getTime() <= Date.now(),
          "La fecha del documento no puede ser futura"
        ),
      checking: z
        .strictObject({
          ref: z.string().regex(/^\d{4,40}$/),
          cash: clp,
          overdraft: snapshotClpBucket.nullable(),
        })
        .nullable(),
      cards: z
        .array(
          z.strictObject({
            last4: z.string().regex(/^\d{4}$/),
            national: snapshotClpBucket.nullable(),
            international: snapshotUsdBucket.nullable(),
          })
        )
        .max(MAX_SNAPSHOT_CARDS),
      ...operation,
    })
  ),
  lucaplan_listar_cuentas: read(
    "Lista las cuentas y sus saldos por moneda.",
    empty
  ),
  lucaplan_listar_categorias: read("Lista las categorías del usuario.", empty),
  lucaplan_resumen_mes: read(
    "Consulta el resumen financiero del período; conserva CLP y USD separados.",
    z.strictObject(period)
  ),
  lucaplan_buscar_movimientos: read(
    "Busca movimientos con filtros combinados y paginación.",
    z.strictObject({
      query: z.string().max(500).optional(),
      direction: z.enum(["debit", "credit"]).optional(),
      categoryId: id.optional(),
      bankName: name.optional(),
      from: date.optional(),
      to: date.optional(),
      amountMin: amount.nonnegative().optional(),
      amountMax: amount.nonnegative().optional(),
      uncategorized: z.boolean().optional(),
      settledOnly: z.boolean().optional(),
      ...page,
    })
  ),
  lucaplan_crear_movimiento: write(
    "Crea un movimiento manual. Conserva la restricción de cargos en cuentas conectadas.",
    transactionSchema
      .extend({
        accountId: id,
        categoryId: id.nullable(),
        description,
        date: transactionSchema.shape.date.max(40),
        ...operation,
      })
      .strict()
  ),
  lucaplan_corregir_movimiento: write(
    "Reemplaza los campos editables de un movimiento. No cambia cuenta ni moneda y respeta las restricciones de movimientos del banco y cuotas.",
    transactionUpdateSchema
      .extend({
        transactionId: id,
        categoryId: id.nullable(),
        description,
        date: transactionUpdateSchema.shape.date.max(40),
        ...operation,
      })
      .strict()
  ),
  lucaplan_eliminar_movimiento: write(
    "Elimina un movimiento manual y revierte su saldo cuando el dominio lo permite.",
    z.strictObject({ transactionId: id, ...operation })
  ),
  lucaplan_asignar_categoria: write(
    "Asigna o retira la categoría de un movimiento, también del banco. Las cuotas conservan la categoría del plan.",
    z.strictObject({
      transactionId: id,
      categoryId: id.nullable(),
      ...operation,
    })
  ),
  lucaplan_crear_categoria: write(
    "Crea una categoría de ingreso o gasto.",
    categorySchema
      .omit({ id: true })
      .extend({ ...categoryFields, ...operation })
      .strict()
  ),
  lucaplan_editar_categoria: write(
    "Actualiza una categoría existente.",
    categorySchema.extend({ ...categoryFields, id, ...operation }).strict()
  ),
  lucaplan_eliminar_categoria: write(
    "Elimina una categoría y deja sus movimientos sin categoría; elimina fuentes de ingreso asociadas. Rechaza categorías usadas por recurrentes o cuotas.",
    z.strictObject({ categoryId: id, ...operation })
  ),
  lucaplan_ver_presupuesto: read(
    "Consulta presupuesto global y por categoría, incluidos los límites heredados.",
    z.strictObject(period)
  ),
  lucaplan_fijar_presupuesto_global: write(
    "Fija el límite global del mes en CLP.",
    monthlyBudgetSchema.extend(operation).strict()
  ),
  lucaplan_fijar_presupuesto_categoria: write(
    "Fija el límite de una categoría para el mes.",
    z.strictObject({ categoryId: id, ...period, limit: amount, ...operation })
  ),
  lucaplan_listar_ingresos: read(
    "Lista las fuentes de ingreso y si ya se registraron en el mes.",
    z.strictObject(period)
  ),
  lucaplan_crear_ingreso: write(
    "Crea una fuente de ingreso vigente desde el mes indicado.",
    incomeSchema.extend({ ...incomeFields, ...period, ...operation }).strict()
  ),
  lucaplan_editar_ingreso: write(
    "Actualiza una fuente de ingreso desde el mes indicado, conservando su historia.",
    incomeSchema
      .extend({
        ...incomeFields,
        id,
        isActive: z.boolean(),
        ...period,
        ...operation,
      })
      .strict()
  ),
  lucaplan_eliminar_ingreso: write(
    "Finaliza o elimina la fuente desde el mes indicado, conservando los meses anteriores.",
    z.strictObject({ id, ...period, ...operation })
  ),
  lucaplan_registrar_ingreso_mes: write(
    "Genera una sola vez el movimiento mensual de la fuente de ingreso.",
    z.strictObject({ incomeId: id, ...period, ...operation })
  ),
  lucaplan_deshacer_ingreso_mes: write(
    "Deshace el movimiento mensual generado por la fuente y revierte su efecto en saldos.",
    z.strictObject({ incomeId: id, ...period, ...operation })
  ),
  lucaplan_listar_recurrentes: read("Lista las plantillas recurrentes.", empty),
  lucaplan_crear_recurrente: write(
    "Crea una recurrente desde un movimiento existente obligatorio.",
    z.strictObject({ ...recurring, sourceTransactionId: id, ...operation })
  ),
  lucaplan_editar_recurrente: write(
    "Actualiza la plantilla sin alterar su texto bancario de coincidencia.",
    z.strictObject({ id, ...recurring, isActive: z.boolean(), ...operation })
  ),
  lucaplan_activar_recurrente: write(
    "Pausa o reanuda la plantilla; conserva los períodos confirmados.",
    z.strictObject({ id, isActive: z.boolean(), ...operation })
  ),
  lucaplan_eliminar_recurrente: write(
    "Elimina la plantilla recurrente según las reglas existentes.",
    z.strictObject({ id, ...operation })
  ),
  lucaplan_marcar_pago_recurrente: write(
    "Marca o deshace el pago manual del período actual. No deshace un cobro confirmado por el banco.",
    z.strictObject({ id, paid: z.boolean(), ...operation })
  ),
  lucaplan_vincular_pago_recurrente: write(
    "Usa un movimiento bancario existente como cobro del período actual sin duplicarlo.",
    z.strictObject({ id, transactionId: id, ...operation })
  ),
  lucaplan_listar_planes_cuotas: read(
    "Lista planes y cuotas con su estado de pago.",
    empty
  ),
  lucaplan_crear_plan_cuotas: write(
    "Crea un plan de tarjeta o préstamo. En tarjeta exige la compra origen; startIndex indica la primera cuota seguida y totalAmount el saldo restante en préstamos empezados.",
    z.strictObject({
      kind: z.enum(["card", "loan"]),
      accountId: id,
      categoryId: id,
      description: name,
      totalAmount: positive,
      installmentsCount: z.number().int().positive().max(MAX_INSTALLMENTS),
      startDate: date,
      dayOfMonth: day,
      tolerancePct: amount.min(0).max(100),
      startIndex: z.number().int().positive().max(MAX_INSTALLMENTS).optional(),
      amounts: z.array(positive).max(MAX_INSTALLMENTS).optional(),
      paidIndexes: z
        .array(z.number().int().positive().max(MAX_INSTALLMENTS))
        .max(MAX_INSTALLMENTS)
        .optional(),
      sourceTransactionId: id.nullable().optional(),
      ...operation,
    })
  ),
  lucaplan_editar_cuota: write(
    "Edita monto y vencimiento de una cuota; el dominio redistribuye el capital de tarjeta y protege cuotas de préstamo ya pagadas.",
    z.strictObject({
      planId: id,
      itemId: id,
      dueDate: date,
      amount: positive,
      ...operation,
    })
  ),
  lucaplan_categorizar_plan_cuotas: write(
    "Cambia la categoría del plan y todos sus movimientos asociados.",
    z.strictObject({ planId: id, categoryId: id, ...operation })
  ),
  lucaplan_eliminar_plan_cuotas: write(
    "Elimina el plan según sus reglas; las cuotas ya registradas no equivalen a movimientos borrados.",
    z.strictObject({ planId: id, ...operation })
  ),
  lucaplan_pagar_cuota: write(
    "Registra manualmente el pago de una cuota con fecha y monto explícitos.",
    z.strictObject({
      planId: id,
      itemId: id,
      date,
      amount: positive,
      ...operation,
    })
  ),
  lucaplan_vincular_pago_cuota: write(
    "Asigna un movimiento existente a una cuota, sin crear otro gasto.",
    z.strictObject({ planId: id, itemId: id, transactionId: id, ...operation })
  ),
  lucaplan_desvincular_pago_cuota: write(
    "Desvincula el movimiento de la cuota según el dominio. No es una orden de borrar el movimiento.",
    z.strictObject({ planId: id, itemId: id, ...operation })
  ),
  lucaplan_actualizar_saldos: write(
    "Actualiza SOLO el estado actual del banco, con fecha de ahora; no usar para cartolas históricas. Aplica valores explícitos sin llamar IA. national es CLP, international es USD; no recibe ni cambia cupos totales. Los campos null no aparecen en el documento.",
    z.strictObject({
      accountId: id,
      last4: z
        .string()
        .regex(/^\d{4}$/)
        .nullable(),
      cash: amount.nullable(),
      overdraft: bucket,
      national: bucket,
      international: bucket,
      ...operation,
    })
  ),
} as const

export type PluginToolName = keyof typeof pluginTools
export type PluginToolInput<N extends PluginToolName> = z.infer<
  (typeof pluginTools)[N]["inputSchema"]
>
