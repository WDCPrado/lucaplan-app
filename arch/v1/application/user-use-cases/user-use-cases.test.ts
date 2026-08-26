// Use-cases de gestión de usuarios probados con un repo in-memory inyectado.
// Corre con: node --test arch/v1/application/user-use-cases/user-use-cases.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import type { User, UserRepository } from "../../domain/user/user.domain.ts"
import type { Actor } from "../../domain/authorization/authorization.domain.ts"
import { setUserRole } from "./set-user-role-use-case.ts"
import { setUserBanned } from "./set-user-banned-use-case.ts"

// Adapter mock del port: datos en memoria. Vive junto al test (no es infra real).
class InMemoryUserRepository implements UserRepository {
  private users = new Map<string, User>()
  constructor(seed: User[]) {
    for (const u of seed) this.users.set(u.id, u)
  }
  async findById(id: string) {
    return this.users.get(id) ?? null
  }
  async listByEmailDomain(domain: string, take: number) {
    return [...this.users.values()]
      .filter((u) => u.email.endsWith(domain))
      .slice(0, take)
  }
  async setRole(id: string, role: User["role"]) {
    const next = { ...this.users.get(id)!, role }
    this.users.set(id, next)
    return next
  }
  async setBanned(id: string, banned: boolean) {
    const next = { ...this.users.get(id)!, banned }
    this.users.set(id, next)
    return next
  }
}

const seed = (): InMemoryUserRepository =>
  new InMemoryUserRepository([
    {
      id: "admin1",
      email: "a@x.cl",
      name: "Admin",
      role: "ADMIN",
      banned: false,
    },
    { id: "user1", email: "u@x.cl", name: "User", role: "USER", banned: false },
  ])

const admin: Actor = { userId: "admin1", role: "ADMIN" }
const user: Actor = { userId: "user1", role: "USER" }

test("setUserRole: ADMIN promueve USER → PREMIUM", async () => {
  const updated = await setUserRole(seed(), admin, "user1", "PREMIUM")
  assert.equal(updated.role, "PREMIUM")
})

test("setUserRole: USER no autorizado", async () => {
  await assert.rejects(
    () => setUserRole(seed(), user, "user1", "ADMIN"),
    /Prohibido/
  )
})

test("setUserRole: sin actor → no autenticado", async () => {
  await assert.rejects(
    () => setUserRole(seed(), null, "user1", "ADMIN"),
    /No autenticado/
  )
})

test("setUserRole: admin no puede cambiar su propio rol", async () => {
  await assert.rejects(
    () => setUserRole(seed(), admin, "admin1", "USER"),
    /tu propia cuenta/
  )
})

test("setUserRole: usuario inexistente", async () => {
  await assert.rejects(
    () => setUserRole(seed(), admin, "ghost", "USER"),
    /no encontrado/
  )
})

test("setUserBanned: ADMIN banea a un usuario", async () => {
  const updated = await setUserBanned(seed(), admin, "user1", true)
  assert.equal(updated.banned, true)
})

test("setUserBanned: admin no puede banearse a sí mismo", async () => {
  await assert.rejects(
    () => setUserBanned(seed(), admin, "admin1", true),
    /tu propia cuenta/
  )
})
