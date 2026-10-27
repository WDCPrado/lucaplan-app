// Qué hace el aviso por correo frente a la fila previa y las altas conciliadas cercanas (WDC-123).
// Corre con: node --test arch/v1/domain/finance/email-notice-decision.domain.test.ts
import test from "node:test"
import assert from "node:assert/strict"
import { decideEmailNotice } from "./bank-reconciliation.domain.ts"

const aviso = {
  date: "2026-10-06",
  direction: "debit",
  amount: 12990,
  currency: "CLP",
  description: "LIDER EXPRESS 12",
}
const alta = (over: Partial<typeof aviso> & { id: string }) => ({ ...aviso, ...over })

test("aviso reprocesado: conciliado se conserva, sin conciliar se actualiza", () => {
  assert.deepEqual(decideEmailNotice(aviso, { reconciled: true }, []), { kind: "keep" })
  assert.deepEqual(decideEmailNotice(aviso, { reconciled: false }, []), { kind: "update" })
})

test("aviso nuevo: un candidato con mismo importe y comercio se enlaza", () => {
  assert.deepEqual(
    decideEmailNotice(aviso, null, [alta({ id: "c1", date: "2026-10-09", description: "Líder Express 12" })]),
    { kind: "link", id: "c1" }
  )
})

test("aviso nuevo: dos candidatos, o uno que solo coincide en comercio, es ambiguo", () => {
  assert.deepEqual(
    decideEmailNotice(aviso, null, [alta({ id: "c1" }), alta({ id: "c2" })]),
    { kind: "ambiguous" }
  )
  assert.deepEqual(
    decideEmailNotice(aviso, null, [alta({ id: "c1", amount: 15000 })]),
    { kind: "ambiguous" }
  )
})

test("aviso nuevo sin candidatos que coincidan se crea", () => {
  assert.deepEqual(decideEmailNotice(aviso, null, []), { kind: "create" })
  assert.deepEqual(
    decideEmailNotice(aviso, null, [
      alta({ id: "c1", amount: 5000, description: "COPEC" }),
      alta({ id: "c2", date: "2026-10-11" }),
    ]),
    { kind: "create" }
  )
})
