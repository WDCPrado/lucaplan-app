// Corre con: node --test arch/v1/application/notification-use-cases/notifications.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  InvalidPushEndpointError,
  isAllowedPushEndpoint,
  type PushMessage,
  type PushSubscription,
  type PushSendResult,
} from "../../domain/notifications/push.domain.ts"
import type { Transaction } from "../../domain/finance/finance.domain.ts"
import { Money } from "../../domain/finance/money.ts"
import { notifyBudgetCrossing } from "./notify-imported-use-case.ts"
import {
  budgetAlertMessage,
  dueSoonMessage,
  newMovementsMessage,
} from "./notification-rules.ts"
import { sendPushToUser, subscribeToPush } from "./push-use-cases.ts"

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
  const P = [80, 100] // umbrales configurados
  // Cruza el 80%: 700k → 850k sobre un límite de 1M.
  assert.match(budgetAlertMessage(700_000, 850_000, 1_000_000, P)!.title, /80%/)
  // Ya estaba sobre el 80%: no se repite.
  assert.equal(budgetAlertMessage(850_000, 900_000, 1_000_000, P), null)
  // Cruza el 100% (gana el umbral más alto aunque cruce ambos) y reporta el % real, no el umbral.
  assert.match(
    budgetAlertMessage(700_000, 1_250_000, 1_000_000, P)!.title,
    /Superaste.*125%/
  )
  // Justo en el 100% no es sobrepaso: se completó.
  assert.match(
    budgetAlertMessage(700_000, 1_000_000, 1_000_000, P)!.title,
    /Completaste/
  )
  // Sin límite definido no hay nada que alertar.
  assert.equal(budgetAlertMessage(0, 500_000, 0, P), null)
  // Sin umbrales configurados no se avisa nada.
  assert.equal(budgetAlertMessage(0, 900_000, 1_000_000, []), null)
})

test("los umbrales son configurables: N y en cualquier orden", () => {
  const P = [100, 50, 90] // desordenados a propósito
  assert.match(budgetAlertMessage(400_000, 550_000, 1_000_000, P)!.title, /50%/)
  // 50% y 90% se cruzan de una vez: gana el más alto.
  assert.match(budgetAlertMessage(400_000, 950_000, 1_000_000, P)!.title, /90%/)
  // Ya sobre el 100%: el cruce ocurrió una vez, no se repite en cada gasto posterior.
  assert.equal(budgetAlertMessage(1_100_000, 1_400_000, 1_000_000, P), null)
})

