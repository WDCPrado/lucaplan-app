// Asignar/cambiar la categoría de un movimiento. Es la ÚNICA edición permitida sobre movimientos
// de cuentas conectadas; también sirve para los manuales. Valida ownership del movimiento
// y de la categoría. No toca el saldo.
//
// Aprendizaje: una asignación no-null registra la corrección del usuario (texto normalizado →
// categoría) SOLO si ese texto todavía no tenía una: una recategorización puntual no puede pisar
// en silencio lo ya aprendido, porque suele ser la excepción y no la regla nueva. Cuando ya había
// otra categoría aprendida se devuelve en `learnedCategoryId` y la memoria queda intacta hasta que
// el usuario lo decida explícitamente en el follow-up (annotateCorrection con applyToSameText).
// Todo el bloque es best-effort: un fallo del aprendizaje nunca bloquea la asignación. Asignar null
// (quitar categoría) no registra ni borra correcciones.
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
import {
  RecurringCategoryRequiredError,
  type RecurringTemplateRepository,
} from "../../domain/finance/recurring.domain.ts"
import {
  InstallmentCategoryRequiredError,
  type InstallmentPlanRepository,
} from "../../domain/finance/installment.domain.ts"

export async function categorizeTransaction(
  deps: {
    transactions: TransactionRepository
    categories: CategoryRepository
    corrections?: CorrectionRepository // opcional: sin repo no hay aprendizaje
    recurring?: RecurringTemplateRepository // opcional: propaga la categoría a la plantilla
    installments?: InstallmentPlanRepository // opcional: propaga la categoría al plan de cuotas
  },
  userId: string,
  transactionId: string,
  categoryId: string | null
): Promise<{
  transaction: Transaction
  sameTextCount: number
  // Categoría que tenía ANTES: de null a una, el movimiento entra al presupuesto (y puede cruzar
  // un umbral de alerta). Lo decide el llamador; aquí no se notifica nada.
  previousCategoryId: string | null
  // Categoría que este texto ya tenía aprendida y que NO se pisó (null si no había o si coincide
  // con la elegida). La UI la usa para avisar que "solo este" deja la regla como estaba.
  learnedCategoryId: string | null
}> {
  const tx = await deps.transactions.findById(transactionId)
  if (!tx) throw new AccountNotFoundError(transactionId)
  if (tx.userId !== userId) throw new NotOwnerError()
  // Un movimiento recurrente no puede quedar sin categoría: la plantilla la exige.
  if (!categoryId && tx.recurringTemplateId)
    throw new RecurringCategoryRequiredError()
  // ¿El movimiento pertenece a un plan de cuotas (como cuota o como compra origen)? Entonces la
  // categoría es del PLAN: recategorizarlo aquí recategoriza el plan y todos sus movimientos.
  const plan = deps.installments
    ? await deps.installments.findByTransaction(transactionId)
    : null
  if (!categoryId && plan) throw new InstallmentCategoryRequiredError()
  if (categoryId) {
    const cat = await deps.categories.findById(categoryId)
    if (!cat) throw new CategoryNotFoundError(categoryId)
    if (cat.userId !== userId) throw new NotOwnerError()
  }
  const transaction = await deps.transactions.setCategory(
    transactionId,
    categoryId
  )

  // La categoría de una recurrente NO se edita en la plantilla: la manda el movimiento. Recategorizar
  // un movimiento vinculado reencauza la plantilla y sus comprometidos aún no cobrados, para que no
  // queden dos verdades. Quitar la categoría (null) no arrastra a la plantilla: seguiría necesitando
  // una, y dejarla sin categoría rompería su invariante.
  if (categoryId && tx.recurringTemplateId && deps.recurring)
    await deps.recurring.setCategory(tx.recurringTemplateId, categoryId)

  // Misma regla para cuotas: el plan y TODOS sus movimientos siguen la nueva categoría (la del
  // propio movimiento ya quedó escrita arriba; el updateMany del repo la reafirma sin conflicto).
  if (categoryId && plan && deps.installments)
    await deps.installments.setCategory(plan.id, categoryId)

  let sameTextCount = 0
  let learnedCategoryId: string | null = null
  if (categoryId && deps.corrections) {
    try {
      const normalizedText = normalizeMovementText(tx.description)
      if (normalizedText) {
        const learned = await deps.corrections.findByText(
          userId,
          tx.direction,
          normalizedText
        )
        // Sin regla previa (o la misma que se eligió): se aprende al toque, como siempre. Con otra
        // regla vigente NO se pisa: el follow-up decide si esto era la excepción o la regla nueva.
        if (!learned || learned.categoryId === categoryId) {
          await deps.corrections.upsertByText({
            userId,
            direction: tx.direction,
            normalizedText,
            sampleText: tx.description,
            categoryId,
          })
        } else {
          learnedCategoryId = learned.categoryId
        }
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
  return {
    transaction,
    sameTextCount,
    previousCategoryId: tx.categoryId,
    learnedCategoryId,
  }
}
