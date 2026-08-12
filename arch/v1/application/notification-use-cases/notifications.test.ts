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
import {
  sendPushToDevice,
  sendPushToUser,
  subscribeToPush,
} from "./push-use-cases.ts"

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
  // Sin categoría no queda separador huérfano al final.
  assert.doesNotMatch(one!.body, /·\s*$/)
  // Con categoría asignada, el aviso la nombra.
  assert.match(
    newMovementsMessage([{ ...mov("Uber Eats", 12990), category: "Comida" }])!
      .body,
    /Uber Eats · Comida/
  )
  // Con el id del movimiento, el aviso enlaza directo a su modal; sin él, al dashboard pelado.
  assert.equal(
    newMovementsMessage([{ ...mov("Uber Eats", 12990), id: "tx1" }])!.url,
    "/dashboard?tx=tx1"
  )
  assert.equal(one!.url, "/dashboard")
  const many = newMovementsMessage([
    mov("Uber Eats", 12990),
    mov("Copec", 20000),
    mov("Sueldo", 900000, "credit"),
  ])
  assert.equal(many?.title, "3 movimientos nuevos")
  assert.match(many!.body, /32\.990/) // solo gastos, el abono no suma
})

const COMIDA = { id: "cat1", name: "Comida" }

test("la alerta de presupuesto solo se dispara al CRUZAR el umbral de la categoría", () => {
  const P = [80, 100] // umbrales configurados: valen para TODAS las categorías
  // Cruza el 80% de Comida: 70k → 85k sobre un límite de 100k. El título nombra la categoría y
  // reporta el gasto REAL (85%), no el umbral que lo gatilló (80%).
  const aviso = budgetAlertMessage(COMIDA, 70_000, 85_000, 100_000, P)!
  assert.match(aviso.title, /Comida.*85%/)
  assert.equal(aviso.tag, "budget:cat1") // una notificación viva por categoría
  // Ya estaba sobre el 80%: no se repite.
  assert.equal(budgetAlertMessage(COMIDA, 85_000, 90_000, 100_000, P), null)
  // Cruza el 100% (gana el umbral más alto aunque cruce ambos) y reporta el % real, no el umbral.
  assert.match(
    budgetAlertMessage(COMIDA, 70_000, 125_000, 100_000, P)!.title,
    /te pasaste.*125%/
  )
  // Justo en el 100% no es sobrepaso: se completó.
  assert.match(
    budgetAlertMessage(COMIDA, 70_000, 100_000, 100_000, P)!.title,
    /presupuesto completo/
  )
  // Categoría sin límite: no hay porcentaje que cruzar.
  assert.equal(budgetAlertMessage(COMIDA, 0, 50_000, 0, P), null)
  // Sin umbrales configurados no se avisa nada.
  assert.equal(budgetAlertMessage(COMIDA, 0, 90_000, 100_000, []), null)
})

