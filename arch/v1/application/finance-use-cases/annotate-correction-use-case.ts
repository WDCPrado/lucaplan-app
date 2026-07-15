// Follow-up del aprendizaje tras categorizar a mano: guarda la nota "porqué" en la corrección del
// movimiento y/o propaga su categoría a los demás movimientos con el mismo texto normalizado y
// dirección (acción EXPLÍCITA del usuario; nunca automática). Valida ownership.
import {
  AccountNotFoundError,
  NotOwnerError,
  type TransactionRepository,
} from "../../domain/finance/finance.domain.ts";
import {
  normalizeMovementText,
  type CorrectionRepository,
} from "../../domain/finance/categorization-learning.domain.ts";

export async function annotateCorrection(
  deps: { transactions: TransactionRepository; corrections: CorrectionRepository },
  userId: string,
  transactionId: string,
  input: { note?: string; applyToSameText?: boolean },
): Promise<{ applied: number }> {
  const tx = await deps.transactions.findById(transactionId);
  if (!tx) throw new AccountNotFoundError(transactionId);
  if (tx.userId !== userId) throw new NotOwnerError();
  // Sin categoría no hay corrección vigente que anotar ni propagar.
  if (!tx.categoryId) return { applied: 0 };
  const normalizedText = normalizeMovementText(tx.description);
  if (!normalizedText) return { applied: 0 };

  const note = input.note?.trim();
  if (note) await deps.corrections.setNote(userId, tx.direction, normalizedText, note);

  let applied = 0;
  if (input.applyToSameText) {
    applied = await deps.corrections.applyCategoryToSameText(
      userId,
      tx.direction,
      normalizedText,
      tx.categoryId,
      tx.id,
    );
  }
  return { applied };
}