test("categorizar un movimiento lo mete al presupuesto y puede cruzar un umbral", async () => {
  const clp = (n: number) => Money.of(n, "CLP")
  const tx = (over: Partial<Transaction>): Transaction => ({
    id: "t",
    userId: "u1",
    accountId: "cc",
    categoryId: "cat1",
    date: new Date(Date.UTC(2026, 6, 10)),
    description: "x",
    amount: clp(0),
    direction: "debit",
    status: "confirmed",
    isInternal: false,
    externalId: null,
    ...over,
  })
  const enviados: PushMessage[] = []
  const deps = (txs: Transaction[]) => ({
    subscriptions: {
      save: async () => {},
      deleteByEndpoint: async () => {},
      listByUser: async () => [
        {
          userId: "u1",
          endpoint: "https://fcm.googleapis.com/fcm/send/ok",
          keys: { p256dh: "a", auth: "b" },
        },
      ],
    },
    sender: {
      send: async (
        _s: PushSubscription,
        m: PushMessage
      ): Promise<PushSendResult> => {
        enviados.push(m)
        return "sent"
      },
    },
    transactions: { listByUserPeriod: async () => txs },
    monthlyBudgets: {
      listByUser: async () => [
        { id: "b1", userId: "u1", year: 2026, month: 7, globalLimit: clp(1_000_000) },
      ],
    },
    budgetAlerts: { list: async () => [{ id: "a1", percent: 80 }] },
  })

  // 700k ya categorizados + uno de 150k SIN categoría: el sin categoría no gasta nada todavía.
  const sinCategoria = tx({ id: "nuevo", amount: clp(150_000), categoryId: null })
  await notifyBudgetCrossing(
    deps([tx({ id: "viejo", amount: clp(700_000) }), sinCategoria]),
    "u1",
    2026,
    7,
    (t) => t.id === "nuevo"
  )
  assert.equal(enviados.length, 0)

  // Al categorizarlo entra al presupuesto: 700k → 850k cruza el 80%.
  await notifyBudgetCrossing(
    deps([
      tx({ id: "viejo", amount: clp(700_000) }),
      tx({ id: "nuevo", amount: clp(150_000) }),
    ]),
    "u1",
    2026,
    7,
    (t) => t.id === "nuevo"
  )
  assert.equal(enviados.length, 1)
  assert.match(enviados[0].title, /80%/)
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

test("solo se aceptan endpoints de push services conocidos (SSRF)", async () => {
  for (const ok of [
    "https://fcm.googleapis.com/fcm/send/abc123",
    "https://updates.push.services.mozilla.com/wpush/v2/abc",
    "https://web.push.apple.com/QWxhZGRpbjpv",
    "https://sin.notify.windows.com/w/?token=abc",
  ])
    assert.equal(isAllowedPushEndpoint(ok), true, ok)

  for (const malo of [
    "https://localhost/push", // red local
    "https://127.0.0.1:8080/x",
    "https://169.254.169.254/latest/meta-data/", // metadatos de la nube
    "https://interno.corp/admin",
    "http://fcm.googleapis.com/fcm/send/abc", // sin TLS
    "https://fcm.googleapis.com.attacker.dev/x", // sufijo falso
    "https://attacker.dev/?x=fcm.googleapis.com",
    "no-es-una-url",
  ])
    assert.equal(isAllowedPushEndpoint(malo), false, malo)

  // El caso de uso no guarda nada si el endpoint no pasa la allowlist.
  const deps = {
    subscriptions: {
      save: async () => assert.fail("guardó un endpoint no permitido"),
      deleteByEndpoint: async () => {},
      listByUser: async () => [],
    },
    sender: { send: async (): Promise<PushSendResult> => "sent" },
  }
  await assert.rejects(
    () =>
      subscribeToPush(deps, "u1", {
        endpoint: "https://169.254.169.254/latest/meta-data/",
        keys: { p256dh: "a", auth: "b" },
      }),
    InvalidPushEndpointError
  )
})

test("sendPushToUser borra las suscripciones muertas y no corta a las demás", async () => {
  const fcm = (path: string) => `https://fcm.googleapis.com/fcm/send/${path}`
  const subs: PushSubscription[] = [
    { userId: "u1", endpoint: fcm("ok"), keys: { p256dh: "a", auth: "b" } },
    { userId: "u1", endpoint: fcm("gone"), keys: { p256dh: "a", auth: "b" } },
    { userId: "u1", endpoint: fcm("boom"), keys: { p256dh: "a", auth: "b" } },
    // Fila con host no permitido (escritura directa a la BD): no debe salir ningún POST hacia ella.
    { userId: "u1", endpoint: "https://interno.corp/x", keys: { p256dh: "a", auth: "b" } },
  ]
  const deleted: string[] = []
  const enviados: string[] = []
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
        enviados.push(sub.endpoint)
        if (sub.endpoint.endsWith("gone")) return "gone"
        if (sub.endpoint.endsWith("boom")) throw new Error("red caída")
        return "sent"
      },
    },
  }
  const sent = await sendPushToUser(deps, "u1", { title: "t", body: "b" })
  assert.equal(sent, 1)
  assert.deepEqual(deleted, [fcm("gone")]) // el fallo transitorio NO borra
  assert.deepEqual(enviados.toSorted(), [fcm("boom"), fcm("gone"), fcm("ok")]) // el host ajeno, nunca
})
