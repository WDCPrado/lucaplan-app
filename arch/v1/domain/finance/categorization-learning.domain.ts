// Aprendizaje de categorización: memoria de correcciones del usuario. Cuando asigna una categoría
// a mano se registra una corrección (texto normalizado → categoría + nota "porqué"); el
// categorizador recupera las correcciones exactas y parecidas y las inyecta como contexto de la IA.
// Puro: tipos + port + normalización/matching. La normalización es COMPARTIDA entre registro,
// propagación y retrieval — si no usan la misma función, el match exacto se rompe en silencio.
// No entra en ningún cálculo financiero.
import type { Direction } from "./finance.domain.ts"

export type CategorizationCorrection = {
  id: string
  userId: string
  direction: Direction // el mismo texto puede ser débito (compra) y crédito (reembolso)
  normalizedText: string
  sampleText: string // descripción original de ejemplo (para UI y prompt)
  categoryId: string
  note: string | null // el "porqué": qué es este movimiento en la vida del usuario
}

export type CorrectionInput = {
  userId: string
  direction: Direction
  normalizedText: string
  sampleText: string
  categoryId: string
  note?: string | null // undefined = conservar la nota existente (registro automático)
}

export interface CorrectionRepository {
  // Upsert por (userId, direction, normalizedText): la última corrección del mismo texto gana.
  upsertByText(input: CorrectionInput): Promise<CategorizationCorrection>
  listByUserDirection(
    userId: string,
    direction: Direction
  ): Promise<CategorizationCorrection[]>
  // Nota "porqué" de la corrección vigente de ese texto (no crea si no existe).
  setNote(
    userId: string,
    direction: Direction,
    normalizedText: string,
    note: string
  ): Promise<void>
  // Movimientos del usuario con el mismo texto normalizado y dirección que aún NO tienen
  // `categoryId` (excluye `excludeId` y los reversed/duplicated): los que cambiarían al propagar.
  countSameText(
    userId: string,
    direction: Direction,
    normalizedText: string,
    excludeId: string,
    categoryId: string
  ): Promise<number>
  // Aplica la categoría a esos mismos movimientos. Devuelve cuántos cambió. No toca saldos.
  applyCategoryToSameText(
    userId: string,
    direction: Direction,
    normalizedText: string,
    categoryId: string,
    excludeId: string
  ): Promise<number>
}

// Normalización determinista de la descripción de un movimiento: deja solo lo distintivo del
// comercio, quitando lo que VARÍA entre operaciones del mismo comercio. Así "MERPAGO*CABIFY262" y
// "MERPAGO*CABIFY2627VUV4X00" (mismo Cabify, distinto código de pasarela) normalizan igual y se
// agrupan. Pasos: mayúsculas sin tildes → puntuación a espacio (`*`, `:`, `°`, `$`, …) → recorta el
// código pegado a un comercio (letra+dígitos: "CABIFY2627…" → "CABIFY") → quita tokens que empiezan
// con dígito (montos, fechas, horas, ids, últimos 4). ⚠ Cambiarla invalida las correcciones ya
// guardadas (su `normalizedText` quedó con la forma anterior): re-normalizar con scripts/renormalize-corrections.
export function normalizeMovementText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\b([A-Z]{2,})\d[A-Z0-9]*/g, "$1")
    .replace(/\b\d[A-Z0-9]*\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

// Tokens significativos (≥3 caracteres alfanuméricos) de un texto normalizado.
export function correctionTokens(normalized: string): Set<string> {
  return new Set(normalized.split(/[^A-Z0-9]+/).filter((t) => t.length >= 3))
}

// Coeficiente de Dice entre dos conjuntos de tokens (0..1).
export function diceSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let inter = 0
  for (const t of a) if (b.has(t)) inter++
  return (2 * inter) / (a.size + b.size)
}

export const SIMILARITY_THRESHOLD = 0.5 // ponytail: umbral fijo; calibrar con datos reales
export const MAX_CORRECTIONS_PER_PROMPT = 30 // tope: el prompt no crece sin límite

// Selección para un lote: correcciones con texto EXACTO a algún movimiento siempre entran
// (primero); las parecidas entran por score descendente sobre el umbral. Tope total `max`.
export function selectCorrectionsForBatch(
  movementTexts: string[],
  corrections: CategorizationCorrection[],
  max = MAX_CORRECTIONS_PER_PROMPT
): CategorizationCorrection[] {
  const normalized = movementTexts.map(normalizeMovementText)
  const exactSet = new Set(normalized)
  const movTokens = normalized.map(correctionTokens)
  const exact: CategorizationCorrection[] = []
  const similar: { c: CategorizationCorrection; score: number }[] = []
  for (const c of corrections) {
    if (exactSet.has(c.normalizedText)) {
      exact.push(c)
      continue
    }
    const tokens = correctionTokens(c.normalizedText)
    let best = 0
    for (const mt of movTokens) {
      const s = diceSimilarity(tokens, mt)
      if (s > best) best = s
    }
    if (best >= SIMILARITY_THRESHOLD) similar.push({ c, score: best })
  }
  similar.sort((a, b) => b.score - a.score)
  return [...exact, ...similar.map((s) => s.c)].slice(0, max)
}
