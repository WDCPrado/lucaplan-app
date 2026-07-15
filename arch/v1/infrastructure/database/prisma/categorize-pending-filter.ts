export const pendingCategorizationFilter = (userId: string) =>
  ({
    userId,
    categoryId: null,
    status: "confirmed",
    isInternal: false,
  }) as const
