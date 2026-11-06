// Primer ADMIN de una instalación (WDC-181): solo la PRIMERA cuenta de una base vacía queda ADMIN,
// para que alguien pueda configurar las integraciones. Nunca «la próxima de una instalación sin
// ADMIN»: con el registro abierto, un desconocido quedaría ADMIN. La escritura es atómica en el
// adapter (UPDATE … WHERE id = $1 AND (SELECT count(*) FROM "user") = 1); el repo en memoria la imita.
// Corre con: node --test arch/v1/application/user-use-cases/first-admin.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { assignFirstAdmin } from "./assign-first-admin-use-case.ts"
import type { FirstAdminRepository } from "../../domain/user/user.domain.ts"
import type { Role } from "../../domain/authorization/authorization.domain.ts"

function users(initial: Record<string, Role>) {
  const roles = new Map(Object.entries(initial))
  const repo: FirstAdminRepository = {
    async promoteIfOnlyUser(id) {
      if (roles.size !== 1 || !roles.has(id)) return false
      roles.set(id, "ADMIN")
      return true
    },
  }
  // Better Auth inserta la cuenta con su rol por defecto (USER); después corre el caso de uso.
  const insert = (id: string) => roles.set(id, "USER")
  const create = async (id: string) => {
    insert(id)
    return assignFirstAdmin(repo, id)
  }
  return { roles, insert, create, repo }
}

test("solo la primera cuenta de una base vacía queda ADMIN: la segunda queda USER, una instalación con cuentas USER y sin ADMIN no promueve a nadie, y dos altas a la vez dejan a ninguna como ADMIN", async () => {
  // Base vacía: Ana es la primera y queda ADMIN.
  const fresh = users({})
  assert.equal(await fresh.create("ana"), true)
  assert.equal(fresh.roles.get("ana"), "ADMIN")
  // Borde: la segunda ya no.
  assert.equal(await fresh.create("pedro"), false)
  assert.deepEqual(Object.fromEntries(fresh.roles), { ana: "ADMIN", pedro: "USER" })

  // La instalación de Willy hoy: solo cuentas USER, ninguna ADMIN. Con el registro abierto, un
  // desconocido que se crea cuenta NO queda ADMIN, y las existentes no se tocan.
  const noAdmin = users({ willy: "USER", demo: "PREMIUM" })
  assert.equal(await noAdmin.create("desconocido"), false)
  assert.deepEqual(Object.fromEntries(noAdmin.roles), { willy: "USER", demo: "PREMIUM", desconocido: "USER" })

  // Dos cuentas creadas a la vez en una base vacía: las dos ya están insertadas cuando corre el
  // caso de uso, así que ninguna queda ADMIN (falla cerrado).
  const race = users({})
  race.insert("a")
  race.insert("b")
  assert.deepEqual(await Promise.all([assignFirstAdmin(race.repo, "a"), assignFirstAdmin(race.repo, "b")]), [false, false])
  assert.deepEqual(Object.fromEntries(race.roles), { a: "USER", b: "USER" })
})
