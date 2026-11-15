// cambiarTipoAbono: corrige si un abono es ingreso o reembolso. El ingreso del plan se calcula al
// leer desde `creditKind`, así que basta con reescribirlo y alinear el tope que sigue al ingreso.
import {
  AccountNotFoundError,
  InvalidCreditKindChangeError,
  NotOwnerError,
  type Transaction,
} from "../../domain/finance/finance.domain.ts"
import type { ChangeCreditKindInput } from "../../../../lib/schemas/credit-kind.ts"
import { followIncome, type FollowIncomeDeps, type FollowIncomeSeed } from "./follow-income.ts"

export async function changeCreditKind(
  deps: FollowIncomeDeps,
  userId: string,
  input: ChangeCreditKindInput,
  opts: { today?: string } = {}
): Promise<{ transaction: Transaction; seed: FollowIncomeSeed | null }> {
  const tx = await deps.transactions.findById(input.transactionId)
  if (!tx) throw new AccountNotFoundError(input.transactionId)
  if (tx.userId !== userId) throw new NotOwnerError()
  // Un reverso anula un cargo y un interno no es ingreso ni reembolso: no se reclasifican aquí.
  if (
    tx.direction !== "credit" ||
    tx.isInternal ||
    (tx.creditKind !== "income" && tx.creditKind !== "reimbursement")
  )
    throw new InvalidCreditKindChangeError()
  if (tx.creditKind === input.creditKind) return { transaction: tx, seed: null }
  // Los movimientos los comparten los dos modos del plan: se alinean ambos topes.
  const { result, seed } = await followIncome(
    deps,
    userId,
    () => deps.transactions.setCreditKind(tx.id, input.creditKind),
    { allModes: true, today: opts.today }
  )
  return { transaction: result, seed }
}
