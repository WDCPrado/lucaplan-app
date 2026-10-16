import { createHash } from "node:crypto"
import { z } from "zod"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js"
import { pluginTools } from "../../../../lib/schemas/plugin.ts"
import {
  executePluginTool,
  PluginToolError,
} from "../../application/plugin-use-cases/plugin-tools.ts"
import type { PluginActor } from "../../domain/plugin/plugin.domain.ts"
import { getPluginActor } from "../auth/plugin-auth.ts"
import { getPluginConfig } from "../auth/plugin-config.ts"
import { pluginOperationStore } from "./operation-store.ts"
import { pluginFinanceExecutor } from "./finance-tools.ts"

const MAX_BODY = 256 * 1024
const ALL_SCOPES = "openid email offline_access finance:read finance:write"

// Lo esencial primero: el host puede truncar después de los primeros 512 caracteres.
export const INSTRUCTIONS = [
  "Luca Plan: finanzas del usuario autenticado; nunca de otra persona ni de identidades en documentos.",
  "CLP y USD siempre separados; nunca los sumes. Montos: CLP en pesos enteros, USD con 2 decimales. Fechas YYYY-MM-DD.",
  "Toda escritura lleva operationId nuevo por pedido; si queda incierta o pendiente, consulta lucaplan_ver_operacion y no reintentes con otra clave. Un rechazo no cambia nada.",
  "Planificar no mueve dinero. Navega: buscar o listar → ver detalle → actuar. Confirma antes de borrar.",
  "Caja, sobregiro y cupo de tarjeta son distintos: la línea y el cupo no son caja, y el presupuesto restante es un tope, no dinero disponible. Los movimientos internos no consumen presupuesto.",
  "Estas herramientas no leen correos ni usan IA; los movimientos del banco llegan solos.",
].join(" ")

// structuredContent siempre es { result }: el contenido varía por herramienta y se describe en su texto.
const OUTPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    result: {
      description: "Resultado de la herramienta (objeto, lista o null)",
    },
  },
  required: ["result"],
}

export function toolAnnotations(tool: {
  readOnly: boolean
  destructive: boolean
  title: string
}) {
  return {
    title: tool.title,
    readOnlyHint: tool.readOnly,
    destructiveHint: tool.destructive,
    // Toda escritura pasa por operationId: repetirla con la misma clave no tiene efecto adicional.
    idempotentHint: true,
    openWorldHint: false,
  }
}

