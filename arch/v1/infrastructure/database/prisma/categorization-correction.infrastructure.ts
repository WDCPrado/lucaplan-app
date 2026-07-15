// Adapter Postgres del aprendizaje de categorización. Implementa `CorrectionRepository`.
// El matching por "mismo texto" usa la MISMA normalización del dominio aplicada en memoria
// sobre las descripciones del usuario (no replicable en SQL).
// ponytail: normaliza en memoria (miles de filas máx.); columna normalizada indexada si crece.
import { prisma } from "./client.ts";
import type { Direction } from "../../../domain/finance/finance.domain.ts";
import {
  normalizeMovementText,
  type CategorizationCorrection,
  type CorrectionInput,
  type CorrectionRepository,
} from "../../../domain/finance/categorization-learning.domain.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toCorrection(row: any): CategorizationCorrection {
  return {
    id: row.id,
    userId: row.userId,
    direction: row.direction as Direction,
    normalizedText: row.normalizedText,
    sampleText: row.sampleText,
    categoryId: row.categoryId,
    note: row.note ?? null,
  };
}

// Movimientos del usuario que participan en el matching por texto: mismos filtros para contar y
// para aplicar (excluye el movimiento origen y los estados que no cuentan).
function sameTextWhere(userId: string, direction: Direction, excludeId: string) {
  return {
    userId,
    direction,
    id: { not: excludeId },
    status: { notIn: ["reversed", "duplicated"] },
  };
}

export const correctionRepository: CorrectionRepository = {
  async upsertByText(input: CorrectionInput): Promise<CategorizationCorrection> {
    const key = {
      userId: input.userId,
      direction: input.direction,
      normalizedText: input.normalizedText,
    };
    const row = await prisma.categorizationCorrection.upsert({
      where: { userId_direction_normalizedText: key },
      create: { ...key, sampleText: input.sampleText, categoryId: input.categoryId, note: input.note ?? null },
      update: {
        sampleText: input.sampleText,
        categoryId: input.categoryId,
        // undefined = registro automático: conserva la nota existente.
        ...(input.note !== undefined ? { note: input.note } : {}),
      },
    });
    return toCorrection(row);
  },

  async listByUserDirection(userId: string, direction: Direction): Promise<CategorizationCorrection[]> {
    const rows = await prisma.categorizationCorrection.findMany({
      where: { userId, direction },
      orderBy: { updatedAt: "desc" },
    });
    return rows.map(toCorrection);
  },

  async setNote(userId: string, direction: Direction, normalizedText: string, note: string): Promise<void> {
    await prisma.categorizationCorrection.updateMany({
      where: { userId, direction, normalizedText },
      data: { note },
    });
  },

  async countSameText(
    userId: string,
    direction: Direction,
    normalizedText: string,
    excludeId: string,
    categoryId: string,
  ): Promise<number> {
    const rows = await prisma.transaction.findMany({
      where: { ...sameTextWhere(userId, direction, excludeId), NOT: { categoryId } },
      select: { description: true },
    });
    return rows.filter((r) => normalizeMovementText(r.description) === normalizedText).length;
  },

  async applyCategoryToSameText(
    userId: string,
    direction: Direction,
    normalizedText: string,
    categoryId: string,
    excludeId: string,
  ): Promise<number> {
    const rows = await prisma.transaction.findMany({
      where: { ...sameTextWhere(userId, direction, excludeId), NOT: { categoryId } },
      select: { id: true, description: true },
    });
    const ids = rows.filter((r) => normalizeMovementText(r.description) === normalizedText).map((r) => r.id);
    if (ids.length === 0) return 0;
    // Solo cambia la categoría: nunca toca saldos (mismo contrato que setCategory).
    const res = await prisma.transaction.updateMany({ where: { id: { in: ids } }, data: { categoryId } });
    return res.count;
  },
};
