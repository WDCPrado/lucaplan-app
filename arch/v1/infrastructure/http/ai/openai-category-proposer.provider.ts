// Propone el set de categorías del onboarding con OpenAI (Chat Completions, Structured Outputs).
// Implementa el port `CategoryProposer`: devuelve el JSON crudo y el use-case lo valida; ante
// cualquier fallo (red, timeout, status, JSON inválido) lanza y el use-case cae al set precreado.
// La descripción del día a día viaja en el request y no se guarda en ninguna parte.
import {
  CATEGORY_COLOR_VALUES,
  CATEGORY_ICON_NAMES,
  type CategoryProposer,
} from "../../../domain/onboarding/onboarding.domain.ts"
import { CATEGORY_TYPES } from "../../../domain/finance/finance.domain.ts"
import { openaiConfig } from "./openai-config.ts"

const TIMEOUT_MS = 30_000
const MAX_TOKENS = 3_000

const SYSTEM =
  "Ajustas el set inicial de categorías de una app chilena de finanzas personales según lo que la " +
  "persona cuenta de su día a día. Recibes el set precreado y su descripción. Devuelve el set " +
  "completo ajustado: conserva las que sirven tal cual (change \"kept\", reason null), edita las que " +
  "conviene afinar (change \"edited\"; por ejemplo, la descripción con los comercios que mencionó) y " +
  "agrega las que falten por lo que contó (change \"added\"). Puedes quitar una precreada solo si " +
  "claramente no aplica. Cada reason es una frase corta en español que se dirige a la persona (ej. " +
  "«Mencionaste que vas al gimnasio»), máximo 160 caracteres.\n" +
  "La description de cada categoría NO es decorativa: es el contexto que usa otro modelo para " +
  "categorizar movimientos, así que nombra comercios chilenos tal como aparecen en la glosa del " +
  "banco o la tarjeta (Líder, Jumbo, Copec, Cruz Verde, Uber, Netflix, Smart Fit…), máximo 400 " +
  "caracteres. Nunca crees una categoría «Otros», «Varios» ni un cajón genérico: lo que no encaja " +
  "se queda sin categoría. Nombres cortos (máximo 40 caracteres) y sin repetir. Mantén entre 6 y 20 " +
  "categorías. Usa solo iconos y colores de la lista permitida."

const nullableString = (description: string) => ({ type: ["string", "null"], description })

const SCHEMA = {
  name: "categorias",
  strict: true,
  schema: {
    type: "object",
    properties: {
      categories: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Nombre corto de la categoría" },
            type: { type: "string", enum: [...CATEGORY_TYPES] },
            icon: { type: "string", enum: [...CATEGORY_ICON_NAMES] },
            color: { type: "string", enum: [...CATEGORY_COLOR_VALUES] },
            description: nullableString("Comercios chilenos reconocibles en la glosa bancaria"),
            change: { type: "string", enum: ["kept", "edited", "added"] },
            reason: nullableString("Por qué la editaste o agregaste; null si la conservaste"),
          },
          required: ["name", "type", "icon", "color", "description", "change", "reason"],
          additionalProperties: false,
        },
      },
    },
    required: ["categories"],
    additionalProperties: false,
  },
}

export const openaiCategoryProposer: CategoryProposer = {
  async propose({ description, base }) {
    const cfg = openaiConfig()
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0.2,
        max_completion_tokens: MAX_TOKENS,
        response_format: { type: "json_schema", json_schema: SCHEMA },
        messages: [
          { role: "system", content: SYSTEM },
          {
            role: "user",
            content: JSON.stringify({ setPrecreado: base, diaADia: description }),
          },
        ],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) throw new Error(`OpenAI ${res.status}`)
    const data = await res.json()
    const content = data?.choices?.[0]?.message?.content
    if (typeof content !== "string") throw new Error("OpenAI sin contenido")
    return JSON.parse(content)
  },
}
