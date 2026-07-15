import assert from "node:assert/strict"
import { test } from "node:test"
import { EmailSetupStateError } from "../../domain/finance/email-connection.domain.ts"
import { parseSnapshotBody } from "./email-snapshot-body.ts"

test("deriva el usado como total − disponible, con precisión USD de dos decimales", () => {
  const input = parseSnapshotBody({
    snapshotAt: "2026-07-15T00:39:00.000Z",
    checking: {
      ref: "8900",
      cash: 0,
      overdraft: { limit: 1000000, available: 886453 },
    },
    cards: [
      {
        last4: "2120",
        national: { limit: 3272200, available: 992926 },
        international: { limit: 2100, available: 1694.62 },
      },
    ],
  })
  assert.equal(input.checking?.overdraft?.limit.toDecimalString(), "1000000")
  assert.equal(input.checking?.overdraft?.used.toDecimalString(), "113547")
  assert.equal(input.cards[0].national?.used.toDecimalString(), "2279274")
  // 2100 − 1694.62 en float da 405.38000000000005; Money debe conservar 405.38 exacto.
  assert.equal(input.cards[0].international?.used.toDecimalString(), "405.38")
  assert.equal(input.cards[0].international?.limit.toDecimalString(), "2100.00")
})

test("rechaza un disponible negativo o mayor que el cupo total", () => {
  const body = (available: number) => ({
    snapshotAt: "2026-07-15T00:00:00.000Z",
    checking: null,
    cards: [
      {
        last4: "2120",
        national: { limit: 1000, available },
        international: null,
      },
    ],
  })
  assert.throws(() => parseSnapshotBody(body(2000)), EmailSetupStateError)
  assert.throws(() => parseSnapshotBody(body(-1)), EmailSetupStateError)
})
