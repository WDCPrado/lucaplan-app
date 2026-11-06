// Config del proveedor de IA (OpenAI por ahora). La API key es **server-only**: este módulo solo lo
// importan los adapters, que solo corren en el servidor (financeDeps → route handlers). No usa el
// import `server-only` de Next a propósito (rompería `node --test`). La key y el modelo salen del
// entorno o de Ajustes → Integraciones (resolveIntegration); nunca llegan al cliente.
import type { IntegrationDeps } from "../../../domain/integrations/integrations.domain.ts"
import { resolveIntegration } from "../../../application/integration-use-cases/resolve-integration-use-case.ts"

export type OpenAIConfig = { apiKey: string; model: string; baseUrl: string }

export async function openaiConfig(deps: IntegrationDeps): Promise<OpenAIConfig> {
  const apiKey = await resolveIntegration(deps, "OPENAI_API_KEY")
  if (!apiKey)
    throw new Error("Falta OPENAI_API_KEY (server-only). Configúrala en .env o en Ajustes")
  return {
    apiKey,
    model: (await resolveIntegration(deps, "OPENAI_MODEL")) ?? "gpt-4o-mini",
    // OPENAI_BASE_URL: escape hatch opcional para apuntar a un endpoint compatible (local u otro).
    baseUrl: (deps.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, ""),
  }
}

// ¿Hay config de IA en el servidor? Si no, la categorización se omite (degradación elegante).
export const openaiConfigured = async (deps: IntegrationDeps): Promise<boolean> =>
  (await resolveIntegration(deps, "OPENAI_API_KEY")) !== null
