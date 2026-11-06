// Dominio de autorización (authZ). Puro: sin Better Auth, sin DB, sin Next.
// Fuente única de verdad de roles y permisos. La infraestructura (Better Auth)
// espeja esta política; nunca al revés.

export const ROLES = ["ADMIN", "USER", "PREMIUM"] as const
export type Role = (typeof ROLES)[number]

// Catálogo recurso → acciones. Se extiende por feature: al crear `budget`
// agregas `budget: ["create", "read", "update", "delete"]` aquí.
export const PERMISSIONS = {
  user: ["read", "update", "delete", "setRole", "ban"], // gestión de usuarios (solo ADMIN)
  premium: ["access"], // features premium
  integrations: ["read", "update"], // claves de terceros de la instalación (solo ADMIN)
} as const

export type Resource = keyof typeof PERMISSIONS
export type Action<R extends Resource = Resource> =
  (typeof PERMISSIONS)[R][number]

// Qué puede cada rol. ADMIN: todo. USER: nada de gestión ni premium (las features
// de negocio lo amplían). PREMIUM: USER + premium.
type Policy = { [R in Resource]?: readonly Action<R>[] }

const POLICY: Record<Role, Policy> = {
  ADMIN: {
    user: PERMISSIONS.user,
    premium: PERMISSIONS.premium,
    integrations: PERMISSIONS.integrations,
  },
  USER: {},
  PREMIUM: { premium: ["access"] },
}

/** RBAC puro: ¿el rol puede ejecutar la acción sobre el recurso? */
export function can<R extends Resource>(
  role: Role,
  resource: R,
  action: Action<R>
): boolean {
  const allowed = POLICY[role][resource] as readonly string[] | undefined
  return allowed?.includes(action) ?? false
}

// --- Sesión / actor (ports para la infraestructura) ---

// Quién ejecuta la acción. El rol lo provee Better Auth; que un dato sea "suyo"
// (ownership) NO lo cubre el rol: se valida en cada use-case con el userId.
export type Actor = { userId: string; role: Role }

/** Port: la infraestructura (Better Auth) resuelve el actor desde los headers del request. */
export interface SessionPort {
  getActor(headers: Headers): Promise<Actor | null>
}

// --- Errores de negocio (presentation los mapea a 401 / 403) ---

export class UnauthenticatedError extends Error {
  constructor() {
    super("No autenticado")
    this.name = "UnauthenticatedError"
  }
}

export class ForbiddenError extends Error {
  constructor(resource: Resource, action: string) {
    super(`Prohibido: no puedes '${action}' sobre '${resource}'`)
    this.name = "ForbiddenError"
  }
}
