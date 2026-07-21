export const pendingCategorizationFilter = (userId: string) =>
  ({
    userId,
    categoryId: null,
    status: "confirmed",
    isInternal: false,
    reviewed: false, // la IA no re-procesa lo que el usuario ya decidió dejar sin categoría
  }) as const
