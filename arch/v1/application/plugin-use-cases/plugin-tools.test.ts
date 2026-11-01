// WDC-117. Runner del plugin: puertos en memoria, sin base, HTTP ni reglas financieras duplicadas.
// Firma acordada con el orquestador; el adapter executor conecta los casos de uso existentes.
import { test } from "node:test"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import type {
  PluginActor,
  PluginJsonValue,
  PluginOperation,
  PluginOperationKey,
  PluginOperationStore,
} from "../../domain/plugin/plugin.domain.ts"
import type { PluginToolName } from "../../../../lib/schemas/plugin.ts"

type Executor = {
  execute(
    actor: PluginActor,
    toolName: PluginToolName,
    args: Record<string, unknown>
  ): Promise<PluginJsonValue>
}
type Deps = {
  operations: PluginOperationStore
  executor: Executor
  hash(input: string): string
}
// URL dinámica permite que cada escenario muestre rojo por el módulo faltante sin inventar
// una declaración de producto ni esconder errores de tipos del propio test.
const runnerUrl = new URL("./plugin-tools.ts", import.meta.url)
async function run(
  deps: Deps,
  actor: PluginActor,
  tool: string,
  args: unknown
) {
  const runner: {
    executePluginTool(
      deps: Deps,
      actor: PluginActor,
      tool: string,
      args: unknown
    ): Promise<PluginJsonValue>
  } = await import(runnerUrl.href)
  return runner.executePluginTool(deps, actor, tool, args)
}

const actor: PluginActor = {
  userId: "usuario-willy",
  clientId: "cliente-chat",
  scopes: ["finance:read", "finance:write"],
}
const key = (operationId: string, owner = actor): PluginOperationKey => ({
  userId: owner.userId,
  clientId: owner.clientId,
  operationId,
})
const keyText = (value: PluginOperationKey) =>
  JSON.stringify([value.userId, value.clientId, value.operationId])

class MemoryOperations implements PluginOperationStore {
  records = new Map<string, PluginOperation>()
  claims = 0
  failFinish = false
  async claim(
    input: PluginOperationKey & { toolName: string; inputHash: string }
  ) {
    this.claims++
    const previous = this.records.get(keyText(input))
    if (previous) return { claimed: false as const, operation: previous }
    const operation: PluginOperation = {
      ...input,
      status: "pending",
      result: null,
      createdAt: new Date("2026-01-01T12:00:00Z"),
      updatedAt: new Date("2026-01-01T12:00:00Z"),
      finishedAt: null,
    }
    // Antes del primer await: reproduce el contrato atómico de claim.
    this.records.set(keyText(input), operation)
    return { claimed: true as const, operation }
  }
  async get(input: PluginOperationKey) {
    return this.records.get(keyText(input)) ?? null
  }
  async release(input: PluginOperationKey) {
    if (this.records.get(keyText(input))?.status === "pending")
      this.records.delete(keyText(input))
  }
  async finish(
    input: PluginOperationKey,
    outcome: Parameters<PluginOperationStore["finish"]>[1]
  ) {
    if (this.failFinish) throw new Error("almacenamiento no disponible")
    const existing = await this.get(input)
    if (!existing || existing.status !== "pending") return false
    this.records.set(keyText(input), {
      ...existing,
      ...outcome,
      updatedAt: new Date("2026-01-01T12:01:00Z"),
      finishedAt: new Date("2026-01-01T12:01:00Z"),
    })
    return true
  }
}

function setup(result: PluginJsonValue = { id: "resultado-1" }) {
  const operations = new MemoryOperations()
  const calls: {
    actor: PluginActor
    tool: PluginToolName
    args: Record<string, unknown>
  }[] = []
  const executor: Executor = {
    async execute(owner, tool, args) {
      calls.push({ actor: owner, tool, args })
      return result
    },
  }
  return {
    operations,
    calls,
    deps: {
      operations,
      executor,
      hash: (input: string) => createHash("sha256").update(input).digest("hex"),
    } satisfies Deps,
  }
}
const category = (operationId: string) => ({
  operationId,
  name: "Mascotas",
  type: "expense",
  icon: null,
  color: null,
  description: "Veterinario y alimento",
})

