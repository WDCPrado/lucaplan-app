// Adapter de categorización con IA usando la API de OpenAI (Chat Completions). Implementa el port
// `CategorizationProvider`. Best-effort: ante cualquier fallo (no configurado, red, timeout, JSON
// inválido) devuelve un mapa vacío ⇒ los movimientos quedan sin categoría, sin lanzar.
//
// Clave de rendimiento: al modelo se le dan **claves cortas** (c0..cN para categorías, m0..mN para
// movimientos) y se le pide echar solo esas claves. Así la respuesta es diminuta (no repite UUIDs de
// 36 chars por ítem), lo que baja latencia y costo drásticamente. Luego se mapea de vuelta a los ids
// reales y se valida contra el conjunto permitido (el caso de uso ya filtró por lado).
import type {
  CategorizationCategory,
  CategorizationMovement,
  CategorizationProvider,
} from "../../../domain/finance/categorization.port.ts";
import { openaiConfig, openaiConfigured } from "./openai-config.ts";

const TIMEOUT_MS = 45_000;

const SYSTEM =
  "Eres un clasificador de movimientos bancarios chilenos. Recibes categorías (con clave, nombre y " +
  "descripción) y movimientos (con clave y descripción). Lee con atención las descripciones de las " +
  "categorías: incluyen ejemplos concretos de comercios y reglas (a veces dicen qué NO incluir). Asigna " +
  "a cada movimiento la categoría cuya descripción mejor lo cubra. Sé decidido: usa null SOLO si de " +
  "verdad ninguna categoría aplica (p.ej. transferencias entre personas sin contexto). Usa SOLO las " +
  'claves de categoría provistas (c0, c1, ...). Responde ÚNICAMENTE un JSON: ' +
  '{"asignaciones":[{"m":"m0","c":"c1"}]} donde "c" es la clave de la categoría o null.';

function buildUserPrompt(movements: CategorizationMovement[], categories: CategorizationCategory[]): string {
  const cats = categories.map((c, i) => ({ clave: `c${i}`, nombre: c.name, descripcion: c.description ?? "" }));
  const movs = movements.map((m, i) => ({ clave: `m${i}`, descripcion: m.description }));
  return `CATEGORÍAS:\n${JSON.stringify(cats)}\n\nMOVIMIENTOS:\n${JSON.stringify(movs)}`;
}

// Parsea el content (JSON) → mapa { claveMovimiento → claveCategoría | null }. Tolera "null"/""
// como null y formas inesperadas → {}.
function parseAssignments(content: unknown): Record<string, string | null> {
  if (typeof content !== "string") return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return {};
  }
  const list = (parsed as { asignaciones?: unknown })?.asignaciones ?? (parsed as { assignments?: unknown })?.assignments;
  if (!Array.isArray(list)) return {};
  const out: Record<string, string | null> = {};
  for (const item of list) {
    const m = (item as { m?: unknown })?.m;
    const c = (item as { c?: unknown })?.c;
    if (typeof m !== "string") continue;
    out[m] = typeof c === "string" && c !== "null" && c !== "" ? c : null;
  }
  return out;
}

export const openaiCategorizationProvider: CategorizationProvider = {
  async categorize({ movements, categories }) {
    if (!openaiConfigured() || movements.length === 0 || categories.length === 0) return {};
    const cfg = openaiConfig();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}` },
        body: JSON.stringify({
          model: cfg.model,
          temperature: 0,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: SYSTEM },
            { role: "user", content: buildUserPrompt(movements, categories) },
          ],
        }),
        signal: controller.signal,
      });
      if (!res.ok) return {};
      const data = await res.json();
      const byKey = parseAssignments(data?.choices?.[0]?.message?.content);
      // Mapea claves cortas → ids reales; valida que la clave de categoría exista (índice válido).
      const out: Record<string, string | null> = {};
      for (let i = 0; i < movements.length; i++) {
        const chosen = byKey[`m${i}`];
        const idx = chosen && chosen.startsWith("c") ? Number(chosen.slice(1)) : NaN;
        out[movements[i].id] = Number.isInteger(idx) && idx >= 0 && idx < categories.length ? categories[idx].id : null;
      }
      return out;
    } catch {
      return {}; // red, timeout/abort, JSON inválido → sin categoría
    } finally {
      clearTimeout(timer);
    }
  },
};
