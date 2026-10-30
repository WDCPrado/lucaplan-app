import { bankReconciliationSchema } from "./bank-reconciliation.ts"
import { z } from "zod"
import type { PluginScope } from "../../arch/v1/domain/plugin/plugin.domain.ts"
import { PERIODICITIES } from "../../arch/v1/domain/finance/recurring.domain.ts"
import { MOVEMENT_STATUSES } from "../../arch/v1/domain/finance/finance.domain.ts"
import {
  accountSchema,
  categorySchema,
  incomeSchema,
  monthlyBudgetSchema,
  transactionSchema,
  transactionUpdateSchema,
} from "../finance-form-schemas.ts"

const id = z.string().trim().min(1).max(200)
const ref = (what: string) => id.describe(what)
const operation = {
  operationId: id.describe(
    "Clave idempotente que eliges tú (p. ej. un UUID), nueva para cada pedido del usuario. Repetir la misma clave con los mismos datos devuelve el resultado guardado sin repetir el cambio. Tras un resultado incierto o pendiente no la cambies: consulta lucaplan_ver_operacion."
  ),
}
const name = z.string().trim().min(1).max(200)
const description = z.string().max(2000)
const money = (extra = "") =>
  `Monto en unidades de la moneda de la cuenta: CLP en pesos enteros (25000), USD con hasta 2 decimales (12.5)${extra}`
const categoryFields = {
  name: name.describe(
    "Nombre visible, único entre tus categorías, p. ej. «Mascotas»"
  ),
  icon: z
    .string()
    .max(100)
    .nullable()
    .describe("Icono lucide o emoji; null sin icono"),
  color: z
    .string()
    .max(100)
    .nullable()
    .describe("Color del anillo; null sin color"),
  description: description
    .nullable()
    .describe(
      "Qué significa esta categoría en tu vida; lo usa la categorización automática"
    ),
}
const incomeFields = {
  accountId: ref(
    "Cuenta donde entra el ingreso (no tarjeta ni línea de crédito)"
  ),
  categoryId: ref("Categoría de tipo ingreso (income)"),
  name: name.describe("Nombre de la fuente, p. ej. «Sueldo»"),
  amount: incomeSchema.shape.amount.describe(money(", mayor que 0")),
  dayOfMonth: incomeSchema.shape.dayOfMonth.describe(
    "Día del mes en que llega, 1 a 31"
  ),
}
// Límites técnicos de payload; no cambian la regla financiera del dominio.
const MAX_INSTALLMENTS = 1000
const MAX_SNAPSHOT_CARDS = 100
const period = {
  year: monthlyBudgetSchema.shape.year.describe(
    "Año del período del presupuesto, p. ej. 2026"
  ),
  month: monthlyBudgetSchema.shape.month.describe(
    "Mes del período del presupuesto, 1 a 12. Con modo ciclo de tarjeta el período va del día siguiente al cierre anterior hasta el cierre de este mes"
  ),
}
const date = z.iso.date().describe("Fecha civil YYYY-MM-DD, p. ej. 2026-10-31")
const amount = z.number().finite()
const positive = amount.positive()
const day = z.number().int().min(1).max(31)
const empty = z.strictObject({})
const page = {
  offset: z
    .number()
    .int()
    .min(0)
    .default(0)
    .describe(
      "Desde qué resultado empezar; usa nextOffset de la página anterior"
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(50)
    .describe("Resultados por página, 1 a 100"),
}

const recurring = {
  accountId: ref("Cuenta donde se cobra o abona"),
  categoryId: ref(
    "Categoría del mismo lado: expense para gastos (debit), income para ingresos (credit)"
  ),
  label: name.describe("Nombre visible, p. ej. «Arriendo»"),
  direction: z
    .enum(["debit", "credit"])
    .describe("debit = gasto; credit = ingreso"),
  baseAmount: positive.describe(money(" esperado por período")),
  tolerancePct: amount
    .min(0)
    .max(100)
    .describe(
      "Margen ± en % (entero 0 a 100) para reconocer el cobro real, p. ej. 10"
    ),
  periodicity: z
    .enum(PERIODICITIES)
    .describe("monthly, biweekly (cada 14 días desde startDate) o yearly"),
  dayOfMonth: day
    .nullable()
    .describe(
      "Día de cobro 1 a 31 (obligatorio en monthly/yearly; null en biweekly)"
    ),
  startDate: date.describe("Desde cuándo rige, YYYY-MM-DD"),
  endDate: date
    .nullable()
    .describe("Último día de vigencia YYYY-MM-DD; null = indefinida"),
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
  available: amount
    .nullable()
    .describe("Disponible; null si el documento no lo muestra"),
  used: amount
    .nullable()
    .describe("Utilizado (deuda); null si el documento no lo muestra"),
})

type ToolOptions = { title: string; destructive?: boolean }
function read<S extends z.ZodObject>(
  title: string,
  description: string,
  inputSchema: S
) {
  return {
    title,
    description,
    inputSchema,
    scope: "finance:read" as const satisfies PluginScope,
    readOnly: true as const,
    destructive: false,
  }
}
// destructive: borra, sobrescribe o deshace datos existentes. Crear o registrar algo aditivo no lo es.
function write<S extends z.ZodObject>(
  { title, destructive = false }: ToolOptions,
  description: string,
  inputSchema: S
) {
  return {
    title,
    description,
    inputSchema,
    scope: "finance:write" as const satisfies PluginScope,
    readOnly: false as const,
    destructive,
  }
}