test("reembolso: repetir operationId devuelve el recibo sin volver a ejecutar el aumento", async () => {
  const result = { reimbursementId: "refund", created: true, budgetAdjustment: { applied: true, amount: 20000 } }
  const { deps, calls } = setup(result)
  const input = { expenseId: "expense", creditId: "credit", amount: 20000, operationId: "refund-operation" }
  assert.deepEqual(await run(deps, actor, "lucaplan_vincular_reembolso", input), result)
  assert.deepEqual(await run(deps, actor, "lucaplan_vincular_reembolso", input), result)
  assert.equal(calls.length, 1)
  await assert.rejects(run(deps, actor, "lucaplan_vincular_reembolso", { ...input, amount: 10000 }))
  assert.equal(calls.length, 1)
})
const snapshot = (operationId: string) => ({
  operationId,
  linkId: "banco-conectado",
  snapshotAt: "2001-01-01T12:00:00-03:00",
  checking: {
    ref: "12345678",
    cash: 120000,
    overdraft: { limit: 50000, used: 0 },
  },
  cards: [
    {
      last4: "4321",
      national: { limit: 100000, used: 100000 },
      international: { limit: 100.01, used: 0.01 },
    },
  ],
})
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

// h1 — Sin pantalla.
test("Dado un acceso autorizado, cuando el consultor consulta o modifica mis finanzas, entonces exige el permiso de esa acción y usa la identidad verificada", async () => {
  const { deps, calls, operations } = setup()
  const reader = { ...actor, scopes: ["finance:read"] }
  await run(deps, reader, "lucaplan_listar_cuentas", {})
  assert.deepEqual(calls[0].actor, reader)
  assert.equal(operations.claims, 0, "leer no crea recibos de escritura")
  await assert.rejects(() =>
    run(deps, reader, "lucaplan_crear_categoria", category("sin-permiso"))
  )
  await assert.rejects(() =>
    run(
      deps,
      { ...actor, scopes: ["finance:write"] },
      "lucaplan_listar_cuentas",
      {}
    )
  )
  for (const invalidActor of [
    { ...actor, userId: "" },
    { ...actor, clientId: "" },
    { ...actor, scopes: [] },
  ]) {
    await assert.rejects(() =>
      run(
        deps,
        invalidActor,
        "lucaplan_crear_categoria",
        category("sin-identidad")
      )
    )
  }
  assert.equal(
    calls.length,
    1,
    "una solicitud rechazada nunca llega al caso financiero"
  )
  assert.equal(operations.claims, 0)
  await run(
    deps,
    { ...actor, scopes: ["finance:write"] },
    "lucaplan_crear_categoria",
    category("permitida")
  )
  assert.deepEqual(calls[1].actor, { ...actor, scopes: ["finance:write"] })
})

// h2 — Sin pantalla.
test("Dado un chat conectado a mi cuenta, cuando pide otra identidad o una herramienta no ofrecida, entonces se rechaza antes de consultar o cambiar datos", async () => {
  const { deps, calls, operations } = setup()
  await run(deps, actor, "lucaplan_listar_categorias", {})
  for (const extra of [
    { userId: "otro" },
    { email: "otro@example.test" },
    { scopes: ["finance:write"] },
  ]) {
    await assert.rejects(() =>
      run(deps, actor, "lucaplan_crear_categoria", {
        ...category("inyeccion"),
        ...extra,
      })
    )
  }
  for (const name of [
    "lucaplan_cambiar_configuracion_global",
    "lucaplan_ejecutar_sql",
    "toString",
    "__proto__",
    "",
  ]) {
    await assert.rejects(() => run(deps, actor, name, {}))
  }
  await assert.rejects(() =>
    run(deps, actor, "lucaplan_reconciliar_saldos_correo", {
      ...snapshot("identidad-anidada"),
      checking: { ...snapshot("x").checking, userId: "otro" },
    })
  )
  assert.equal(
    calls.length,
    1,
    "solo la consulta válida de control llegó al ejecutor"
  )
  assert.equal(operations.claims, 0)
})

