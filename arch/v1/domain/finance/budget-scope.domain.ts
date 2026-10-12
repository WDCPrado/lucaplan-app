/** El plan solo incluye categorías de gasto con un tope efectivo mayor que cero. */
export function isBudgetedExpenseCategory(category: {
  type: string
  limit: number
}): boolean {
  return category.type === "expense" && category.limit > 0
}
