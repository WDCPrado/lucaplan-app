// Config del proveedor de IA (OpenAI por ahora). La API key es **server-only**: este módulo solo lo
// importa el adapter, que a su vez solo corre en el servidor (financeDeps → route handlers). No usa
// el import `server-only` de Next a propósito (rompería `node --test`); la key vive en process.env y
// nunca se expone al cliente (no lleva prefijo NEXT_PUBLIC_).
export type OpenAIConfig = { apiKey: string; model: string; baseUrl: string }

export function openaiConfig(): OpenAIConfig {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey)
    throw new Error("Falta OPENAI_API_KEY (server-only). Configúrala en .env")
  return {
    apiKey,
    model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
    // OPENAI_BASE_URL: escape hatch opcional para apuntar a un endpoint compatible (local u otro).
    baseUrl: (
      process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1"
    ).replace(/\/$/, ""),
  }
}

// ¿Hay config de IA en el servidor? Si no, la categorización se omite (degradación elegante).
export const openaiConfigured = (): boolean => !!process.env.OPENAI_API_KEY
