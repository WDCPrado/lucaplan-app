import type { Actor } from "../../domain/authorization/authorization.domain.ts"
import {
  type User,
  type UserRepository,
  SelfTargetError,
  UserNotFoundError,
} from "../../domain/user/user.domain.ts"
import { authorize } from "../auth-use-cases/authorize-use-case.ts"

// ADMIN banea / desbanea a un usuario. No puede banearse a sí mismo.
export async function setUserBanned(
  repo: UserRepository,
  actor: Actor | null,
  targetUserId: string,
  banned: boolean
): Promise<User> {
  const admin = authorize(actor, "user", "ban")
  if (banned && admin.userId === targetUserId)
    throw new SelfTargetError("banear")
  if (!(await repo.findById(targetUserId)))
    throw new UserNotFoundError(targetUserId)
  return repo.setBanned(targetUserId, banned)
}
