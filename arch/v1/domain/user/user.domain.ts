// Dominio de usuario. La identidad la posee Better Auth; aquí modelamos lo que el
// negocio necesita gestionar (rol, baneo) y el port que la infra implementará
// (adapter sobre la admin API de Better Auth).

import type { Role } from "../authorization/authorization.domain.ts"

export type User = {
  id: string
  email: string
  name: string
  role: Role
  banned: boolean
}

// Port: implementado en infraestructura. Los use-cases lo reciben por inyección.
export interface UserRepository {
  findById(id: string): Promise<User | null>
  // Usuarios cuyo correo termina en `domain` ("@lucaplan.cl"), más antiguo primero y como mucho
  // `take`. Lo usa el login de los entornos de PR para ofrecer las cuentas que sembró el seed.
  listByEmailDomain(domain: string, take: number): Promise<User[]>
  setRole(id: string, role: Role): Promise<User>
  setBanned(id: string, banned: boolean): Promise<User>
}

export class UserNotFoundError extends Error {
  constructor(id: string) {
    super(`Usuario no encontrado: ${id}`)
    this.name = "UserNotFoundError"
  }
}

// Invariante: un admin no puede degradarse ni banearse a sí mismo (evita auto-lockout).
export class SelfTargetError extends Error {
  constructor(action: string) {
    super(`No puedes ${action} tu propia cuenta`)
    this.name = "SelfTargetError"
  }
}
