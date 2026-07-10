// Categoriza con IA los movimientos SIN categoría. Impone la **regla de lado en el servidor**:
// agrupa por dirección y solo ofrece a la IA categorías del mismo tipo (income↔credit,
// expense↔debit); valida que el id devuelto pertenezca al conjunto permitido antes de persistir.
// Un id inválido/ausente deja el movimiento sin categoría (nunca cruza ingreso/gasto). Best-effort:
// el provider ya devuelve {} ante fallos; aquí no re-categorizamos lo que ya tiene categoría.
import {
  categoryTypeForDirection,
  type CategoryRepository,
  type Direction,
  type Transaction,
  type TransactionRepository,
} from "../../domain/finance/finance.domain.ts";
import type { CategorizationProvider } from "../../domain/finance/categorization.port.ts";

const CHUNK = 100; // movimientos por llamada (claves cortas ⇒ salida chica aunque el lote sea grande)
const CONCURRENCY = 5; // lotes en paralelo (baja el tiempo de la 1ª conexión sin pegarle al rate limit)
const SIDES: Direction[] = ["debit", "credit"];

export type CategorizeDeps = {
  transactions: TransactionRepository;
  categories: CategoryRepository;
  categorization: CategorizationProvider;
};

// Categoriza un lote: pide al proveedor y persiste los ids válidos. Best-effort: un fallo del
// proveedor deja el lote sin categoría (0). Devuelve cuántos asignó.
async function categorizeChunk(
  deps: CategorizeDeps,
  chunk: Transaction[],
  candidates: { id: string; name: string; type: "income" | "expense"; description: string | null }[],
  allowed: Set<string>,
): Promise<number> {
  let result: Record<string, string | null> = {};
  try {
    result = await deps.categorization.categorize({
      movements: chunk.map((m) => ({ id: m.id, description: m.description, amount: m.amount.toMajor(), direction: m.direction })),
      categories: candidates,
    });
  } catch {
    return 0;
  }
  let n = 0;
  for (const m of chunk) {
    const chosen = result[m.id];
    if (chosen && allowed.has(chosen)) {
      await deps.transactions.setCategory(m.id, chosen);
      n++;
    }
  }
  return n;
}

// Recibe los movimientos recién importados; categoriza solo los que siguen sin categoría. Devuelve
// cuántos asignó. Procesa los lotes en olas de CONCURRENCY para acelerar la primera conexión.
export async function categorizeMovements(deps: CategorizeDeps, userId: string, movements: Transaction[]): Promise<number> {
  const pending = movements.filter((m) => m.categoryId === null && m.status !== "reversed" && m.status !== "duplicated");
  if (pending.length === 0) return 0;

  const cats = await deps.categories.listByUser(userId);
  let assigned = 0;

  for (const dir of SIDES) {
    const catsForSide = cats.filter((c) => c.type === categoryTypeForDirection(dir));
    const group = pending.filter((m) => m.direction === dir);
    if (catsForSide.length === 0 || group.length === 0) continue;
    const candidates = catsForSide.map((c) => ({ id: c.id, name: c.name, type: c.type, description: c.description }));
    const allowed = new Set(catsForSide.map((c) => c.id));

    const chunks: Transaction[][] = [];
    for (let i = 0; i < group.length; i += CHUNK) chunks.push(group.slice(i, i + CHUNK));

    for (let i = 0; i < chunks.length; i += CONCURRENCY) {
      const wave = chunks.slice(i, i + CONCURRENCY);
      const counts = await Promise.all(wave.map((chunk) => categorizeChunk(deps, chunk, candidates, allowed)));
      assigned += counts.reduce((s, n) => s + n, 0);
    }
  }
  return assigned;
}
