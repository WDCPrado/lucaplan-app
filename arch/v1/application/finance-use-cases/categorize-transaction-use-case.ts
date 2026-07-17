// Asignar/cambiar la categoría de un movimiento. Es la ÚNICA edición permitida sobre movimientos
// de cuentas conectadas (fintoc); también sirve para los manuales. Valida ownership del movimiento
// y de la categoría. No toca el saldo.
//
// Aprendizaje: toda asignación no-null registra/actualiza la corrección del usuario (texto
// normalizado → categoría) de forma best-effort (un fallo del registro nunca bloquea la
// asignación) y devuelve cuántos otros movimientos con el mismo texto cambiarían al propagar.
// Asignar null (quitar categoría) no registra ni borra correcciones.
import {
  AccountNotFoundError,
  NotOwnerError,
  CategoryNotFoundError,
  type CategoryRepository,
  type TransactionRepository,
  type Transaction,
} from "../../domain/finance/finance.domain.ts"
import {
  normalizeMovementText,
  type CorrectionRepository,
} from "../../domain/finance/categorization-learning.domain.ts"

export async function categorizeTransaction(
  deps: {
    transactions: TransactionRepository
    categories: CategoryRepository
    corrections?: CorrectionRepository // opcional: sin repo no hay aprendizaje
  },
  userId: string,
  transactionId: string,
  categoryId: string | null
): Promise<{ transaction: Transaction; sameTextCount: number }> {
  const tx = await deps.transactions.findById(transactionId)
  if (!tx) throw new AccountNotFoundError(transactionId)
  if (tx.userId !== userId) throw new NotOwnerError()
  if (categoryId) {
    const cat = await deps.categories.findById(categoryId)
    if (!cat) throw new CategoryNotFoundError(categoryId)
    if (cat.userId !== userId) throw new NotOwnerError()
  }
  const transaction = await deps.transactions.setCategory(
    transactionId,
    categoryId
  )

  let sameTextCount = 0
  if (categoryId && deps.corrections) {
    try {
      const normalizedText = normalizeMovementText(tx.description)
      if (normalizedText) {
        await deps.corrections.upsertByText({
          userId,
          direction: tx.direction,
          normalizedText,
          sampleText: tx.description,
          categoryId,
        })
        sameTextCount = await deps.corrections.countSameText(
          userId,
          tx.direction,
          normalizedText,
          tx.id,
          categoryId
        )
      }
    } catch {
      // best-effort: la categoría ya quedó asignada; el aprendizaje no bloquea la operación
    }
  }
  return { transaction, sameTextCount }
}
