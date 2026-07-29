// Corre con: node --test arch/v1/application/notification-use-cases/notifications.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import type {
  PushSubscription,
  PushSendResult,
} from "../../domain/notifications/push.domain.ts"
import {
  budgetAlertMessage,
  dueSoonMessage,
  newMovementsMessage,
} from "./notification-rules.ts"
import { sendPushToUser } from "./push-use-cases.ts"

const mov = (
  description: string,
  amount: number,
  direction: "debit" | "credit" = "debit"
) => ({ description, amount, currency: "CLP" as const, direction })

test("un movimiento se nombra; varios se resumen; ninguno no notifica", () => {
  assert.equal(newMovementsMessage([]), null)
  const one = newMovementsMessage([mov("Uber Eats", 12990)])
  assert.equal(one?.title, "Nuevo gasto")
  assert.match(one!.body, /12\.990/)
  assert.match(one!.body, /Uber Eats/)
  const many = newMovementsMessage([
    mov("Uber Eats", 12990),
    mov("Copec", 20000),
    mov("Sueldo", 900000, "credit"),
  ])
  assert.equal(many?.title, "3 movimientos nuevos")
  assert.match(many!.body, /32\.990/) // solo gastos, el abono no suma
})

test("la alerta de presupuesto solo se dispara al CRUZAR el umbral", () => {
  // Cruza el 80%: 700k → 850k sobre un límite de 1M.
  assert.match(budgetAlertMessage(700_000, 850_000, 1_000_000)!.title, /80%/)
  // Ya estaba sobre el 80%: no se repite.
  assert.equal(budgetAlertMessage(850_000, 900_000, 1_000_000), null)
  // Cruza el 100% (gana el umbral más alto aunque cruce ambos).
  assert.match(
    budgetAlertMessage(700_000, 1_100_000, 1_000_000)!.title,
    /Superaste/
  )
  // Sin límite definido no hay nada que alertar.
  assert.equal(budgetAlertMessage(0, 500_000, 0), null)
})

test("vencimientos: solo dentro de la ventana, en UTC", () => {
  const now = new Date("2026-07-28T12:00:00Z")
  const item = (description: string, day: string, amount = 15000) => ({
    description,
    amount,
    currency: "CLP" as const,
    dueDate: new Date(`${day}T00:00:00Z`),
  })
  assert.equal(dueSoonMessage([item("Netflix", "2026-08-05")], now), null) // fuera de ventana
  assert.equal(dueSoonMessage([item("Netflix", "2026-07-27")], now), null) // ya venció
  assert.match(
    dueSoonMessage([item("Netflix", "2026-07-29")], now)!.title,
    /Vence mañana: Netflix/
  )
  const many = dueSoonMessage(
    [item("Netflix", "2026-07-28"), item("Spotify", "2026-07-30", 5000)],
    now
  )
  assert.equal(many?.title, "2 pagos por vencer")
  assert.match(many!.body, /20\.000/)
})

test("sendPushToUser borra las suscripciones muertas y no corta a las demás", async () => {
  const subs: PushSubscription[] = [
    { userId: "u1", endpoint: "https://push/ok", keys: { p256dh: "a", auth: "b" } },
    { userId: "u1", endpoint: "https://push/gone", keys: { p256dh: "a", auth: "b" } },
    { userId: "u1", endpoint: "https://push/boom", keys: { p256dh: "a", auth: "b" } },
  ]
  const deleted: string[] = []
  const deps = {
    subscriptions: {
      save: async () => {},
      deleteByEndpoint: async (e: string) => {
        deleted.push(e)
      },
      listByUser: async () => subs,
    },
    sender: {
      send: async (sub: PushSubscription): Promise<PushSendResult> => {
        if (sub.endpoint.endsWith("gone")) return "gone"
        if (sub.endpoint.endsWith("boom")) throw new Error("red caída")
        return "sent"
      },
    },
  }
  const sent = await sendPushToUser(deps, "u1", { title: "t", body: "b" })
  assert.equal(sent, 1)
  assert.deepEqual(deleted, ["https://push/gone"]) // el fallo transitorio NO borra
})
