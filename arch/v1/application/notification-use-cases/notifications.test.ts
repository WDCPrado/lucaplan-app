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
import {
  notifyBudgetCrossing,
  notifyImportedMovements,
} from "./notify-imported-use-case.ts"
import {
  periodRange,
  type PeriodMode,
  type PeriodRange,
} from "../../../shared/billing-cycle.ts"
import { inRange } from "../finance-use-cases/budget-formulas.ts"
import {
  budgetAlertMessage,
  dueSoonMessage,
  newMovementsMessage,
  welcomeMessage,
} from "./notification-rules.ts"
import {
  sendPushToDevice,
  sendPushToUser,
  subscribeToPush,
} from "./push-use-cases.ts"

const JULIO = { year: 2026, month: 7, range: periodRange(2026, 7, "calendar", {}) }

const mov = (
  description: string,
  amount: number,
  direction: "debit" | "credit" = "debit"
) => ({ description, amount, currency: "CLP" as const, direction })

test("un movimiento se nombra; varios se resumen; ninguno no notifica", () => {
  assert.equal(newMovementsMessage([]), null)
  const one = newMovementsMessage([mov("Uber Eats", 12990)])
  // Sin categoría: el título no inventa una y el cuerpo dice qué hacer.
  assert.equal(one?.title, "Gasto de $12.990")
  // Sin id el aviso lleva a la lista, no a un modal: no puede decir "tócalo para clasificarlo".
  assert.equal(one?.body, "Uber Eats. Sin categoría: revísalo en tus movimientos.")
  // Con categoría asignada, el título la nombra junto al monto.
  const conCategoria = newMovementsMessage([
    { ...mov("Uber Eats", 12990), category: "Comida" },
  ])!
  assert.equal(conCategoria.title, "Gasto de $12.990 en Comida")
  assert.equal(conCategoria.body, "Uber Eats.")
  // Con el id del movimiento, el aviso enlaza directo a su modal; sin él, a la lista.
  const conId = newMovementsMessage([{ ...mov("Uber Eats", 12990), id: "tx1" }])!
  assert.equal(conId.url, "/dashboard?tx=tx1")
  assert.equal(conId.body, "Uber Eats. Sin categoría: tócalo para clasificarlo.")
  assert.equal(one!.url, "/movements")
  const many = newMovementsMessage([
    mov("Uber Eats", 12990),
    mov("Copec", 20000),
    mov("Sueldo", 900000, "credit"),
  ])
  assert.equal(many?.title, "3 movimientos nuevos")
  // Solo los gastos llevan monto: los abonos no se muestran en la pantalla bloqueada.
  assert.equal(many?.body, "Gastos por $32.990.")
  // Solo abonos: frase sin montos.
  assert.equal(
    newMovementsMessage([mov("Sueldo", 900000, "credit"), mov("Reembolso", 5000, "credit")])!
      .body,
    "Revisa tus movimientos."
  )
  assert.equal(many?.url, "/movements")
  // CLP y USD nunca se suman: cada moneda con su total.
  assert.equal(
    newMovementsMessage([
      { ...mov("Netflix", 19.1), currency: "USD" },
      mov("Copec", 20000),
    ])!.body,
    "Gastos por US$19,10 y $20.000."
  )
})

const COMIDA = { id: "cat1", name: "Comida" }