// h3 — Sin pantalla; los bordes de paginación pertenecen a esta regla.
test("Dado que busco movimientos, cuando indico filtros y tamaño de página, entonces se conservan juntos y solo se admiten páginas de 1 a 100 con desplazamiento no negativo", async () => {
  const { deps, calls } = setup({ items: [], nextOffset: null })
  await run(deps, actor, "lucaplan_buscar_movimientos", {})
  assert.deepEqual(calls[0].args, { offset: 0, limit: 50 })
  const filters = {
    query: "Veterinario",
    direction: "debit",
    categoryId: "mascotas",
    bankName: "Banco de Chile",
    from: "2026-01-01",
    to: "2026-01-31",
    amountMin: 0,
    amountMax: 25000,
    uncategorized: false,
    settledOnly: true,
    offset: 100,
    limit: 100,
  }
  await run(deps, actor, "lucaplan_buscar_movimientos", filters)
  assert.deepEqual(calls[1].args, filters)
  await run(deps, actor, "lucaplan_buscar_movimientos", { limit: 1, offset: 0 })
  const beforeInvalid = calls.length
  for (const args of [
    { limit: 0 },
    { limit: 101 },
    { limit: 1.5 },
    { offset: -1 },
    { offset: 0.5 },
    { query: "x".repeat(501) },
    { from: "2026-02-30" },
  ]) {
    await assert.rejects(() =>
      run(deps, actor, "lucaplan_buscar_movimientos", args)
    )
  }
  assert.equal(calls.length, beforeInvalid)
})

// h4 — Sin pantalla; bordes de moneda, cupo y fecha en la misma regla de documento válido.
test("Dado un documento del banco, cuando envío sus saldos, entonces rechaza fechas futuras y cupos imposibles y conserva CLP y USD separados", async () => {
  const { deps, calls, operations } = setup()
  const valid = snapshot("documento-valido")
  await run(deps, actor, "lucaplan_reconciliar_saldos_correo", valid)
  const expected = { ...valid } as Record<string, unknown>
  delete expected.operationId
  assert.deepEqual(calls[0].args, expected)
  assert.equal(
    (await operations.get(key(valid.operationId)))?.status,
    "completed"
  )
  const invalidSnapshots = [
    { ...snapshot("futura"), snapshotAt: "2099-01-01T12:00:00Z" },
    { ...snapshot("clp-decimal"), checking: { ...valid.checking, cash: 0.01 } },
    { ...snapshot("clp-negativo"), checking: { ...valid.checking, cash: -1 } },
    {
      ...snapshot("exceso"),
      cards: [{ ...valid.cards[0], national: { limit: 100000, used: 100001 } }],
    },
    {
      ...snapshot("usd-decimal"),
      cards: [
        { ...valid.cards[0], international: { limit: 100, used: 0.001 } },
      ],
    },
    { ...snapshot("claves"), cards: [{ ...valid.cards[0], userId: "otro" }] },
  ]
  for (const invalid of invalidSnapshots) {
    await assert.rejects(() =>
      run(deps, actor, "lucaplan_reconciliar_saldos_correo", invalid)
    )
  }
  assert.equal(calls.length, 1)
  assert.equal(operations.claims, 1, "rechaza antes de reservar una operación")
})

// h5 — Sin pantalla.
test("Dado un cambio ya completado, cuando el chat lo repite con la misma clave y datos, entonces devuelve el resultado guardado sin cambiar mis finanzas otra vez", async () => {
  const { deps, calls, operations } = setup({
    id: "categoria-mascotas",
    created: true,
  })
  const input = category("crear-mascotas")
  const first = await run(deps, actor, "lucaplan_crear_categoria", input)
  // La semántica no cambia al reordenar claves o normalizar el nombre según el esquema.
  const repeated = {
    description: input.description,
    color: null,
    icon: null,
    type: input.type,
    name: "  Mascotas  ",
    operationId: input.operationId,
  }
  assert.deepEqual(
    await run(deps, actor, "lucaplan_crear_categoria", repeated),
    first
  )
  assert.equal(calls.length, 1)
  assert.equal(Object.hasOwn(calls[0].args, "operationId"), false)
  const receipt = await operations.get(key(input.operationId))
  assert.equal(receipt?.status, "completed")
  assert.deepEqual(receipt?.result, first)
})

// h6 — Sin pantalla.
test("Dado una clave usada para crear Mascotas, cuando el chat cambia los datos o pide otra acción con esa clave, entonces informa el conflicto sin ejecutar el cambio", async () => {
  const { deps, calls } = setup()
  await run(deps, actor, "lucaplan_crear_categoria", category("clave-ocupada"))
  await assert.rejects(() =>
    run(deps, actor, "lucaplan_crear_categoria", {
      ...category("clave-ocupada"),
      name: "Comida",
    })
  )
  await assert.rejects(() =>
    run(deps, actor, "lucaplan_eliminar_categoria", {
      operationId: "clave-ocupada",
      categoryId: "mascotas",
    })
  )
  assert.equal(calls.length, 1)
})

