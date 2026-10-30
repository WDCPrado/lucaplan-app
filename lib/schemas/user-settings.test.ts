import { test } from "node:test"
import assert from "node:assert/strict"
import { userSettingsPatchSchema, userSettingsSchema } from "./user-settings.ts"

test("El nivel de vidrio va de 0 a 4, entero.", () => {
  for (const glassLevel of [0, 4])
    assert.equal(
      userSettingsSchema.safeParse({ glassLevel, theme: "system" }).success,
      true
    )
  for (const glassLevel of [-1, 5, 2.5])
    assert.equal(
      userSettingsSchema.safeParse({ glassLevel, theme: "system" }).success,
      false
    )
})

test("El tema solo puede ser claro, oscuro o del sistema.", () => {
  assert.equal(
    userSettingsPatchSchema.safeParse({ theme: "dark" }).success,
    true
  )
  assert.equal(
    userSettingsPatchSchema.safeParse({ theme: "sepia" }).success,
    false
  )
})

test("Un patch vacío no se acepta; uno parcial sí.", () => {
  assert.equal(userSettingsPatchSchema.safeParse({}).success, false)
  assert.equal(userSettingsPatchSchema.safeParse(null).success, false)
  assert.equal(
    userSettingsPatchSchema.safeParse({ glassLevel: undefined }).success,
    false
  )
  assert.equal(userSettingsPatchSchema.safeParse({ otra: 1 }).success, false)
  assert.deepEqual(userSettingsPatchSchema.parse({ glassLevel: 3 }), {
    glassLevel: 3,
  })
})
