export const pendingCategorizationFilter = (userId: string) =>
  ({
    userId,
    categoryId: null,
    status: "confirmed",
    isInternal: false,
    reviewed: false, // la IA no re-procesa lo que el usuario ya decidió dejar sin categoría
    // La categoría de una recurrente o de un plan la manda la plantilla/el plan, nunca la IA.
    recurringTemplateId: null,
    installmentItemId: null,
  }) as const