// Contrato compartido de herramientas. Todas las entradas rechazan claves adicionales,
// incluidas userId/email/scopes. Los IDs de recursos requieren autorización en el caso de uso.
// Los importes conservan su moneda; jamás sumar CLP y USD como si fueran equivalentes.
export const pluginTools = {
  // --- Operaciones ---
  lucaplan_ver_operacion: read(
    "Ver resultado de una operación",
    "Úsala cuando una escritura respondió pendiente, incierto o se cortó la respuesta: devuelve el estado (pending, completed, failed, uncertain) y el resultado guardado de esa operationId. Ante pending o uncertain no repitas la escritura ni cambies la clave: revisa los datos afectados con las herramientas de lectura y explícale al usuario qué pasó. Devuelve null si la clave no existe (un rechazo previo no deja recibo).",
    z.strictObject({ operationId: operation.operationId })
  ),

  // --- Cuentas y saldos ---
  lucaplan_listar_cuentas: read(
    "Listar cuentas y saldos",
    "Úsala para conocer las cuentas del usuario, sus ids y saldos antes de crear movimientos, ingresos, recurrentes o cuotas. Cada cuenta trae moneda, tipo, si es manual o conectada por correo (provider/connectionMethod) y, en las conectadas, sus buckets: cash = caja, overdraft = sobregiro (used es deuda), credit_national (CLP) y credit_international (USD) = cupos de tarjeta. El cupo y la línea no son caja. Para la posición consolidada por moneda usa lucaplan_planificar_periodo.",
    empty
  ),
  lucaplan_crear_cuenta: write(
    { title: "Crear cuenta manual" },
    "Úsala cuando el usuario quiere registrar una cuenta que lleva a mano (no conectada por correo). No conecta bancos ni correos. checking y credit_card exigen los últimos 4 dígitos. El saldo inicial es el estado actual de la cuenta; no crea movimientos.",
    accountSchema
      .safeExtend({
        bankName: name.describe(
          "Banco o institución, p. ej. «Banco Estado»; se reutiliza si ya existe"
        ),
        name: name.describe("Nombre visible de la cuenta"),
        accountType: accountSchema.shape.accountType.describe(
          "checking (corriente), savings, credit_card, credit_line, wallet o investment"
        ),
        currency: accountSchema.shape.currency.describe(
          "CLP o USD; no se puede cambiar después"
        ),
        balance: accountSchema.shape.balance.describe(
          money(
            ". En checking puede ser negativo (sobregiro usado); en tarjeta, negativo = deuda"
          )
        ),
        overdraftLimit: accountSchema.shape.overdraftLimit.describe(
          "Línea de sobregiro total (solo checking), ≥ 0"
        ),
        color: z
          .string()
          .max(100)
          .nullable()
          .describe("Color de la tarjeta; null sin color"),
        cardLast4: z
          .string()
          .regex(/^\d{4}$/)
          .nullable()
          .describe(
            "Últimos 4 dígitos (obligatorio en checking y credit_card); null en el resto"
          ),
        ...operation,
      })
      .strict()
  ),
  lucaplan_editar_cuenta: write(
    { title: "Editar cuenta manual", destructive: true },
    "Úsala para cambiar nombre, color, últimos 4 dígitos o línea de sobregiro de una cuenta MANUAL. No cambia saldo, moneda ni tipo (para el saldo usa lucaplan_actualizar_saldos). Rechaza cuentas conectadas por correo.",
    z.strictObject({
      accountId: ref("Cuenta manual a editar"),
      name: name.describe("Nombre visible nuevo"),
      color: z.string().max(100).nullable().describe("Color; null sin color"),
      cardLast4: z
        .string()
        .regex(/^\d{4}$/)
        .nullable()
        .describe(
          "Últimos 4 dígitos (obligatorio en checking y credit_card); null en el resto"
        ),
      overdraftLimit: amount
        .nonnegative()
        .optional()
        .describe(
          "Línea de sobregiro total, solo en checking; omitido = sin cambio"
        ),
      ...operation,
    })
  ),
  lucaplan_previsualizar_eliminar_cuenta: read(
    "Previsualizar eliminación de cuenta",
    "Paso 1 de 2 para eliminar una cuenta MANUAL. No borra nada: calcula qué se borraría (movimientos, buckets, ingresos, recurrentes, planes de cuotas, el banco si queda vacío) y qué relaciones con otras cuentas se rompen en ambos sentidos. Devuelve confirmationToken, válido 15 minutos y solo para este estado exacto. Muestra el impacto al usuario y pide su confirmación explícita antes de llamar lucaplan_eliminar_cuenta. Rechaza cuentas conectadas por correo.",
    z.strictObject({ accountId: ref("Cuenta manual a eliminar") })
  ),
  lucaplan_eliminar_cuenta: write(
    { title: "Eliminar cuenta manual", destructive: true },
    "Paso 2 de 2: elimina una cuenta MANUAL y todo lo suyo, en una sola transacción. Úsala solo después de lucaplan_previsualizar_eliminar_cuenta y con la confirmación explícita del usuario. Si la cuenta cambió desde la previsualización o el token venció, no borra nada y pide previsualizar otra vez. Irreversible. Nunca borra bancos o cuentas conectadas.",
    z.strictObject({
      accountId: ref("La misma cuenta previsualizada"),
      confirmationToken: z
        .string()
        .min(1)
        .max(300)
        .describe(
          "confirmationToken devuelto por lucaplan_previsualizar_eliminar_cuenta"
        ),
      ...operation,
    })
  ),
  lucaplan_actualizar_saldos: write(
    { title: "Actualizar saldos actuales", destructive: true },
    "Úsala cuando el usuario informa los saldos que su banco muestra HOY (caja, sobregiro, cupos). Aplica valores explícitos con fecha de ahora, sin IA; no cambia cupos totales ni crea movimientos. No la uses para cartolas o fechas pasadas (para un banco conectado usa lucaplan_reconciliar_saldos_correo). national es CLP e international es USD; un campo null significa que el documento no lo muestra.",
    z.strictObject({
      accountId: ref("Cuenta a actualizar"),
      last4: z
        .string()
        .regex(/^\d{4}$/)
        .nullable()
        .describe("Últimos 4 dígitos de la tarjeta, si aplica"),
      cash: amount
        .nullable()
        .describe(
          "Saldo de la cuenta en CLP, con su signo; puede ser negativo aunque la línea esté sin uso. No se deduce deuda de línea de este saldo; null si no se muestra"
        ),
      overdraft: bucket.describe("Sobregiro (CLP)"),
      national: bucket.describe("Cupo nacional de tarjeta (CLP)"),
      international: bucket.describe("Cupo internacional de tarjeta (USD)"),
      ...operation,
    })
  ),
  lucaplan_reconciliar_saldos_correo: write(
    { title: "Reconciliar banco conectado", destructive: true },
    "Úsala solo para un banco conectado por correo, con la fecha y valores reales de un documento (linkId sale de lucaplan_listar_cuentas). national, cash y overdraft son CLP; international es USD. Rechaza fechas futuras o anteriores a la última reconciliación o sincronización. Cambia saldos; no crea movimientos desde la cartola.",
    z.strictObject({
      linkId: ref("linkId del banco conectado"),
      snapshotAt: z.iso
        .datetime({ offset: true })
        .refine(
          (value) => new Date(value).getTime() <= Date.now(),
          "La fecha del documento no puede ser futura"
        )
        .describe(
          "Fecha y hora del documento con zona, p. ej. 2026-10-16T09:30:00-03:00"
        ),
      checking: z
        .strictObject({
          ref: z
            .string()
            .regex(/^\d{4,40}$/)
            .describe("Número o últimos dígitos de la cuenta corriente"),
          cash: clp.describe("Caja en CLP, entero ≥ 0"),
          overdraft: snapshotClpBucket
            .nullable()
            .describe("Línea de sobregiro CLP: limit y used"),
        })
        .nullable(),
      cards: z
        .array(
          z.strictObject({
            last4: z.string().regex(/^\d{4}$/),
            national: snapshotClpBucket
              .nullable()
              .describe("Cupo nacional CLP"),
            international: snapshotUsdBucket
              .nullable()
              .describe("Cupo internacional USD"),
          })
        )
        .max(MAX_SNAPSHOT_CARDS),
      ...operation,
    })
  ),

  // --- Categorías ---
  lucaplan_listar_categorias: read(
    "Listar categorías",
    "Úsala para obtener los ids y tipos (income = ingreso, expense = gasto) de las categorías antes de categorizar, presupuestar o crear ingresos, recurrentes y cuotas. Una categoría de gasto solo aplica a cargos (debit) y una de ingreso a abonos (credit). Para el uso del mes por categoría usa lucaplan_ver_presupuesto.",
    empty
  ),
  lucaplan_crear_categoria: write(
    { title: "Crear categoría" },
    "Úsala para crear una categoría de ingreso o gasto. Revisa antes lucaplan_listar_categorias: el nombre es único.",
    categorySchema
      .omit({ id: true })
      .extend({
        ...categoryFields,
        type: categorySchema.shape.type.describe(
          "income (ingreso) o expense (gasto)"
        ),
        paceEnabled: categorySchema.shape.paceEnabled.describe(
          "¿Muestra el ritmo de gasto del período? Apágalo en gastos de una vez (suscripciones)"
        ),
        ...operation,
      })
      .strict()
  ),
  lucaplan_editar_categoria: write(
    { title: "Editar categoría", destructive: true },
    "Úsala para renombrar o cambiar icono, color, descripción, tipo o ritmo de una categoría existente. Reemplaza todos esos campos: envía también los que no cambian.",
    categorySchema
      .extend({
        ...categoryFields,
        id: ref("Categoría a editar"),
        type: categorySchema.shape.type.describe("income o expense"),
        paceEnabled: categorySchema.shape.paceEnabled.describe(
          "Ritmo de gasto activado; omitido = se conserva"
        ),
        ...operation,
      })
      .strict()
  ),
  lucaplan_eliminar_categoria: write(
    { title: "Eliminar categoría", destructive: true },
    "Elimina una categoría: sus movimientos quedan sin categoría y se eliminan las fuentes de ingreso que la usan. Rechaza la eliminación si la usan recurrentes o planes de cuotas (recategorízalos primero). Confirma con el usuario antes.",
    z.strictObject({ categoryId: ref("Categoría a eliminar"), ...operation })
  ),
  lucaplan_vincular_reembolso: write(
    { title: "Vincular reembolso a gasto" },
    "Vincula una transferencia bancaria recibida a una compra compartida, conservando ambos movimientos originales. Compensa solo el gasto del presupuesto, nunca el saldo bancario. El importe acumulado no puede exceder ni el gasto ni el abono. No uses ingresos ficticios.",
    z.strictObject({
      expenseId: ref("ID del gasto bancario confirmado"),
      creditId: ref("ID del ingreso bancario confirmado"),
      amount: z.number().int().positive().describe("Importe compensado en CLP"),
      ...operation,
    })
  ),
  lucaplan_vincular_abono_ingreso: write(
    { title: "Vincular abono a ingreso planificado" },
    "Vincula un abono bancario ya existente a su fuente de ingreso. No genera un abono nuevo, no modifica el saldo ni la fecha bancaria original. La fuente y el abono deben pertenecer al usuario y coincidir en cuenta, categoría y moneda.",
    z.strictObject({
      incomeId: ref("Fuente de ingreso planificada"),
      transactionId: ref("Abono real confirmado"),
      ...operation,
    })
  ),
  lucaplan_asignar_categoria: write(
    { title: "Categorizar movimiento", destructive: true },
    "Úsala para asignar, cambiar o quitar (null) la categoría de UN movimiento, también de bancos conectados. Si el movimiento es de una recurrente o un plan de cuotas, la categoría pasa a toda la recurrente o el plan. Aprende el texto del comercio si no tenía regla. Responde sameTextCount (cuántos movimientos sin categoría tienen el mismo texto) y learnedCategoryId (regla previa distinta que NO se pisó): si alguno aplica, ofrece lucaplan_aprender_categoria.",
    z.strictObject({
      transactionId: ref("Movimiento a categorizar"),
      categoryId: ref("Categoría del mismo lado que el movimiento")
        .nullable()
        .describe(
          "Categoría del mismo lado que el movimiento; null = dejarlo sin categoría"
        ),
      ...operation,
    })
  ),
  lucaplan_aprender_categoria: write(
    { title: "Aprender y propagar categoría", destructive: true },
    "Úsala después de lucaplan_asignar_categoria cuando el usuario confirma que esa categoría es la regla para ese comercio: guarda una nota de por qué (contexto para la categorización automática) y, con applyToSameText, aplica la categoría a los demás movimientos sin categoría con el mismo texto y reemplaza la regla aprendida. Con applyToSameText false solo guarda la nota si la regla ya apuntaba a esa categoría. No toca saldos.",
    z.strictObject({
      transactionId: ref("Movimiento ya categorizado que sirve de ejemplo"),
      note: z
        .string()
        .max(500)
        .optional()
        .describe(
          "Por qué este comercio va en esa categoría, p. ej. «veterinario de la Luna»"
        ),
      applyToSameText: z
        .boolean()
        .describe(
          "true = es la regla: propagar a los movimientos equivalentes; false = solo este"
        ),
      ...operation,
    })
  ),

  // --- Movimientos ---
  lucaplan_buscar_movimientos: read(
    "Buscar movimientos",
    "Úsala para encontrar movimientos y sus ids: combina filtros (todos con AND) y pagina con offset/limit. Orden estable: fecha desc y luego id. La respuesta trae total, hasMore y nextOffset para recorrer todo y conciliar. Cada movimiento trae su procedencia (manual, banco por correo, ingreso, recurrente, cuota), sus relaciones y qué se puede hacer con él (canEdit, canDelete y el motivo si no). Por defecto (settledOnly) excluye anulados, duplicados y recurrentes por cobrar; usa status para verlos. financialContext distingue importe guardado, impacto registrado en cupo, evidencia bancaria no verificada y equivalente CLP referencial. affectsCash solo corresponde a cuenta corriente; countsInBudget indica gasto confirmado dentro de categoría con tope en budgetPeriod, no ingreso ni gasto neto. Para el detalle completo de uno usa lucaplan_ver_movimiento.",
    z.strictObject({
      query: z
        .string()
        .max(500)
        .optional()
        .describe(
          "Texto en descripción o nombre de categoría; si trae dígitos, también monto por prefijo"
        ),
      direction: z
        .enum(["debit", "credit"])
        .optional()
        .describe("debit = cargos; credit = abonos"),
      accountId: ref("Solo movimientos de esta cuenta").optional(),
      currency: z
        .enum(["CLP", "USD"])
        .optional()
        .describe("Solo movimientos en esta moneda"),
      categoryId: ref("Solo movimientos de esta categoría").optional(),
      bankName: name
        .optional()
        .describe("Solo cuentas de bancos con este nombre exacto"),
      from: date.optional().describe("Desde esta fecha inclusive, YYYY-MM-DD"),
      to: date.optional().describe("Hasta esta fecha inclusive, YYYY-MM-DD"),
      amountMin: amount
        .nonnegative()
        .optional()
        .describe("Monto mínimo (magnitud, sin signo)"),
      amountMax: amount
        .nonnegative()
        .optional()
        .describe("Monto máximo (magnitud, sin signo)"),
      uncategorized: z
        .boolean()
        .optional()
        .describe(
          "true = solo los pendientes de categorizar (sin categoría, no internos, sin revisar)"
        ),
      internal: z
        .boolean()
        .optional()
        .describe(
          "true = solo internos (traspasos, pagos de tarjeta; no cuentan en presupuesto); false = excluirlos"
        ),
      status: z
        .array(z.enum(MOVEMENT_STATUSES))
        .min(1)
        .max(MOVEMENT_STATUSES.length)
        .optional()
        .describe(
          "Solo estos estados: confirmed, pending, reversed, duplicated. Reemplaza a settledOnly"
        ),
      settledOnly: z
        .boolean()
        .optional()
        .describe(
          "Por defecto true: excluye anulados, duplicados y recurrentes por cobrar"
        ),
      ...page,
    })
  ),
  lucaplan_ver_movimiento: read(
    "Ver detalle de movimiento",
    "Úsala antes de editar, borrar o re-vincular un movimiento: devuelve sus datos, procedencia, relaciones (recurrente, cuota y plan, ingreso, compra origen de un plan) y capacidades exactas (canEdit, editableFields, canDelete, canCategorize con su motivo). Incluye financialContext y budgetPeriod: moneda guardada, impacto registrado, cupo vinculado, equivalente CLP referencial y evidencia no verificada. canCorrectMetadata y canCorrectCurrency indican si las herramientas actuales permiten esas correcciones; no deducir liquidación bancaria desde un correo en pesos.",
    z.strictObject({ transactionId: ref("Movimiento a consultar") })
  ),
  lucaplan_crear_movimiento: write(
    { title: "Crear movimiento manual" },
    "Úsala para registrar un gasto o ingreso real en una cuenta manual, con su fecha. En cuentas conectadas solo admite abonos (credit) en la cuenta corriente: los cargos llegan por correo y se duplicarían. Mueve el saldo de la cuenta. Un abono confirmado independiente (sin incomeId) participa una sola vez en el ajuste de ingresos del ciclo; uno vinculado a fuente se considera desde la fuente y no se suma dos veces. No la uses para planificar algo futuro (usa ingresos, recurrentes o cuotas) ni para pagar una cuota (usa lucaplan_pagar_cuota o lucaplan_vincular_pago_cuota).",
    transactionSchema
      .extend({
        accountId: ref("Cuenta del movimiento"),
        categoryId: ref("Categoría del mismo lado")
          .nullable()
          .describe(
            "Categoría del mismo lado (expense para debit, income para credit); null sin categoría"
          ),
        description: description.describe("Descripción, p. ej. «Veterinario»"),
        date: transactionSchema.shape.date
          .max(40)
          .describe("Fecha del movimiento YYYY-MM-DD"),
        amount: transactionSchema.shape.amount.describe(
          money(", mayor que 0 (el signo lo da direction)")
        ),
        currency: transactionSchema.shape.currency.describe(
          "Moneda: debe ser la de la cuenta"
        ),
        direction: transactionSchema.shape.direction.describe(
          "debit = gasto; credit = ingreso"
        ),
        ...operation,
      })
      .strict()
  ),
  lucaplan_previsualizar_conciliacion: read(
    "Previsualizar conciliación bancaria completa",
    "Simula correcciones explícitas por ID (moneda, importe, fecha, categoría), altas sin contraparte y saldos de UNA cuenta. Conserva vínculos, rechaza ambigüedad y reejecuta solo movimientos posteriores al corte. Incluye todos los buckets de esa cuenta e IDs del día del corte que el documento ya incluye. Devuelve previewToken y diferencias; no escribe. No adivinar categorías ni convertir CLP a USD por tipo de cambio estimado: usar moneda e importe de cartola. Si un alta tiene candidatos, devuelve sus IDs para revisarlos con distinctFrom y evidencia por operación distinta. Para liquidar un cobro recurrente conservando su plan usa settleRecurringCharge=true.",
    bankReconciliationSchema
  ),
  lucaplan_aplicar_conciliacion: write(
    {title:"Aplicar conciliación bancaria",destructive:true},
    "Aplica atómicamente la propuesta verificada por lucaplan_previsualizar_conciliacion, con los mismos datos y previewToken. Conserva identidad y vínculos; guarda auditoría y protege las correcciones del reproceso del correo. No duplica movimientos anteriores al corte. Si cambiaron datos, vuelve a previsualizar. Los cobros recurrentes permiten settleRecurringCharge=true para corregir el importe y moneda liquidados sin cambiar categoría ni plan futuro. Ingresos y cuotas conservan restricciones. Las altas distintas de candidatos cercanos exigen distinctFrom con sus IDs y evidencia individual.",
    bankReconciliationSchema.extend({previewToken:z.string().length(64),...operation})
  ),
  lucaplan_conciliar_cartola: read(
    "Conciliar cartola",
    "Previsualiza coincidencias de una cartola ya extraída, sin escribir: importe exacto, misma cuenta y moneda, fechas ±1 día; si hay varias coincidencias marca ambiguo. Los pagos y transferencias internas deben excluirse del lote de cargos. No interpreta PDF directamente.",
    z.strictObject({
      accountId: ref("Cuenta bancaria"),
      currency: z.enum(["CLP","USD"]),
      movements: z.array(z.strictObject({
        date, description: description.min(1), amount: positive,
        direction: z.enum(["debit","credit"]),
      })).min(1).max(50),
    })
  ),
  lucaplan_importar_cargos_bancarios: write(
    { title: "Importar cargos bancarios en lote", destructive: true },
    "Importa hasta 20 cargos confirmados de cartola y opcionalmente categoriza cada uno. Revisa duplicados contra movimientos existentes antes de crear cada cargo. Devuelve el resultado individual: creado, duplicado/revisión o error, además de un resumen. Usa operationId idempotente y no repitas el lote si una respuesta queda incierta.",
    z.strictObject({
      accountId: ref("Cuenta bancaria conectada"),
      currency: z.enum(["CLP","USD"]),
      movements: z.array(z.strictObject({
        date, description: description.min(1), amount: positive,
        categoryId: ref("Categoría de gasto").nullable().optional(),
      })).min(1).max(20),
      ...operation,
    })
  ),
  lucaplan_registrar_ingreso_extraordinario: write(
    { title: "Registrar ingreso extraordinario", destructive: true },
    "Registra un abono real único en cuenta corriente y categoría de ingreso, sin generar una fuente mensual recurrente. No registrar transferencias entre cuentas propias como ingresos. Los abonos confirmados sin fuente de ingreso vinculada sí cuentan para ajustar el presupuesto del ciclo; si ya están vinculados a una fuente, no vuelvas a sumarlos. Verifica antes que no exista el abono. Idempotente por operationId.",
    z.strictObject({
      accountId: ref("Cuenta corriente"),
      categoryId: ref("Categoría de ingreso"),
      date, description: description.min(1), amount: positive,
      currency: z.enum(["CLP","USD"]),
      ...operation,
    })
  ),
  lucaplan_registrar_cargo_bancario: write(
    { title: "Registrar cargo bancario faltante", destructive: true },
    "Registra un cargo real de cartola en una cuenta conectada por correo cuando falta su aviso. Comprueba antes la cuenta, moneda, fecha y monto con lucaplan_buscar_movimientos. Rechaza coincidencias del mismo importe dentro de +/-1 día para impedir duplicados; si hay dos cargos legítimos iguales, usa la importación visual para revisión. No sirve para pagos de tarjeta, traspasos internos, cuotas ya planificadas ni ingresos. Acepta categoryId opcional para clasificar al crear; null mantiene sin categoría. Si se rechaza, explica el motivo y no crea movimiento. La escritura usa operationId idempotente.",
    z.strictObject({
      accountId: ref("Cuenta conectada del banco"),
      date: date.describe("Fecha de la cartola, YYYY-MM-DD"),
      description: description.min(1).describe("Descripción bancaria real, no una interpretación"),
      amount: positive.describe("Importe positivo en moneda de la cuenta"),
      currency: z.enum(["CLP", "USD"]).describe("Moneda de la cuenta"),
      categoryId: ref("Categoría de gasto perteneciente al usuario").nullable().optional().describe("Categoría opcional; null para dejar sin categorizar"),
      ...operation,
    })
  ),
  lucaplan_corregir_metadatos_movimiento: write(
    { title: "Corregir fecha y descripción de movimiento", destructive: true },
    "Corrige la fecha o descripción de un movimiento propio importado o creado por el agente, incluso en cuenta conectada. No permite alterar importe, moneda, dirección, categoría ni movimientos con ID externo bancario. No modifica saldo. Los ingresos vinculados a una fuente siguen perteneciendo a su mes de generación; para cambiar ese mes se debe deshacer y regenerar con verificación bancaria.",
    z.strictObject({
      transactionId: ref("Movimiento a corregir"),
      date: date.describe("Fecha real del movimiento YYYY-MM-DD"),
      description: description.min(1),
      ...operation,
    })
  ),
  lucaplan_corregir_movimiento: write(
    { title: "Corregir movimiento", destructive: true },
    "Úsala para corregir descripción, fecha, monto, dirección o categoría de un movimiento de cuenta MANUAL (revisa canEdit con lucaplan_ver_movimiento). Reemplaza todos esos campos: envía también los que no cambian. No cambia cuenta ni moneda. Un movimiento pendiente no mueve la caja al editarlo. En cuotas el monto se corrige en el plan (lucaplan_editar_cuota). Para solo la categoría usa lucaplan_asignar_categoria.",
    transactionUpdateSchema
      .extend({
        transactionId: ref("Movimiento a corregir"),
        categoryId: ref("Categoría")
          .nullable()
          .describe("Categoría; null sin categoría"),
        description: description.describe("Descripción"),
        date: transactionUpdateSchema.shape.date
          .max(40)
          .describe("Fecha YYYY-MM-DD"),
        amount: transactionUpdateSchema.shape.amount.describe(
          "Monto en la moneda del movimiento (no se convierte): CLP en pesos enteros (25000), USD con hasta 2 decimales (12.5)"
        ),
        direction: transactionUpdateSchema.shape.direction.describe(
          "debit = gasto; credit = ingreso"
        ),
        ...operation,
      })
      .strict()
  ),
  lucaplan_eliminar_movimiento: write(
    { title: "Eliminar movimiento", destructive: true },
    "Elimina un movimiento y revierte su efecto en el saldo si estaba confirmado (un pendiente nunca movió la caja). En cuentas conectadas solo se pueden borrar abonos, cargos sin categoría y cobros sobrantes de una cuota ya pagada; revisa canDelete con lucaplan_ver_movimiento. Confirma con el usuario antes.",
    z.strictObject({
      transactionId: ref("Movimiento a eliminar"),
      ...operation,
    })
  ),

  // --- Presupuesto ---
  lucaplan_resumen_mes: read(
    "Resumen del mes",
    "Úsala para un vistazo del período: caja, deudas, ingresos y gastos del mes. Los totales del presupuesto van en CLP con conversión referencial; movementTotalsByCurrency trae los montos originales separados por moneda, sin sumar CLP y USD. Para planificar lo que falta usa lucaplan_planificar_periodo.",
    z.strictObject(period)
  ),
  lucaplan_medidor_financiero: read(
    "Medidor de salud financiera",
    "Consulta planStatus (presupuesto) y status (plan más liquidez registrada). Una posición neta negativa impide sano, y caja neta cero o línea utilizada implica al menos al_limite. Compara todos los ingresos planificados activos contra los gastos confirmados de categorías con tope >0, más una proyección separada de compromisos pendientes sin doble conteo. Crédito y débito usan el mismo cálculo; cambia solo el rango del período. balance y porcentaje corresponden solo al plan; liquidity separa caja, línea utilizada y posición neta CLP con los últimos saldos registrados, no saldos históricos del período. Ambos modos incluyen corriente y tarjeta; nunca sumar cupos a caja.",
    z.strictObject(period)
  ),
  lucaplan_ver_presupuesto: read(
    "Ver presupuesto del mes",
    "Úsala para ver el límite global y el tope, gastado, comprometido y disponible de cada categoría en un mes (actual, pasado o futuro). Los topes se heredan del último mes definido (carry-forward). Todo en CLP; los gastos USD entran convertidos de forma referencial. Los movimientos internos no consumen presupuesto. Para ajustar el límite global: fuentes de ingreso vigentes + abonos confirmados independientes (sin incomeId), sin duplicar los abonos vinculados a ingresos planificados.",
    z.strictObject(period)
  ),
  lucaplan_fijar_presupuesto_global: write(
    { title: "Fijar presupuesto global", destructive: true },
    "Fija el límite global del mes en CLP (entero ≥ 0), para el mes actual o uno futuro; los meses siguientes lo heredan hasta que se cambie. Es un tope: no crea gastos ni mueve dinero.",
    monthlyBudgetSchema
      .extend({
        ...period,
        globalLimit: monthlyBudgetSchema.shape.globalLimit.describe(
          "Límite global en pesos enteros, p. ej. 1500000"
        ),
        ...operation,
      })
      .strict()
  ),
  lucaplan_fijar_presupuesto_categoria: write(
    { title: "Fijar tope de categoría", destructive: true },
    "Fija el tope de una categoría de gasto en CLP para un mes (actual o futuro); los meses siguientes lo heredan. 0 la deja fuera del plan. Es un tope: no crea gastos ni mueve dinero.",
    z.strictObject({
      categoryId: ref("Categoría de gasto"),
      ...period,
      limit: amount.describe("Tope del mes en CLP, p. ej. 120000"),
      ...operation,
    })
  ),

  // --- Ingresos ---
  lucaplan_listar_ingresos: read(
    "Listar fuentes de ingreso",
    "Úsala para ver las fuentes de ingreso vigentes en un mes, su monto de ese mes y si ya se registró el movimiento (generated). Una fuente creada para un mes futuro aparece desde ese mes.",
    z.strictObject(period)
  ),
  lucaplan_crear_ingreso: write(
    { title: "Crear fuente de ingreso" },
    "Úsala para planificar un ingreso que se repite cada mes (sueldo, arriendo cobrado) desde el mes indicado, actual o futuro. No crea movimientos ni cambia la caja: el cobro se registra con lucaplan_registrar_ingreso_mes.",
    incomeSchema.extend({ ...incomeFields, ...period, ...operation }).strict()
  ),
  lucaplan_editar_ingreso: write(
    { title: "Editar fuente de ingreso", destructive: true },
    "Cambia una fuente de ingreso desde el mes indicado; los meses anteriores conservan su monto. Reemplaza todos los campos. Para terminarla usa lucaplan_eliminar_ingreso.",
    incomeSchema
      .extend({
        ...incomeFields,
        id: ref("Fuente de ingreso"),
        isActive: z.boolean().describe("false = pausada"),
        ...period,
        ...operation,
      })
      .strict()
  ),
  lucaplan_eliminar_ingreso: write(
    { title: "Finalizar fuente de ingreso", destructive: true },
    "Finaliza la fuente desde el mes indicado (deja de existir de ahí en adelante, los meses anteriores se conservan). Si no tiene historia previa se borra por completo.",
    z.strictObject({ id: ref("Fuente de ingreso"), ...period, ...operation })
  ),
  lucaplan_registrar_ingreso_mes: write(
    { title: "Registrar cobro de ingreso" },
    "Úsala cuando el ingreso del mes ya llegó: crea una sola vez el movimiento (abono) en su cuenta con el monto de la fuente y sube la caja. Repetirlo no abona dos veces. Si el monto real fue otro, corrígelo después con lucaplan_corregir_movimiento (cuentas manuales).",
    z.strictObject({
      incomeId: ref("Fuente de ingreso"),
      ...period,
      ...operation,
    })
  ),
  lucaplan_deshacer_ingreso_mes: write(
    { title: "Revertir cobro de ingreso", destructive: true },
    "Deshace el movimiento de ingreso registrado para ese mes y revierte su efecto en la caja. Úsala si se registró por error.",
    z.strictObject({
      incomeId: ref("Fuente de ingreso"),
      ...period,
      ...operation,
    })
  ),

  // --- Recurrentes ---
  lucaplan_listar_recurrentes: read(
    "Listar recurrentes",
    "Úsala para ver gastos e ingresos recurrentes: monto base y rango aceptado, próximo cobro, si el período en curso ya se pagó y si se marcó a mano.",
    empty
  ),
  lucaplan_crear_recurrente: write(
    { title: "Crear recurrente desde movimiento" },
    "Úsala cuando un cobro que ya existe (p. ej. Netflix de este mes) se repetirá: el movimiento de origen queda como el cobro de su período y su texto real se usa para reconocer los siguientes. Si todavía no hay ningún cobro real, usa lucaplan_planificar_recurrente.",
    z.strictObject({
      ...recurring,
      sourceTransactionId: ref("Movimiento real de origen, de la misma cuenta"),
      ...operation,
    })
  ),
  lucaplan_planificar_recurrente: write(
    { title: "Planificar recurrente sin cobro previo" },
    "Úsala para un compromiso que se repetirá y todavía no tiene un cobro real (un arriendo que empieza el próximo mes). No crea movimientos ni cambia la caja: cada período aparece como por cobrar. Como no hay texto bancario real no se reconoce sola: cuando llegue el cargo vincúlalo con lucaplan_vincular_pago_recurrente (eso le fija el texto para los siguientes) o márcalo con lucaplan_marcar_pago_recurrente.",
    z.strictObject({ ...recurring, ...operation })
  ),
  lucaplan_editar_recurrente: write(
    { title: "Editar recurrente", destructive: true },
    "Cambia cuenta, categoría, nombre, monto, tolerancia, periodicidad o vigencia de una recurrente; no cambia el texto bancario que la reconoce. Reemplaza todos los campos. Acortar la vigencia retira los por cobrar que quedan fuera.",
    z.strictObject({
      id: ref("Recurrente"),
      ...recurring,
      isActive: z.boolean().describe("false = pausada"),
      ...operation,
    })
  ),
  lucaplan_activar_recurrente: write(
    { title: "Pausar o reanudar recurrente", destructive: true },
    "Pausa (false) o reanuda (true) una recurrente; conserva los cobros ya confirmados. Una terminada no se reanuda sin correr antes su fecha de fin.",
    z.strictObject({
      id: ref("Recurrente"),
      isActive: z.boolean().describe("true = reanudar"),
      ...operation,
    })
  ),
  lucaplan_eliminar_recurrente: write(
    { title: "Eliminar recurrente", destructive: true },
    "Elimina la recurrente: los cobros confirmados quedan como movimientos normales y se borra el por cobrar pendiente.",
    z.strictObject({ id: ref("Recurrente"), ...operation })
  ),
  lucaplan_marcar_pago_recurrente: write(
    { title: "Marcar pago de recurrente", destructive: true },
    "Marca (paid true) o desmarca el pago del período EN CURSO cuando el usuario ya pagó y el banco aún no avisa; no crea otro movimiento ni mueve saldos. No deshace un cobro confirmado por el banco. Si el cargo real ya existe, usa lucaplan_vincular_pago_recurrente.",
    z.strictObject({
      id: ref("Recurrente"),
      paid: z.boolean().describe("true = ya pagado"),
      ...operation,
    })
  ),
  lucaplan_candidatos_pago_recurrente: read(
    "Candidatos de cobro de recurrente",
    "Úsala antes de lucaplan_vincular_pago_recurrente: lista movimientos del banco confirmados y sin vínculo, de la misma dirección, moneda y categoría, de los últimos días.",
    z.strictObject({
      id: ref("Recurrente"),
      days: z
        .number()
        .int()
        .min(1)
        .max(365)
        .optional()
        .describe("Ventana hacia atrás en días, por defecto 10"),
      query: z.string().max(500).optional().describe("Texto para filtrar"),
    })
  ),
  lucaplan_vincular_pago_recurrente: write(
    { title: "Vincular cobro de recurrente" },
    "Usa un movimiento del banco que ya existe como el cobro del período en curso, aunque su fecha caiga fuera; no duplica el gasto. En una recurrente planificada, además le fija el texto bancario para reconocer los siguientes.",
    z.strictObject({
      id: ref("Recurrente"),
      transactionId: ref(
        "Movimiento del banco (de lucaplan_candidatos_pago_recurrente)"
      ),
      ...operation,
    })
  ),

  // --- Cuotas ---
  lucaplan_listar_planes_cuotas: read(
    "Listar planes de cuotas",
    "Úsala para ver todos los planes (card = compra en cuotas con tarjeta; loan = crédito de consumo) con cada cuota, su estado y el movimiento que la pagó. Para uno solo usa lucaplan_ver_plan_cuotas.",
    empty
  ),
  lucaplan_ver_plan_cuotas: read(
    "Ver plan de cuotas",
    "Úsala para el detalle de un plan: cuotas con vencimiento, monto, estado (paid, outside_app, overdue, upcoming), movimiento que la pagó y saldo pendiente sobre lo registrado.",
    z.strictObject({ planId: ref("Plan de cuotas") })
  ),
  lucaplan_crear_plan_cuotas: write(
    { title: "Crear plan de cuotas" },
    "Crea un plan. card: exige la compra origen (sourceTransactionId, cargo confirmado de esa tarjeta), que deja de contar entera y se reparte en cuotas. loan: sin compra origen; las cuotas se enganchan a los pagos del banco. No mueve caja. startIndex = número de la primera cuota que sigue el plan (créditos ya empezados: totalAmount es el saldo restante).",
    z
      .strictObject({
        kind: z
          .enum(["card", "loan"])
          .describe("card = compra en cuotas con tarjeta; loan = crédito"),
        accountId: ref(
          "card: la tarjeta de crédito; loan: la cuenta desde la que se paga"
        ),
        categoryId: ref("Categoría de gasto"),
        description: name.describe("Descripción, p. ej. «Notebook 12 cuotas»"),
        totalAmount: positive.describe(
          money(": capital total, o saldo restante si startIndex > 1")
        ),
        installmentsCount: z
          .number()
          .int()
          .positive()
          .max(MAX_INSTALLMENTS)
          .describe("Número total de cuotas"),
        startDate: date.describe(
          "Vencimiento de la cuota startIndex, YYYY-MM-DD"
        ),
        dayOfMonth: day.describe("Día de vencimiento de cada mes, 1 a 31"),
        tolerancePct: amount
          .min(0)
          .max(100)
          .describe("Solo desempata pagos entre créditos, 0 a 100"),
        startIndex: z
          .number()
          .int()
          .positive()
          .max(MAX_INSTALLMENTS)
          .optional()
          .describe(
            "Primera cuota que sigue el plan; las anteriores quedan pagadas fuera de la app"
          ),
        amounts: z
          .array(positive)
          .max(MAX_INSTALLMENTS)
          .optional()
          .describe(
            "Monto de cada cuota pendiente; omitido = reparto en partes iguales"
          ),
        paidIndexes: z
          .array(z.number().int().positive().max(MAX_INSTALLMENTS))
          .max(MAX_INSTALLMENTS)
          .optional()
          .describe("Números de cuota ya pagados al crear"),
        sourceTransactionId: ref("Compra origen (solo card)")
          .nullable()
          .optional(),
        ...operation,
      })
      .refine(
        (value) =>
          value.kind === "card"
            ? Boolean(value.sourceTransactionId)
            : !value.sourceTransactionId,
        {
          message: "La tarjeta exige compra origen; el préstamo no admite una",
          path: ["sourceTransactionId"],
        }
      )
  ),
  lucaplan_editar_cuota: write(
    { title: "Editar cuota", destructive: true },
    "Edita monto y vencimiento de una cuota. En card la diferencia se redistribuye entre las pendientes para conservar el total; en loan no se editan cuotas ya pagadas.",
    z.strictObject({
      planId: ref("Plan"),
      itemId: ref("Cuota del plan"),
      dueDate: date.describe("Nuevo vencimiento YYYY-MM-DD"),
      amount: positive.describe(money()),
      ...operation,
    })
  ),
  lucaplan_categorizar_plan_cuotas: write(
    { title: "Categorizar plan de cuotas", destructive: true },
    "Cambia la categoría (de gasto) del plan y de todos sus movimientos: cuotas pagadas y compra origen.",
    z.strictObject({
      planId: ref("Plan"),
      categoryId: ref("Categoría de gasto"),
      ...operation,
    })
  ),
  lucaplan_eliminar_plan_cuotas: write(
    { title: "Eliminar plan de cuotas", destructive: true },
    "Elimina el plan. Si es card y ninguna cuota se registró, la compra origen vuelve a contar entera; las cuotas ya registradas no se borran como movimientos. Confirma con el usuario.",
    z.strictObject({ planId: ref("Plan"), ...operation })
  ),
  lucaplan_pagar_cuota: write(
    { title: "Registrar pago de cuota" },
    "CREA el movimiento de pago de una cuota vencida cuando el pago no dejó rastro en la app (se pagó desde otro banco o no llegó el aviso). Si el cargo ya existe, usa lucaplan_vincular_pago_cuota para no contarlo dos veces. No admite cuotas ni fechas futuras.",
    z.strictObject({
      planId: ref("Plan"),
      itemId: ref("Cuota vencida"),
      date: date.describe("Fecha real del pago YYYY-MM-DD, no futura"),
      amount: positive.describe(money(" pagado")),
      ...operation,
    })
  ),
  lucaplan_candidatos_pago_cuota: read(
    "Candidatos de pago de cuota",
    "Úsala antes de lucaplan_vincular_pago_cuota: lista gastos confirmados sin cuota, de ±45 días del vencimiento, ordenados por cercanía. Solo sirven los de la moneda del plan.",
    z.strictObject({
      planId: ref("Plan"),
      itemId: ref("Cuota"),
      accountId: ref(
        "Solo movimientos de esta cuenta; omitido = todas"
      ).optional(),
    })
  ),
  lucaplan_vincular_pago_cuota: write(
    { title: "Vincular pago de cuota" },
    "Asigna a una cuota pendiente un movimiento que ya existe (gasto real, no interno, en la moneda del plan), sin crear otro gasto; el movimiento toma la categoría del plan.",
    z.strictObject({
      planId: ref("Plan"),
      itemId: ref("Cuota pendiente"),
      transactionId: ref(
        "Movimiento existente (de lucaplan_candidatos_pago_cuota)"
      ),
      ...operation,
    })
  ),
  lucaplan_desvincular_pago_cuota: write(
    { title: "Desvincular pago de cuota", destructive: true },
    "Suelta el movimiento de una cuota: la cuota vuelve a pendiente y el movimiento queda como gasto normal. No borra el movimiento.",
    z.strictObject({ planId: ref("Plan"), itemId: ref("Cuota"), ...operation })
  ),
  lucaplan_mover_pago_cuota: write(
    { title: "Mover pago entre cuotas", destructive: true },
    "Corrige un pago que quedó en la cuota equivocada: mueve el movimiento de la cuota origen (planId, itemId) a la cuota destino (toPlanId, toItemId), de este u otro plan, y toma la categoría del plan destino. Sin destino solo lo suelta y queda como gasto normal. La cuota origen vuelve a pendiente y su plan se reabre si estaba cerrado. No crea ni borra movimientos; usa lucaplan_ver_plan_cuotas para ver qué movimiento tiene cada cuota. Solo planes loan. Rechaza un destino ya pagado o un movimiento interno o en otra moneda.",
    z
      .strictObject({
        planId: ref("Plan origen"),
        itemId: ref("Cuota origen, con el pago a mover"),
        toPlanId: ref("Plan destino").optional(),
        toItemId: ref("Cuota destino pendiente").optional(),
        ...operation,
      })
      .refine((value) => !value.toPlanId === !value.toItemId, {
        message: "El destino necesita plan y cuota, o ninguno de los dos",
        path: ["toItemId"],
      })
  ),

  // --- Planificación ---
  lucaplan_planificar_periodo: read(
    "Planificar período",
    "Úsala para planificar un mes actual o futuro: posición de hoy por moneda (caja, sobregiro usado y disponible, deuda y cupo de tarjetas), ingresos esperados vs registrados, recurrentes esperadas vs pagadas, cuotas que vencen, movimientos confirmados con fecha futura y el presupuesto como tope. Los abonos confirmados independientes aumentan el ingreso del período una sola vez; los vinculados a fuentes planificadas no vuelven a sumarse. Separado por moneda y sin doble conteo. Solo lectura: no crea movimientos ni pagos y no cambia saldos. En modo card_cycle devuelve creditCycleCoverage con los ingresos del ciclo anterior que sirven para pagar su factura después del cierre, e indica los pendientes de registro. No atribuyas automáticamente al ciclo actual el sueldo recibido después del cierre anterior; evita duplicar ingresos entre facturaciones. El estado registrado_en_app no prueba recepción bancaria.",
    z.strictObject(period)
  ),

  // --- Configuración ---
  lucaplan_ver_configuracion: read(
    "Ver configuración financiera",
    "Úsala para ver el modo del período (calendar = mes calendario; card_cycle = ciclo de la tarjeta) y los cierres corregidos, el ritmo de gasto, los umbrales de alerta del presupuesto y los días de anticipación del aviso de vencimientos. Es la misma configuración que usan la app, los cálculos y las notificaciones. Solo lectura: hoy es común a toda la instalación, así que se cambia desde Configuración en la app, no desde el chat.",
    empty
  ),
} as const

export type PluginToolName = keyof typeof pluginTools
export type PluginToolInput<N extends PluginToolName> = z.infer<
  (typeof pluginTools)[N]["inputSchema"]
>


