// Ciclo de vida de una cuenta MANUAL: editar sus datos visibles y eliminarla. Las cuentas
// conectadas por correo nunca pasan por aquí: sus datos los fija el banco y su baja es
// desconectar el correo. Puro: tipos, port, errores y el cálculo del impacto de borrar.
import type { AccountType } from "./finance.domain.ts"
import type { CurrencyCode } from "./money.ts"

export type ManualAccountUpdate = {
  name: string
  color: string | null
  cardLast4: string | null
  overdraftLimit: number
}

// Foto de todo lo que borrar la cuenta toca, leída en una sola consulta. Es la base del impacto
// que ve la persona y del hash que liga la confirmación a este estado exacto.
export type ManualAccountSnapshot = {
  account: {
    id: string
    name: string
    accountType: AccountType
    currency: CurrencyCode
    provider: string
    balance: number
    bankId: string
    bankName: string
    bankIsManual: boolean // banco manual y sin conexión de correo
  }
  otherAccountsInBank: number
  buckets: number
  cards: number
  // Movimientos de ESTA cuenta, con a qué apuntan y de qué cuenta es lo apuntado.
  transactions: {
    id: string
    status: string
    recurringTemplateId: string | null
    recurringAccountId: string | null
    installmentItemId: string | null
    installmentPlanId: string | null
    installmentPlanAccountId: string | null
    incomeId: string | null
    incomeAccountId: string | null
    sourceOfPlanId: string | null // compra origen neutralizada de un plan de cuotas
    sourceOfPlanAccountId: string | null
  }[]
  incomes: { id: string; name: string }[]
  recurring: { id: string; label: string }[]
  plans: { id: string; description: string; kind: string }[]
  // Movimientos de OTRAS cuentas que apuntan a ingresos, recurrentes o planes de ESTA cuenta.
  foreignTransactions: {
    id: string
    accountId: string
    accountName: string
    recurringTemplateId: string | null
    installmentItemId: string | null
    installmentPlanId: string | null
    incomeId: string | null
  }[]
}

export type CrossLink = {
  transactionId: string
  kind: "cuota" | "recurrente" | "ingreso" | "compra_origen"
  targetId: string // plan, plantilla o fuente apuntada
  otherAccountId: string // la cuenta que NO se borra
  effect: string
}

export type AccountDeletionImpact = {
  account: ManualAccountSnapshot["account"]
  deletes: {
    transactions: number
    pendingTransactions: number
    buckets: number
    cards: number
    incomes: { id: string; name: string }[]
    recurring: { id: string; label: string }[]
    installmentPlans: { id: string; description: string; kind: string }[]
    bank: boolean
  }
  // Movimientos de otras cuentas que hoy dependen de algo de esta cuenta: sobreviven, sin vínculo.
  fromOtherAccounts: (CrossLink & { accountName: string })[]
  // Movimientos de esta cuenta que hoy pagan algo de otra cuenta: se borran y eso queda pendiente.
  toOtherAccounts: CrossLink[]
  // Planes de OTRAS cuentas que se reabren porque pierden el pago de una cuota.
  plansToReopen: string[]
}

export function accountDeletionImpact(
  s: ManualAccountSnapshot
): AccountDeletionImpact {
  const own = s.account.id
  const toOtherAccounts: CrossLink[] = []
  for (const t of s.transactions) {
    if (t.installmentItemId && t.installmentPlanAccountId && t.installmentPlanAccountId !== own)
      toOtherAccounts.push({
        transactionId: t.id,
        kind: "cuota",
        targetId: t.installmentPlanId ?? t.installmentItemId,
        otherAccountId: t.installmentPlanAccountId,
        effect: "La cuota de ese plan vuelve a quedar pendiente",
      })
    if (t.recurringTemplateId && t.recurringAccountId && t.recurringAccountId !== own)
      toOtherAccounts.push({
        transactionId: t.id,
        kind: "recurrente",
        targetId: t.recurringTemplateId,
        otherAccountId: t.recurringAccountId,
        effect: "Ese período de la recurrente vuelve a quedar sin cobro",
      })
    if (t.incomeId && t.incomeAccountId && t.incomeAccountId !== own)
      toOtherAccounts.push({
        transactionId: t.id,
        kind: "ingreso",
        targetId: t.incomeId,
        otherAccountId: t.incomeAccountId,
        effect: "Ese mes del ingreso vuelve a quedar sin registrar",
      })
    if (t.sourceOfPlanId && t.sourceOfPlanAccountId && t.sourceOfPlanAccountId !== own)
      toOtherAccounts.push({
        transactionId: t.id,
        kind: "compra_origen",
        targetId: t.sourceOfPlanId,
        otherAccountId: t.sourceOfPlanAccountId,
        effect: "El plan pierde su compra de origen; sus cuotas no cambian",
      })
  }
  const fromOtherAccounts = s.foreignTransactions.map((t) => {
    const base = { transactionId: t.id, otherAccountId: t.accountId, accountName: t.accountName }
    if (t.installmentItemId)
      return {
        ...base,
        kind: "cuota" as const,
        targetId: t.installmentPlanId ?? t.installmentItemId,
        effect: "El pago queda como gasto normal, con su categoría actual",
      }
    if (t.recurringTemplateId)
      return {
        ...base,
        kind: "recurrente" as const,
        targetId: t.recurringTemplateId,
        effect: "El cobro queda como movimiento normal, sin recurrente",
      }
    return {
      ...base,
      kind: "ingreso" as const,
      targetId: t.incomeId ?? "",
      effect: "El movimiento queda sin fuente de ingreso",
    }
  })
  return {
    account: s.account,
    deletes: {
      transactions: s.transactions.length,
      pendingTransactions: s.transactions.filter((t) => t.status !== "confirmed").length,
      buckets: s.buckets,
      cards: s.cards,
      incomes: s.incomes,
      recurring: s.recurring,
      installmentPlans: s.plans,
      bank: s.account.bankIsManual && s.otherAccountsInBank === 0,
    },
    fromOtherAccounts,
    toOtherAccounts,
    plansToReopen: [
      ...new Set(
        toOtherAccounts.filter((l) => l.kind === "cuota").map((l) => l.targetId)
      ),
    ],
  }
}

export interface ManualAccountRepository {
  update(accountId: string, input: ManualAccountUpdate): Promise<void>
  /** Foto del estado de la cuenta del usuario; null si no existe o no es suya. */
  snapshot(userId: string, accountId: string): Promise<ManualAccountSnapshot | null>
  /**
   * En UNA transacción: vuelve a leer la foto, se la pasa a `check` (que lanza para abortar sin
   * escribir), reabre los planes de otras cuentas que pierden un pago, borra la cuenta —la
   * cascada de la BD se lleva movimientos, buckets, tarjetas, ingresos, recurrentes y planes— y
   * el banco manual si queda vacío. Devuelve lo que `check` devolvió.
   */
  deleteChecked(
    userId: string,
    accountId: string,
    check: (snapshot: ManualAccountSnapshot | null) => AccountDeletionImpact
  ): Promise<AccountDeletionImpact>
}

// Datos inválidos para una cuenta manual (→ 422).
export class InvalidManualAccountError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "InvalidManualAccountError"
  }
}

// La confirmación no corresponde al estado actual de la cuenta: cambió, venció o es de otra
// cuenta (→ 409). Se vuelve a previsualizar.
export class StaleAccountDeletionError extends Error {
  constructor(
    message = "La cuenta cambió o la confirmación venció desde la previsualización. Vuelve a previsualizar la eliminación y confirma con el nuevo token"
  ) {
    super(message)
    this.name = "StaleAccountDeletionError"
  }
}
