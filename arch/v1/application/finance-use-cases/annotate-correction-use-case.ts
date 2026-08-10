// Follow-up del aprendizaje tras categorizar a mano: guarda la nota "porqué" en la corrección del
// movimiento y/o propaga su categoría a los demás movimientos con el mismo texto normalizado y
// dirección (acción EXPLÍCITA del usuario; nunca automática). Valida ownership.
//
// `applyToSameText` es también la decisión sobre la MEMORIA: al aplicar a los demás, el usuario
// declara que esta categoría es la regla del texto y la corrección se reemplaza. Si dice "solo
// este", la regla vigente queda como estaba (era una excepción) y ni siquiera se le pega la nota,
// que describe la excepción y no la regla.
import {
  AccountNotFoundError,
  NotOwnerError,
  type TransactionRepository,
} from "../../domain/finance/finance.domain.ts"
import {
  normalizeMovementText,
  type CorrectionRepository,
} from "../../domain/finance/categorization-learning.domain.ts"

export async function annotateCorrection(
  deps: {
    transactions: TransactionRepository
    corrections: CorrectionRepository
  },
  userId: string,
  transactionId: string,
  input: { note?: string; applyToSameText?: boolean }
): Promise<{ applied: number }> {
  const tx = await deps.transactions.findById(transactionId)
  if (!tx) throw new AccountNotFoundError(transactionId)
  if (tx.userId !== userId) throw new NotOwnerError()
  // Sin categoría no hay corrección vigente que anotar ni propagar.
  if (!tx.categoryId) return { applied: 0 }
  const normalizedText = normalizeMovementText(tx.description)
  if (!normalizedText) return { applied: 0 }

  const learned = await deps.corrections.findByText(
    userId,
    tx.direction,
    normalizedText
  )
  // Este texto ya tenía otra categoría aprendida y categorizeTransaction no la pisó. Aplicar a los
  // demás es la confirmación de que la regla cambió: recién ahí se reemplaza la corrección.
  const replacesLearned = !!learned && learned.categoryId !== tx.categoryId
  if (input.applyToSameText && replacesLearned)
    await deps.corrections.upsertByText({
      userId,
      direction: tx.direction,
      normalizedText,
      sampleText: tx.description,
      categoryId: tx.categoryId,
    })

  // La nota explica la categoría elegida: no se pega sobre una regla que apunta a otra.
  const note = input.note?.trim()
  if (note && (!replacesLearned || input.applyToSameText))
    await deps.corrections.setNote(userId, tx.direction, normalizedText, note)

  let applied = 0
  if (input.applyToSameText) {
    applied = await deps.corrections.applyCategoryToSameText(
      userId,
      tx.direction,
      normalizedText,
      tx.categoryId,
      tx.id
    )
  }
  return { applied }
}
