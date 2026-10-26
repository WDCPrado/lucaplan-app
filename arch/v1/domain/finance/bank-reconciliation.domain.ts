// Conciliación bancaria: el estado que se concilia, el plan que sale de validarlo, el port que lo
// persiste y las reglas únicas que comparten la conciliación, el aviso por correo y la búsqueda.
// Sin IO ni Prisma: los adapters implementan `BankReconciliationStore`.

export type ReconciliationMovement = {
  id: string
  date: string
  description: string
  amount: number
  currency: string
  direction: string
  categoryId: string | null
  bucketId: string | null
  status: string
  isInternal: boolean
  bankReceivedAt: string | null
  recurringOnly?: boolean
  linked: boolean
  reimbursementAmount: number
  updatedAt: string
}
export type ReconciliationState = {
  accountType: string
  buckets: {
    id: string
    kind: string
    currency: string
    reconciledAt: string | null
  }[]
  movements: ReconciliationMovement[]
  categories: { id: string; type: string }[]
}

/** Lo que el documento bancario fija para un movimiento (corrección o alta). */
type SettledFields = {
  date: string
  description: string
  amount: number
  currency: string
  categoryId: string | null
  evidence: string
}
export type ReconciliationCorrection = {
  before: ReconciliationMovement
  after: ReconciliationMovement &
    SettledFields & { transactionId: string; settleRecurringCharge?: boolean }
}
export type ReconciliationAddition = SettledFields & {
  direction: string
  isInternal: boolean
  bucketId: string
  distinctFrom?: { transactionId: string; evidence: string }[]
}
export type ReconciliationProjectedBucket = {
  id: string
  kind: string
  currency: string
  limit: number
  used: number
  available: number
}
/** Lo que devuelve `planBankReconciliation`: puro, sin escribir nada. */
export type BankReconciliationPlan = {
  corrections: ReconciliationCorrection[]
  additions: ReconciliationAddition[]
  projectedBuckets: ReconciliationProjectedBucket[]
  replayedIds: string[]
  snapshotAt: string
  source: string
}
/** Saldos guardados antes de aplicar: van en la previsualización y en el recibo para auditar. */
export type ReconciliationBucketSnapshot = ReconciliationProjectedBucket & {
  asOf: string | null
}

/** Operaciones dentro de una transacción Serializable con el lock del usuario tomado. */
export interface BankReconciliationTx {
  /** Recibo de una aplicación anterior con ese token, o null. `input` y `result` tal como se guardaron. */
  findReceipt(
    userId: string,
    token: string
  ): Promise<{ input: unknown; result: unknown } | null>
  /**
   * Estado de la cuenta del usuario, o null si no existe o es ajena. `version` es opaco (marcas de
   * actualización de cuenta y buckets) y solo entra al hash del token.
   */
  loadState(
    userId: string,
    accountId: string
  ): Promise<{
    state: ReconciliationState
    version: unknown
    beforeBuckets: ReconciliationBucketSnapshot[]
  } | null>
  /**
   * Escribe el plan completo (correcciones, altas, buckets, saldo de la cuenta) y el recibo con
   * `token`. `input` es el pedido completo y se guarda tal cual en el recibo (se compara con
   * `findReceipt` al reintentar); `source` y `snapshotAt` se leen del plan. Devuelve el resultado
   * guardado en el recibo, que es lo que responde la aplicación.
   */
  apply(
    userId: string,
    input: { accountId: string },
    plan: BankReconciliationPlan & { beforeBuckets: ReconciliationBucketSnapshot[] },
    token: string,
    now: Date
  ): Promise<unknown>
}

export interface BankReconciliationStore {
  /** Lock en memoria + advisory lock por usuario + transacción Serializable. Lanza LockBusyError si está tomado. */
  withUserLock<T>(
    userId: string,
    fn: (tx: BankReconciliationTx) => Promise<T>
  ): Promise<T>
}

/**
 * Regla única: si el movimiento admite que la conciliación le corrija importe o moneda.
 * Hoy implícita en `planBankReconciliation` y copiada distinta en `canCorrectCurrency` de la búsqueda.
 */
export function canReconcileCorrection(
  movement: Pick<
    ReconciliationMovement,
    | "status"
    | "direction"
    | "isInternal"
    | "linked"
    | "recurringOnly"
    | "reimbursementAmount"
  >
): boolean {
  void movement
  throw new Error("no implementado")
}

/** Nombre de comercio comparable: mayúsculas, solo letras y dígitos. */
export function normalizeMerchant(s: string): string {
  void s
  throw new Error("no implementado")
}

/** Lo mínimo de un movimiento (aviso, cartola o registrado) para decidir si es el mismo. Fecha YYYY-MM-DD. */
export type BankMovementKey = {
  date: string
  direction: string
  amount: number
  currency: string
  description: string
}

/**
 * Regla única de «este aviso/cartola es el mismo movimiento». Exige misma dirección y fechas a
 * ≤ `days` días; luego, según `match`:
 * - `"amount"`: mismo importe y moneda (cartola contra registrados).
 * - `"amountOrDescription"`: importe y moneda iguales, o mismo comercio normalizado (candidato a duplicado).
 * - `"amountAndDescription"`: ambos (enlace inequívoco de un aviso con un alta conciliada).
 */
export function isSameBankMovement(
  a: BankMovementKey,
  b: BankMovementKey,
  opts: {
    days: number
    match: "amount" | "amountOrDescription" | "amountAndDescription"
  }
): boolean {
  void a
  void b
  void opts
  throw new Error("no implementado")
}