test("la alerta de presupuesto solo se dispara al CRUZAR el umbral de la categoría", () => {
  const P = [80, 100] // umbrales configurados: valen para TODAS las categorías
  // Cruza el 80% de Comida: 70k → 85k sobre un límite de 100k. El título nombra la categoría y
  // reporta el gasto REAL (85%), no el umbral que lo gatilló (80%).
  const aviso = budgetAlertMessage(COMIDA, 70_000, 85_000, 100_000, P)!
  assert.match(aviso.title, /Comida.*85%/)
  assert.equal(aviso.body, "Llevas $85.000 de $100.000; te quedan $15.000 este mes.")
  assert.equal(aviso.tag, "budget:cat1") // una notificación viva por categoría
  assert.equal(aviso.url, "/movements?categoryId=cat1") // los gastos de esa categoría
  // Ya estaba sobre el 80%: no se repite.
  assert.equal(budgetAlertMessage(COMIDA, 85_000, 90_000, 100_000, P), null)
  // Cruza el 100% (gana el umbral más alto aunque cruce ambos) y reporta el % real, no el umbral.
  const pasada = budgetAlertMessage(COMIDA, 70_000, 125_000, 100_000, P)!
  assert.match(pasada.title, /te pasaste.*125%/)
  assert.match(pasada.body, /te pasaste por \$25\.000/)
  // Justo en el 100% no es sobrepaso: se completó.
  assert.match(
    budgetAlertMessage(COMIDA, 70_000, 100_000, 100_000, P)!.title,
    /presupuesto completo/
  )
  // El título decide con los montos, no con el % redondeado: 996 de 1.000 redondea a 100% pero
  // no está completo; 1.004 redondea a 100% pero sí se pasó.
  const casi = budgetAlertMessage(COMIDA, 700, 996, 1_000, P)!
  assert.equal(casi.title, "Comida: 100% del presupuesto")
  assert.match(casi.body, /te quedan \$4 este mes/)
  const apenas = budgetAlertMessage(COMIDA, 700, 1_004, 1_000, P)!
  assert.equal(apenas.title, "Comida: te pasaste (100%)")
  assert.match(apenas.body, /te pasaste por \$4\./)
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
        { id: "cat1", userId: "u1", name: "Comida", type: "expense" as const, icon: null, color: null, description: null, paceEnabled: true },
        { id: "cat2", userId: "u1", name: "Transporte", type: "expense" as const, icon: null, color: null, description: null, paceEnabled: true },
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
    JULIO,
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
    JULIO,
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
    JULIO,
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
  assert.equal(many?.title, "2 pagos vencen en los próximos 2 días")
  assert.equal(many?.body, "Suman $20.000. Toca para verlos.")
  assert.equal(uno.body, "Pago de $15.000. Toca para ver tus recurrentes.")

  // Cuotas: el aviso lleva a su página. Mezcladas con una recurrente, gana /recurring.
  const cuota = item("TV (cuota 2/12)", "2026-07-29", 30000, "installment")
  assert.equal(dueSoonMessage([cuota], now)!.url, "/recurring#cuotas")
  assert.equal(
    dueSoonMessage([cuota, item("Netflix", "2026-07-29")], now)!.url,
    "/recurring"
  )
})

