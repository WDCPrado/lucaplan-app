import { z, ZodError } from "zod"
import type {
  PluginActor,
  PluginJsonValue,
  PluginOperationStore,
} from "../../domain/plugin/plugin.domain.ts"
import { NotOwnerError } from "../../domain/finance/finance.domain.ts"
import {
  pluginTools,
  type PluginToolName,
} from "../../../../lib/schemas/plugin.ts"
import { canonicalJson } from "../../../shared/canonical-json.ts"
import { domainErrorStatus } from "../domain-error-status.ts"

export class PluginToolError extends Error {
  readonly status: number
  // Solo en faltas de permiso: el host lo usa para pedir el scope que falta.
  readonly requiredScope: string | null
  constructor(message: string, status = 400, requiredScope: string | null = null) {
    super(message)
    this.name = "PluginToolError"
    this.status = status
    this.requiredScope = requiredScope
  }
}

// Un id de entrada que no es del usuario, con el nombre del campo para que el chat sepa cuál.
export class PluginReferenceError extends NotOwnerError {
  constructor(field: string) {
    super()
    this.message = `${field} no existe o no pertenece a tu cuenta`
  }
}

// Rechazo propio del borde del plugin (antes de escribir), p. ej. un nombre ya usado (→ 422).
export class PluginRejection extends Error {
  constructor(message: string) {
    super(message)
    this.name = "PluginRejection"
  }
}

type Deps = {
  operations: PluginOperationStore
  executor: {
    execute(
      actor: PluginActor,
      name: PluginToolName,
      args: Record<string, unknown>
    ): Promise<PluginJsonValue>
  }
  hash(input: string): string
}

const spanish = z.locales.es()

function zodMessage(error: ZodError): string {
  return error.issues
    .slice(0, 8)
    .map((issue) => `${issue.path.join(".") || "argumentos"}: ${issue.message}`)
    .join("; ")
}

// Mensaje accionable de un error de negocio; null si el error no es de negocio (no se expone).
function domainMessage(error: unknown): string | null {
  if (error instanceof PluginRejection) return error.message
  const status = domainErrorStatus(error)
  if (status === null) return null
  if (error instanceof ZodError) return `Datos inválidos: ${zodMessage(error)}`
  if (status === 404)
    return `${
      error instanceof PluginReferenceError
        ? error.message
        : "El recurso indicado no existe o no pertenece a tu cuenta"
    }. Búscalo con la herramienta de lista o búsqueda correspondiente y usa su id exacto`
  return (error as Error).message
}

export async function executePluginTool(
  deps: Deps,
  actor: PluginActor,
  name: string,
  rawArgs: unknown
): Promise<PluginJsonValue> {
  if (!Object.hasOwn(pluginTools, name))
    throw new PluginToolError(
      `Herramienta desconocida: ${name.slice(0, 80)}. Usa una de las que lista tools/list`
    )
  const toolName = name as PluginToolName
  const tool = pluginTools[toolName]
  if (!actor.userId || !actor.clientId || !actor.scopes.includes(tool.scope))
    throw new PluginToolError(
      `La conexión no tiene el permiso ${tool.scope}. Vuelve a conectar Luca Plan y acepta ese permiso`,
      403,
      tool.scope
    )
  const parsed = tool.inputSchema.safeParse(rawArgs, { error: spanish.localeError })
  if (!parsed.success)
    throw new PluginToolError(
      `Argumentos inválidos para ${toolName}: ${zodMessage(parsed.error)}`
    )
  const input: Record<string, unknown> = parsed.data
  if (toolName === "lucaplan_ver_operacion") {
    const receipt = await deps.operations.get({
      userId: actor.userId,
      clientId: actor.clientId,
      operationId: input.operationId as string,
    })
    if (!receipt) return null
    return {
      operationId: receipt.operationId,
      toolName: receipt.toolName,
      status: receipt.status,
      result: receipt.result,
      createdAt: receipt.createdAt.toISOString(),
      updatedAt: receipt.updatedAt.toISOString(),
      finishedAt: receipt.finishedAt?.toISOString() ?? null,
    }
  }
  if (tool.readOnly) {
    try {
      return await deps.executor.execute(actor, toolName, input)
    } catch (error) {
      const message = domainMessage(error)
      throw new PluginToolError(
        message ?? "No se pudo completar la consulta. Intenta de nuevo en un momento",
        message ? (domainErrorStatus(error) ?? 422) : 500
      )
    }
  }
  const { operationId, ...args } = input
  const key = {
    userId: actor.userId,
    clientId: actor.clientId,
    operationId: operationId as string,
  }
  const inputHash = deps.hash(canonicalJson(args))
  const claim = await deps.operations.claim({ ...key, toolName, inputHash })
  if (!claim.claimed) {
    if (
      claim.operation.toolName !== toolName ||
      claim.operation.inputHash !== inputHash
    )
      throw new PluginToolError(
        "Esa operationId ya se usó para otros datos o para otra herramienta. Usa una clave nueva para un pedido distinto",
        409
      )
    if (claim.operation.status === "completed") return claim.operation.result
    throw new PluginToolError(
      `La operación ${key.operationId} está ${claim.operation.status}. Consulta lucaplan_ver_operacion y comprueba los datos; no repitas la escritura con otra clave`,
      409
    )
  }
  let result: PluginJsonValue
  try {
    result = await deps.executor.execute(actor, toolName, args)
  } catch (error) {
    // Rechazo de negocio: el caso de uso validó (propiedad, regla, datos) y no escribió. Se libera
    // la reserva para que la misma clave sirva con los datos corregidos.
    const message = domainMessage(error)
    if (message) {
      const released = await deps.operations
        .release(key)
        .then(() => true)
        .catch(() => false)
      throw new PluginToolError(
        released
          ? `Rechazado sin cambios: ${message}. Corrige los datos y vuelve a intentarlo; puedes reutilizar la misma operationId`
          : `Rechazado sin cambios: ${message}. Para reintentar usa una operationId nueva`,
        domainErrorStatus(error) ?? 422
      )
    }
    await deps.operations
      .finish(key, {
        status: "uncertain",
        result: {
          error:
            "No se puede asegurar qué se guardó. Consulta la operación y comprueba los datos antes de otro cambio",
        },
      })
      .catch(() => false)
    throw new PluginToolError(
      `Resultado incierto: la escritura empezó y no se pudo confirmar qué se guardó. Consulta lucaplan_ver_operacion con operationId ${key.operationId} y revisa los datos afectados; no repitas la escritura con otra clave`,
      409
    )
  }
  // Si falla guardar el recibo se mantiene pending: jamás afirmar que se puede reintentar.
  try {
    if (!(await deps.operations.finish(key, { status: "completed", result })))
      throw new Error("Recibo ya finalizado")
  } catch {
    throw new PluginToolError(
      "El cambio se ejecutó pero no se pudo guardar su recibo. No repitas la escritura; consulta lucaplan_ver_operacion y revisa los datos",
      409
    )
  }
  return result
}