test("los umbrales son configurables: N y en cualquier orden", () => {
  const P = [100, 50, 90] // desordenados a propósito
  assert.match(
    budgetAlertMessage(COMIDA, 40_000, 55_000, 100_000, P)!.title,
    /55%/
  )
  // 50% y 90% se cruzan de una vez: un solo aviso, con el gasto real.
  assert.match(
    budgetAlertMessage(COMIDA, 40_000, 95_000, 100_000, P)!.title,
    /95%/
  )
  // Sin umbral de 100, saltar de 40% a 139% igual avisa (gatilla el 90) y dice 139%, no 90.
  assert.match(
    budgetAlertMessage(COMIDA, 40_000, 139_000, 100_000, [50, 90])!.title,
    /te pasaste.*139%/
  )
  // Ya sobre el 100%: el cruce ocurrió una vez, no se repite en cada gasto posterior.
  assert.equal(budgetAlertMessage(COMIDA, 110_000, 140_000, 100_000, P), null)
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
    categories: {
      listByUser: async () => [
        { id: "cat1", userId: "u1", name: "Comida", type: "expense" as const, icon: null, color: null, description: null },
        { id: "cat2", userId: "u1", name: "Transporte", type: "expense" as const, icon: null, color: null, description: null },
      ],
      listLimitsByUser: async () => [
        { id: "l1", userId: "u1", categoryId: "cat1", year: 2026, month: 7, limit: clp(100_000) },
        // cat2 sin límite: aunque se toque, no hay porcentaje que cruzar.
        { id: "l2", userId: "u1", categoryId: "cat2", year: 2026, month: 7, limit: clp(0) },
      ],
    },
    budgetAlerts: { list: async () => [{ id: "a1", percent: 80 }] },
  })

  // 70k ya categorizados en Comida + uno de 15k SIN categoría: el sin categoría no gasta todavía.
  const sinCategoria = tx({ id: "nuevo", amount: clp(15_000), categoryId: null })
  await notifyBudgetCrossing(
    deps([tx({ id: "viejo", amount: clp(70_000) }), sinCategoria]),
    "u1",
    2026,
    7,
    (t) => t.id === "nuevo"
  )
  assert.equal(enviados.length, 0)

  // Al categorizarlo entra al presupuesto de Comida: 70k → 85k cruza el 80% de su límite (100k).
  await notifyBudgetCrossing(
    deps([
      tx({ id: "viejo", amount: clp(70_000) }),
      tx({ id: "nuevo", amount: clp(15_000) }),
    ]),
    "u1",
    2026,
    7,
    (t) => t.id === "nuevo"
  )
  assert.equal(enviados.length, 1)
  assert.match(enviados[0].title, /Comida.*85%/)

  // Mover ese mismo gasto a Transporte (sin límite) no alerta, y Comida no se revisa: no la tocó.
  enviados.length = 0
  await notifyBudgetCrossing(
    deps([
      tx({ id: "viejo", amount: clp(70_000) }),
      tx({ id: "nuevo", amount: clp(15_000), categoryId: "cat2" }),
    ]),
    "u1",
    2026,
    7,
    (t) => t.id === "nuevo"
  )
  assert.equal(enviados.length, 0)
})

test("vencimientos: solo dentro de la ventana, en UTC", () => {
  const now = new Date("2026-07-28T12:00:00Z")
  const item = (
    description: string,
    day: string,
    amount = 15000,
    kind: "recurring" | "installment" = "recurring"
  ) => ({
    description,
    amount,
    currency: "CLP" as const,
    dueDate: new Date(`${day}T00:00:00Z`),
    kind,
  })
  assert.equal(dueSoonMessage([item("Netflix", "2026-08-05")], now), null) // fuera de ventana
  assert.equal(dueSoonMessage([item("Netflix", "2026-07-27")], now), null) // ya venció
  const uno = dueSoonMessage([item("Netflix", "2026-07-29")], now)!
  assert.match(uno.title, /Vence mañana: Netflix/)
  assert.equal(uno.url, "/recurring")
  const many = dueSoonMessage(
    [item("Netflix", "2026-07-28"), item("Spotify", "2026-07-30", 5000)],
    now
  )
  assert.equal(many?.title, "2 pagos por vencer")
  assert.match(many!.body, /20\.000/)

  // Cuotas: el aviso lleva a su página. Mezcladas con una recurrente, gana /recurring.
  const cuota = item("TV (cuota 2/12)", "2026-07-29", 30000, "installment")
  assert.equal(dueSoonMessage([cuota], now)!.url, "/installments")
  assert.equal(
    dueSoonMessage([cuota, item("Netflix", "2026-07-29")], now)!.url,
    "/recurring"
  )
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

test("la bienvenida suena solo en el dispositivo que se acaba de inscribir", async () => {
  const fcm = (path: string) => `https://fcm.googleapis.com/fcm/send/${path}`
  // El usuario ya tenía dos dispositivos activos; ahora inscribe el tercero.
  const yaInscritos: PushSubscription[] = [
    { userId: "u1", endpoint: fcm("viejo1"), keys: { p256dh: "a", auth: "b" } },
    { userId: "u1", endpoint: fcm("viejo2"), keys: { p256dh: "a", auth: "b" } },
  ]
  const enviados: string[] = []
  const deps = {
    subscriptions: {
      save: async () => {},
      deleteByEndpoint: async () => {},
      listByUser: async () => yaInscritos,
    },
    sender: {
      send: async (sub: PushSubscription): Promise<PushSendResult> => {
        enviados.push(sub.endpoint)
        return "sent"
      },
    },
  }
  const device = await subscribeToPush(deps, "u1", {
    endpoint: fcm("nuevo"),
    keys: { p256dh: "a", auth: "b" },
  })
  const sent = await sendPushToDevice(deps, device, { title: "t", body: "b" })
  assert.equal(sent, true)
  assert.deepEqual(enviados, [fcm("nuevo")]) // los ya inscritos, en silencio
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
