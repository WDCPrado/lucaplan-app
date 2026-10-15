// Identidad verificada por el servidor. Nunca se obtiene de argumentos del modelo.
export const PLUGIN_SCOPES = ["finance:read", "finance:write"] as const
export type PluginScope = (typeof PLUGIN_SCOPES)[number]

export type PluginActor = {
  userId: string
  clientId: string
  scopes: readonly string[]
}

export type PluginJsonValue =
  | null
  | boolean
  | number
  | string
  | PluginJsonValue[]
  | { [key: string]: PluginJsonValue }

export const PLUGIN_OPERATION_STATUSES = [
  "pending",
  "completed",
  "failed",
  "uncertain",
] as const
export type PluginOperationStatus = (typeof PLUGIN_OPERATION_STATUSES)[number]

// Una clave pertenece a un usuario Y a un cliente OAuth; no es global entre cuentas.
export type PluginOperationKey = {
  userId: string
  clientId: string
  operationId: string
}

export type PluginOperation = PluginOperationKey & {
  toolName: string
  inputHash: string
  status: PluginOperationStatus
  result: PluginJsonValue
  createdAt: Date
  updatedAt: Date
  finishedAt: Date | null
}

export type PluginOperationClaim =
  | { claimed: true; operation: PluginOperation }
  | { claimed: false; operation: PluginOperation }

export interface PluginOperationStore {
  // Atómico: insertar pending o devolver el registro existente, incluso si cambió el hash.
  // El caller compara toolName/inputHash y nunca vuelve a ejecutar una clave existente.
  claim(
    input: PluginOperationKey & { toolName: string; inputHash: string }
  ): Promise<PluginOperationClaim>
  get(key: PluginOperationKey): Promise<PluginOperation | null>
  // Solo transiciona pending a un estado terminal. Devuelve false si ya terminó.
  finish(
    key: PluginOperationKey,
    outcome: {
      status: Exclude<PluginOperationStatus, "pending">
      result: PluginJsonValue
    }
  ): Promise<boolean>
}

// Un fallo tras iniciar una escritura puede haber persistido efectos parciales. Se marca
// uncertain: reintentar con otra clave no es una recuperación automática segura.
export type PluginPage<T> = {
  items: T[]
  nextOffset: number | null
}