// h7 — Sin pantalla.
test("Dado dos pedidos simultáneos para el mismo cambio, cuando compiten por su clave, entonces solo uno modifica mis finanzas y el otro espera una comprobación del estado", async () => {
  const { deps, operations } = setup()
  const entered = deferred()
  const release = deferred()
  let writes = 0
  deps.executor.execute = async () => {
    writes++
    entered.resolve()
    await release.promise
    return { id: "una-sola-categoria" }
  }
  // El primer rechazo también libera el wait si aún falta el módulo.
  const first = run(
    deps,
    actor,
    "lucaplan_crear_categoria",
    category("simultanea")
  )
  const observed = first.catch((error: unknown) => {
    entered.resolve()
    throw error
  })
  // Evita rechazos sin observar mientras se comprueba el segundo pedido.
  void observed.catch(() => {})
  await entered.promise
  try {
    if (writes === 0) await observed
    await assert.rejects(() =>
      run(deps, actor, "lucaplan_crear_categoria", category("simultanea"))
    )
    assert.equal(writes, 1)
    assert.equal((await operations.get(key("simultanea")))?.status, "pending")
  } finally {
    release.resolve()
  }
  assert.deepEqual(await observed, { id: "una-sola-categoria" })
  assert.equal((await operations.get(key("simultanea")))?.status, "completed")
})

// h8 — Sin pantalla.
test("Dado un cambio pendiente, fallido o de resultado incierto, cuando vuelvo a pedirlo con la misma clave, entonces se conserva su estado y no se repite automáticamente", async () => {
  for (const status of ["pending", "uncertain", "failed"] as const) {
    const { deps, calls, operations } = setup()
    await run(deps, actor, "lucaplan_crear_categoria", category("no-repetir"))
    const receipt = await operations.get(key("no-repetir"))
    assert.ok(receipt)
    operations.records.set(keyText(key("no-repetir")), {
      ...receipt,
      status,
      result: null,
    })
    await assert.rejects(() =>
      run(deps, actor, "lucaplan_crear_categoria", category("no-repetir"))
    )
    assert.equal(calls.length, 1, status)
    assert.equal((await operations.get(key("no-repetir")))?.status, status)
  }
})

// h9 — Sin pantalla.
test("Dado un error después de iniciar un cambio, cuando no se puede asegurar qué se guardó, entonces queda incierto y el chat no recibe secretos ni detalles internos", async () => {
  const { deps, operations } = setup()
  const privateDetail = "postgresql://usuario:clave-SECRETA@db.interna/finanzas"
  let writes = 0
  deps.executor.execute = async () => {
    writes++
    throw new Error(privateDetail)
  }
  let caught: unknown
  try {
    await run(
      deps,
      actor,
      "lucaplan_crear_categoria",
      category("error-despues-de-escribir")
    )
  } catch (error) {
    caught = error
  }
  assert.ok(caught instanceof Error)
  assert.equal(String(caught).includes(privateDetail), false)
  const receipt = await operations.get(key("error-despues-de-escribir"))
  assert.equal(receipt?.status, "uncertain")
  assert.equal(JSON.stringify(receipt?.result).includes(privateDetail), false)
  await assert.rejects(() =>
    run(
      deps,
      actor,
      "lucaplan_crear_categoria",
      category("error-despues-de-escribir")
    )
  )
  assert.equal(writes, 1)
})

