// Primer ADMIN de una instalación (WDC-181): la cuenta recién creada queda ADMIN solo si es la
// única de la base. Nunca «la siguiente de una instalación sin ADMIN»: con el registro abierto, un
// desconocido quedaría ADMIN. Dos altas a la vez fallan cerrado (ninguna). Lo atómico es del repo.
import type { FirstAdminRepository } from "../../domain/user/user.domain.ts"

export function assignFirstAdmin(repo: FirstAdminRepository, userId: string): Promise<boolean> {
  return repo.promoteIfOnlyUser(userId)
}
