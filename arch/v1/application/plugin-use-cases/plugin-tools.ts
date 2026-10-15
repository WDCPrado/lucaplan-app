import type {
  PluginActor,
  PluginJsonValue,
  PluginOperationStore,
} from "../../domain/plugin/plugin.domain.ts"
import {
  pluginTools,
  type PluginToolName,
} from "../../../../lib/schemas/plugin.ts"

export class PluginToolError extends Error {
  readonly status: number
  constructor(message: string, status = 400) {
    super(message)
    this.name = "PluginToolError"
    this.status = status
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

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  if (value !== null && typeof value === "object") {
    const object = value as Record<string, unknown>
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`)
      .join(",")}}`
  }
  return JSON.stringify(value)
}

export async function executePluginTool(
  deps: Deps,
  actor: PluginActor,
  name: string,
  rawArgs: unknown
): Promise<PluginJsonValue> {
  if (!Object.hasOwn(pluginTools, name))
    throw new PluginToolError("Herramienta desconocida")
  const toolName = name as PluginToolName
  const tool = pluginTools[toolName]
  if (!actor.userId || !actor.clientId || !actor.scopes.includes(tool.scope))
    throw new PluginToolError("La conexión no tiene el permiso requerido", 403)
  const parsed = tool.inputSchema.safeParse(rawArgs)
  if (!parsed.success)
    throw new PluginToolError(
      "Argumentos inválidos; revisa el contrato de la herramienta"
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
    } catch {
      throw new PluginToolError("No se pudo completar la consulta", 500)
    }
  }
  const { operationId, ...args } = input
  const key = {
    userId: actor.userId,
    clientId: actor.clientId,
    operationId: operationId as string,
  }
  const inputHash = deps.hash(canonical(args))
  const claim = await deps.operations.claim({ ...key, toolName, inputHash })
  if (!claim.claimed) {
    if (
      claim.operation.toolName !== toolName ||
      claim.operation.inputHash !== inputHash
    )
      throw new PluginToolError(
        "La clave de operación ya corresponde a otros datos o acción",
        409
      )
    if (claim.operation.status === "completed") return claim.operation.result
    throw new PluginToolError(
      "Operación pendiente, fallida o incierta. Consulta lucaplan_ver_operacion y comprueba los datos; no repitas la escritura con otra clave",
      409
    )
  }
  let result: PluginJsonValue
  try {
    result = await deps.executor.execute(actor, toolName, args)
  } catch {
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
      "Resultado incierto. Consulta lucaplan_ver_operacion; no repitas la escritura con otra clave",
      409
    )
  }
  // Si falla guardar el recibo se mantiene pending: jamás afirmar que se puede reintentar.
  try {
    if (!(await deps.operations.finish(key, { status: "completed", result })))
      throw new Error("Recibo ya finalizado")
  } catch {
    throw new PluginToolError(
      "No se pudo confirmar el recibo de la operación. No repitas la escritura; consulta su estado",
      409
    )
  }
  return result
}