// h10 — Sin pantalla.
test("Dado una operación registrada desde mi chat, cuando otro usuario o cliente usa la misma clave, entonces no ve mi resultado y su operación permanece independiente", async () => {
  const { deps, calls } = setup({ id: "categoria-privada" })
  await run(deps, actor, "lucaplan_crear_categoria", category("misma-clave"))
  const mine = await run(deps, actor, "lucaplan_ver_operacion", {
    operationId: "misma-clave",
  })
  assert.ok(mine && typeof mine === "object" && !Array.isArray(mine))
  assert.equal(mine.status, "completed")
  assert.deepEqual(mine.result, { id: "categoria-privada" })
  for (const other of [
    { ...actor, userId: "otra-persona" },
    { ...actor, clientId: "otra-aplicacion" },
  ]) {
    assert.equal(
      await run(deps, other, "lucaplan_ver_operacion", {
        operationId: "misma-clave",
      }),
      null
    )
    await run(deps, other, "lucaplan_crear_categoria", category("misma-clave"))
    const theirs = await run(deps, other, "lucaplan_ver_operacion", {
      operationId: "misma-clave",
    })
    assert.ok(theirs && typeof theirs === "object" && !Array.isArray(theirs))
    assert.equal(theirs.status, "completed")
  }
  assert.equal(
    calls.length,
    3,
    "consultar recibos nunca llama al ejecutor financiero"
  )
  assert.deepEqual(
    calls.map((call) => [call.actor.userId, call.actor.clientId]),
    [
      [actor.userId, actor.clientId],
      ["otra-persona", actor.clientId],
      [actor.userId, "otra-aplicacion"],
    ]
  )
})

// h11 — Sin pantalla.
test("Dado un cambio ejecutado cuyo resultado no pudo guardarse, cuando el chat reintenta, entonces se bloquea otra ejecución para no duplicar el efecto financiero", async () => {
  const { deps, calls, operations } = setup()
  operations.failFinish = true
  await assert.rejects(() =>
    run(deps, actor, "lucaplan_crear_categoria", category("respuesta-perdida"))
  )
  assert.equal(calls.length, 1)
  operations.failFinish = false
  await assert.rejects(() =>
    run(deps, actor, "lucaplan_crear_categoria", category("respuesta-perdida"))
  )
  assert.equal(calls.length, 1)
  assert.notEqual(
    (await operations.get(key("respuesta-perdida")))?.status,
    "completed"
  )
})

// WDC-120 — Sin pantalla.
test("Dado un pago enganchado en la cuota equivocada, cuando el chat pide moverlo dos veces con la misma clave, entonces se mueve una sola vez y solo con permiso de escritura", async () => {
  const { deps, calls } = setup({ moved: true })
  const pedido = {
    operationId: "mover-cargo-265708",
    planId: "viaje-jo",
    itemId: "cuota-6",
    toPlanId: "credito-consumo",
    toItemId: "cuota-5",
  }
  await assert.rejects(() =>
    run(
      deps,
      { ...actor, scopes: ["finance:read"] },
      "lucaplan_mover_pago_cuota",
      pedido
    )
  )
  const first = await run(deps, actor, "lucaplan_mover_pago_cuota", pedido)
  const again = await run(deps, actor, "lucaplan_mover_pago_cuota", pedido)
  assert.deepEqual(again, first)
  assert.equal(calls.length, 1, "repetir la clave no mueve el pago otra vez")
  assert.equal(calls[0].tool, "lucaplan_mover_pago_cuota")
  assert.deepEqual(calls[0].args, {
    planId: pedido.planId,
    itemId: pedido.itemId,
    toPlanId: pedido.toPlanId,
    toItemId: pedido.toItemId,
  })
})

// Agente financiero — Sin pantalla.
test("Dado un cambio rechazado por una regla antes de escribir, cuando el chat lo corrige con la misma clave, entonces se ejecuta; un error tras empezar queda incierto", async () => {
  const { deps, operations } = setup({ id: "ok" })
  const { NotOwnerError } =
    await import("../../domain/finance/finance.domain.ts")
  let fail: Error | null = new NotOwnerError()
  deps.executor.execute = async () => {
    if (fail) throw fail
    return { id: "ok" }
  }
  await assert.rejects(
    run(deps, actor, "lucaplan_crear_categoria", category("rechazo")),
    /Rechazado sin cambios: .*no existe o no pertenece/
  )
  assert.equal(
    await operations.get(key("rechazo")),
    null,
    "el rechazo libera la clave"
  )
  fail = null
  assert.deepEqual(
    await run(deps, actor, "lucaplan_crear_categoria", {
      ...category("rechazo"),
      name: "Corregida",
    }),
    { id: "ok" }
  )
  fail = new Error("conexión cortada")
  await assert.rejects(
    run(deps, actor, "lucaplan_crear_categoria", category("incierto")),
    /Resultado incierto/
  )
  assert.equal((await operations.get(key("incierto")))?.status, "uncertain")
  await assert.rejects(
    run(deps, actor, "lucaplan_buscar_movimientos", { limit: 0 }),
    /limit: /,
    "el error de argumentos dice qué campo falló"
  )
})