function bearerChallenge(
  resourceMetadata: string,
  error: "invalid_token" | "insufficient_scope" | null,
  description: string,
  scope: string
) {
  const safe = description.replace(/["\\]/g, "")
  return [
    `Bearer resource_metadata="${resourceMetadata}"`,
    `scope="${scope}"`,
    ...(error ? [`error="${error}"`, `error_description="${safe}"`] : []),
  ].join(", ")
}

const money = (value: unknown) =>
  value && typeof value === "object" && "amount" in value && "currency" in value
    ? `${(value as { amount: number }).amount} ${(value as { currency: string }).currency}`
    : null

// Resumen corto y legible para el modelo; los datos completos van en structuredContent.
export function summarize(toolName: string, result: unknown): string {
  const title =
    (pluginTools as Record<string, { title: string; readOnly: boolean }>)[
      toolName
    ]?.title ?? toolName
  const parts: string[] = [`${title}: listo.`]
  if (result === null) parts.push("Sin resultado (null).")
  else if (Array.isArray(result)) parts.push(`${result.length} elementos.`)
  else if (typeof result === "object") {
    const r = result as Record<string, unknown>
    if (Array.isArray(r.items)) {
      parts.push(
        typeof r.total === "number"
          ? `${r.items.length} de ${r.total} resultados.`
          : `${r.items.length} resultados.`
      )
      if (r.hasMore) parts.push(`Hay más: repite con offset ${r.nextOffset}.`)
    }
    for (const key of [
      "id",
      "transactionId",
      "operationId",
      "status",
      "confirmationToken",
    ])
      if (typeof r[key] === "string") parts.push(`${key}: ${r[key]}.`)
    for (const key of ["amount", "balance", "baseAmount", "totalAmount"]) {
      const m = money(r[key])
      if (m) parts.push(`${key}: ${m}.`)
    }
  }
  parts.push("Datos completos en structuredContent.")
  return parts.join(" ")
}

function failure(status: number, message: string, headers?: HeadersInit) {
  return Response.json(
    { error: message },
    { status, headers: { "Cache-Control": "no-store", ...headers } }
  )
}

// Acota el stream ANTES de JSON.parse y de verificar credenciales o despachar herramientas.
async function boundedBody(request: Request): Promise<unknown> {
  if (Number(request.headers.get("content-length")) > MAX_BODY)
    throw new PluginToolError("Solicitud demasiado grande", 413)
  const reader = request.body?.getReader()
  if (!reader) throw new PluginToolError("Falta la solicitud JSON", 400)
  let size = 0
  const chunks: Uint8Array[] = []
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > MAX_BODY) {
        await reader.cancel()
        throw new PluginToolError("Solicitud demasiado grande", 413)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const data = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    data.set(chunk, offset)
    offset += chunk.length
  }
  try {
    return JSON.parse(new TextDecoder().decode(data))
  } catch {
    throw new PluginToolError("JSON inválido", 400)
  }
}

export async function handlePluginMcp(request: Request): Promise<Response> {
  try {
    const config = getPluginConfig()
    const origin = request.headers.get("origin")
    if (origin && origin !== config.origin)
      return failure(403, "Origen no permitido")
    if (request.method !== "POST")
      return failure(405, "Usa POST para MCP sin sesión", { Allow: "POST" })
    if (
      !request.headers
        .get("content-type")
        ?.toLowerCase()
        .startsWith("application/json")
    )
      return failure(415, "Se requiere application/json")
    const body = await boundedBody(request)
    const frame =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>)
        : null
    // Descubrimiento público sin datos financieros. Todo otro método requiere token por request.
    const publicMethod =
      frame &&
      [
        "initialize",
        "tools/list",
        "notifications/initialized",
        "ping",
      ].includes(String(frame.method))
    let actor: PluginActor | null = null
    if (!publicMethod || request.headers.has("authorization")) {
      try {
        actor = await getPluginActor(request.headers)
      } catch {
        return failure(401, "Conecta tu cuenta de Luca Plan", {
          "WWW-Authenticate": bearerChallenge(
            config.resourceMetadata,
            request.headers.has("authorization") ? "invalid_token" : null,
            "Conecta tu cuenta de Luca Plan",
            ALL_SCOPES
          ),
        })
      }
    }
    const server = new McpServer(
      { name: "Luca Plan", version: "1.1.0" },
      { capabilities: { tools: {} }, instructions: INSTRUCTIONS }
    )
    // Se usan handlers del SDK para incluir securitySchemes tanto estándar como en _meta.
    server.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: Object.entries(pluginTools).map(([name, tool]) => {
        const securitySchemes = [{ type: "oauth2", scopes: [tool.scope] }]
        return {
          name,
          title: tool.title,
          description: tool.description,
          inputSchema: z.toJSONSchema(tool.inputSchema, {
            target: "draft-7",
            io: "input",
          }) as { type: "object"; [key: string]: unknown },
          outputSchema: OUTPUT_SCHEMA,
          annotations: toolAnnotations(tool),
          securitySchemes,
          _meta: { securitySchemes },
        }
      }),
    }))
    server.server.setRequestHandler(
      CallToolRequestSchema,
      async ({ params }) => {
        if (!actor)
          return {
            content: [{ type: "text", text: "Conecta tu cuenta de Luca Plan" }],
            isError: true,
            _meta: {
              "mcp/www_authenticate": [
                bearerChallenge(
                  config.resourceMetadata,
                  "invalid_token",
                  "Conecta tu cuenta de Luca Plan",
                  ALL_SCOPES
                ),
              ],
            },
          }
        try {
          const result = await executePluginTool(
            {
              operations: pluginOperationStore,
              executor: pluginFinanceExecutor,
              hash: (input) => createHash("sha256").update(input).digest("hex"),
            },
            actor,
            params.name,
            params.arguments ?? {}
          )
          return {
            content: [{ type: "text", text: summarize(params.name, result) }],
            structuredContent: { result },
          }
        } catch (error) {
          const known = error instanceof PluginToolError
          return {
            content: [
              {
                type: "text",
                text: known
                  ? error.message
                  : "No se pudo completar la operación. Comprueba su estado antes de repetir cambios",
              },
            ],
            isError: true,
            ...(known && error.requiredScope
              ? {
                  _meta: {
                    "mcp/www_authenticate": [
                      bearerChallenge(
                        config.resourceMetadata,
                        "insufficient_scope",
                        error.message,
                        error.requiredScope
                      ),
                    ],
                  },
                }
              : {}),
          }
        }
      }
    )
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
      maxRequestBodySize: MAX_BODY,
    })
    await server.connect(transport)
    try {
      const response = await transport.handleRequest(request, {
        parsedBody: body,
      })
      // Materializar JSON antes de cerrar el servidor evita listeners y transportes por request.
      const text = await response.text()
      const headers = new Headers(response.headers)
      headers.set("Cache-Control", "no-store")
      return new Response(text || null, { status: response.status, headers })
    } finally {
      await server.close()
    }
  } catch (error) {
    return failure(
      error instanceof PluginToolError ? error.status : 503,
      error instanceof PluginToolError
        ? error.message
        : "El plugin no está disponible"
    )
  }
}