test("todos los avisos tienen la misma forma: corta, sin emojis, con tag y destino", () => {
  const now = new Date("2026-07-28T12:00:00Z")
  const largo = "Supermercado Líder Express Avenida Apoquindo 4500 Las Condes Santiago"
  const avisos = [
    welcomeMessage(),
    newMovementsMessage([{ ...mov(largo, 1_234_567), category: largo }])!,
    newMovementsMessage([mov(largo, 1_234_567)])!,
    newMovementsMessage([mov(largo, 1_234_567, "credit")])!,
    newMovementsMessage([
      mov("a", 1_234_567),
      { ...mov("b", 1234.56), currency: "USD" as const },
      mov("c", 9_999_999, "credit"),
      { ...mov("d", 9999.99, "credit"), currency: "USD" as const },
    ])!,
    budgetAlertMessage({ id: "c", name: largo }, 0, 85_000, 100_000, [80])!,
    budgetAlertMessage({ id: "c", name: largo }, 0, 100_000, 100_000, [80])!,
    budgetAlertMessage({ id: "c", name: largo }, 0, 13_900_000, 100_000, [80])!,
    dueSoonMessage(
      [{ description: `${largo} (cuota 2/12)`, amount: 1_234_567, currency: "CLP", dueDate: now, kind: "installment" }],
      now
    )!,
    dueSoonMessage(
      [
        { description: "a", amount: 1_234_567, currency: "CLP", dueDate: now, kind: "recurring" },
        { description: "b", amount: 19.1, currency: "USD", dueDate: now, kind: "recurring" },
      ],
      now,
      14
    )!,
  ]
  for (const a of avisos) {
    assert.ok(a.title.length <= 40, `título largo: ${a.title}`)
    assert.ok(a.body.length <= 90, `cuerpo largo: ${a.body}`)
    assert.match(a.body, /[.…]$/, `el cuerpo es una oración: ${a.body}`)
    assert.doesNotMatch(`${a.title}${a.body}`, /\p{Extended_Pictographic}/u)
    assert.ok(a.tag, "sin tag los avisos se apilan")
    assert.match(a.url ?? "", /^\//)
  }
  // El nombre largo de la categoría se recorta, el porcentaje no se pierde.
  assert.match(avisos[5].title, /…: 85% del presupuesto$/)
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

// --- Modo tarjeta: los avisos de lo importado miran el ciclo en curso ---
// Cierre estimado de septiembre 2026: 22/09. En modo tarjeta octubre va del 23/09 al 22/10.
function importedDeps(txs: Transaction[], mode: PeriodMode) {
  const enviados: PushMessage[] = []
  const deps = {
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
      send: async (_s: PushSubscription, m: PushMessage): Promise<PushSendResult> => {
        enviados.push(m)
        return "sent"
      },
    },
    // Repo fiel: devuelve solo lo que cae en el rango pedido.
    transactions: {
      listByUserPeriod: async (_u: string, range: PeriodRange) =>
        txs.filter((t) => inRange(t.date, range)),
    },
    categories: {
      listByUser: async () => [
        { id: "cat1", userId: "u1", name: "Comida", type: "expense" as const, icon: null, color: null, description: null, paceEnabled: true },
      ],
      listLimitsByUser: async () => [
        { id: "l1", userId: "u1", categoryId: "cat1", year: 2026, month: 9, limit: Money.of(100_000, "CLP") },
      ],
    },
    budgetAlerts: { list: async () => [{ id: "a1", percent: 80 }] },
    budgetPeriod: {
      get: async () => ({ mode, overrides: {} }),
      setMode: async () => {},
      setClosing: async () => {},
    },
  }
  return { deps, enviados }
}

const gasto = (id: string, iso: string, amount: number, externalId: string | null = null): Transaction => ({
  id,
  userId: "u1",
  accountId: "cc",
  categoryId: "cat1",
  date: new Date(`${iso}T00:00:00Z`),
  description: id,
  amount: Money.of(amount, "CLP"),
  direction: "debit",
  status: "confirmed",
  isInternal: false,
  externalId,
})

test("modo tarjeta: un gasto del 25/09 cruza el umbral de octubre, no el de septiembre", async () => {
  const txs = [
    gasto("sept", "2026-09-10", 90_000), // ciclo de septiembre en modo tarjeta
    gasto("viejo", "2026-09-24", 70_000), // ya en octubre
    gasto("nuevo", "2026-09-25", 15_000, "ext-25"),
  ]
  const importado = [
    { ...mov("nuevo", 15_000), externalId: "ext-25", date: new Date("2026-09-25T00:00:00Z") },
  ]
  // 26/09 a mediodía en Santiago.
  const ahora = new Date("2026-09-26T15:00:00Z")

  const tarjeta = importedDeps(txs, "card_cycle")
  await notifyImportedMovements(tarjeta.deps, "u1", importado, ahora)
  // Aviso del movimiento + alerta: octubre pasa de 70k a 85k sobre un tope de 100k.
  assert.equal(tarjeta.enviados.length, 2)
  assert.match(tarjeta.enviados[1].title, /Comida.*85%/)

  // En modo débito es septiembre: 160k ya estaba sobre el 80%, así que no cruza nada nuevo.
  const debito = importedDeps(txs, "calendar")
  await notifyImportedMovements(debito.deps, "u1", importado, ahora)
  assert.equal(debito.enviados.length, 1)
})

test("modo tarjeta: el cargo del día del cierre que llega al día siguiente conserva categoría y enlace", async () => {
  const txs = [gasto("cierre", "2026-09-22", 5_000, "ext-22")]
  const { deps, enviados } = importedDeps(txs, "card_cycle")
  await notifyImportedMovements(
    deps,
    "u1",
    [{ ...mov("cierre", 5_000), externalId: "ext-22", date: new Date("2026-09-22T00:00:00Z") }],
    new Date("2026-09-23T15:00:00Z") // ya es el ciclo de octubre
  )
  assert.equal(enviados[0].url, "/dashboard?tx=cierre")
  assert.match(enviados[0].title, /en Comida$/)
})
