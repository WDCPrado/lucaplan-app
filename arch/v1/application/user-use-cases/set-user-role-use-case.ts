import type {
  Actor,
  Role,
} from "../../domain/authorization/authorization.domain.ts"
import {
  type User,
  type UserRepository,
  SelfTargetError,
  UserNotFoundError,
} from "../../domain/user/user.domain.ts"
import { authorize } from "../auth-use-cases/authorize-use-case.ts"

// ADMIN asigna un rol a otro usuario. No puede cambiar el suyo (evita auto-lockout).
export async function setUserRole(
  repo: UserRepository,
  actor: Actor | null,
  targetUserId: string,
  role: Role
): Promise<User> {
  const admin = authorize(actor, "user", "setRole")
  if (admin.userId === targetUserId)
    throw new SelfTargetError("cambiar el rol de")
  if (!(await repo.findById(targetUserId)))
    throw new UserNotFoundError(targetUserId)
  return repo.setRole(targetUserId, role)
}
