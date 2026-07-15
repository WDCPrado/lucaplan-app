// Port de categorización con IA (lo implementa un adapter en infraestructura, p.ej. OpenAI). El
// dominio solo define el contrato: dado un conjunto de movimientos y un conjunto de categorías
// candidatas (ya filtradas por lado por el caso de uso), devuelve, por cada movimiento, el id de la
// categoría elegida o null. No conoce HTTP, prompts ni proveedores. Es best-effort: un fallo se
// traduce en "sin categoría", nunca en excepción hacia el caso de uso.

import type { CategoryType, Direction } from "./finance.domain.ts";

export type CategorizationMovement = {
  id: string; // id interno del movimiento (para mapear el resultado)
  description: string;
  amount: number; // monto en unidad mayor, positivo
  direction: Direction;
};

export type CategorizationCategory = {
  id: string;
  name: string;
  type: CategoryType;
  description: string | null; // contexto para desambiguar
};

// Corrección previa del usuario, ya filtrada como relevante para el lote por el caso de uso.
// Texto exacto ⇒ el proveedor instruye usar esa categoría; parecido ⇒ pista fuerte.
export type CategorizationCorrectionHint = {
  text: string; // descripción de ejemplo tal como la corrigió el usuario
  note: string | null; // el "porqué" del usuario (qué es el movimiento)
  categoryId: string;
};

export interface CategorizationProvider {
  // Devuelve un mapa { movimientoId → categoryId | null }. Los movimientos ausentes o con null
  // quedan sin categoría. Ante cualquier fallo/no-configuración, devuelve un mapa vacío.
  categorize(input: {
    movements: CategorizationMovement[];
    categories: CategorizationCategory[];
    corrections?: CategorizationCorrectionHint[];
  }): Promise<Record<string, string | null>>;
}
