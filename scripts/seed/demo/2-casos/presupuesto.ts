// Presupuesto de la cuenta demo: lo que se mira en el Inicio y en el plan del mes.
//   - Vivienda con tope y un arriendo recurrente por cobrar: el «quedan» y el ritmo lo descuentan.
//   - Un gasto sin categoría: sube «Gastado» aunque no tenga tope (WDC-171).
//   - Mascotas sin tope: su gasto cuenta en «Gastado» pero no en ninguna barra.
//   - Suscripciones con el ritmo apagado y Supermercado con ritmo, las dos con gasto de hoy.
//   - Planes distintos por modo: calendario y ciclo de tarjeta con su propio tope e ingreso.
//   - Dos cargos de tarjeta a los dos lados del último cierre (presupuesto por ciclo).
//   - Un reembolso con suplemento del período.
//   - El mes anterior cerrado $150.000 por sobre el tope (deuda que el plan ofrece descontar).
import type { DemoContext } from "../1-base/cuenta-demo.ts"
import { todayKey } from "../../../../arch/shared/today.ts"
import { estimateClosing, periodOfDay } from "../../../../arch/shared/billing-cycle.ts"
import { budgetPeriodSettings } from "../../../../arch/v1/infrastructure/database/prisma/budget-period.infrastructure.ts"

const MODES = ["calendar", "card_cycle"] as const

export async function seed(ctx: DemoContext) {
  const { prisma, userId, checkingId, creditCardId, nationalBucketId, categoryId } = ctx
  const day = todayKey()
  const hoy = new Date(`${day}T00:00:00Z`)
  const year = hoy.getUTCFullYear()
  const month = hoy.getUTCMonth() + 1
  const cat = (name: string) => {
    const id = categoryId.get(name)
    if (!id) throw new Error(`no existe la categoría "${name}"`)
    return id
  }
  const gasto = (data: { categoryId: string | null; description: string; amount: number; accountId?: string; date?: Date; bucketId?: string }) =>
    prisma.transaction.create({
      data: {
        userId,
        accountId: data.accountId ?? checkingId,
        categoryId: data.categoryId,
        bucketId: data.bucketId ?? null,
        transactionDate: data.date ?? hoy,
        description: data.description,
        amount: data.amount,
        currency: "CLP",
        direction: "debit",
        reviewed: data.categoryId !== null,
      },
    })

  // Vivienda: tope $500.000, arriendo de $400.000 el día 28 (por cobrar) y $18.000 gastados hoy.
  const vivienda = await prisma.category.create({
    data: {
      userId, name: "Vivienda", type: "expense", icon: "House", color: "#f97316",
      description: "Arriendo, dividendo y arreglos de la casa.",
      limits: { create: MODES.map((mode) => ({ mode, year, month, limitAmount: 500000 })) },
    },
  })
  categoryId.set("Vivienda", vivienda.id)
  await prisma.recurringTemplate.create({
    data: {
      userId, accountId: checkingId, categoryId: vivienda.id, label: "Arriendo",
      description: "TRANSF ARRIENDO DEPTO PROVIDENCIA", direction: "debit", baseAmount: 400000,
      currency: "CLP", dayOfMonth: 28, startDate: new Date(Date.UTC(year, month - 1, 1)),
    },
  })
  await gasto({ categoryId: vivienda.id, description: "Pago:sodimac ampolletas", amount: 18000 })

  // Sin categoría y sin tope: los dos suben «Gastado».
  await gasto({ categoryId: null, description: "MERCPAGO*TIENDA ONLINE", amount: 15990 })
  const mascotas = await prisma.category.create({
    data: { userId, name: "Mascotas", type: "expense", icon: "PawPrint", color: "#a3e635",
      description: "Comida, veterinario y accesorios de la mascota." },
  })
  await gasto({ categoryId: mascotas.id, description: "Pago:superzoo", amount: 22500 })

  // Ritmo: apagado en Suscripciones, encendido en Supermercado.
  await prisma.category.update({ where: { id: cat("Suscripciones"), userId }, data: { paceEnabled: false } })
  await gasto({ categoryId: cat("Suscripciones"), description: "Pago:netflix.com anual", amount: 38000 })
  await gasto({ categoryId: cat("Supermercado"), description: "Pago:jumbo costanera", amount: 95000 })

  // Planes por modo: cada uno con su tope global, su tope de Supermercado y su ingreso.
  const income = await prisma.income.findFirstOrThrow({ where: { userId } })
  for (const [mode, globalLimit, limitAmount, amount] of [
    ["calendar", 1500000, 200000, 1400000],
    ["card_cycle", 1800000, 400000, 2000000],
  ] as const) {
    await prisma.monthlyBudget.upsert({
      where: { userId_mode_year_month: { userId, mode, year, month } },
      create: { userId, mode, year, month, globalLimit }, update: { globalLimit },
    })
    await prisma.categoryLimit.upsert({
      where: { categoryId_mode_year_month: { categoryId: cat("Supermercado"), mode, year, month } },
      create: { categoryId: cat("Supermercado"), mode, year, month, limitAmount }, update: { limitAmount },
    })
    await prisma.incomeAmount.upsert({
      where: { incomeId_mode_year_month: { incomeId: income.id, mode, year, month } },
      create: { incomeId: income.id, mode, year, month, amount }, update: { amount },
    })
  }

  // Ciclo de tarjeta: el cargo del día del último cierre es del mes que ese cierre factura; el del
  // día siguiente ya es del mes que viene.
  const actual = periodOfDay(day, "card_cycle", {})
  const anterior = actual.month === 1 ? { year: actual.year - 1, month: 12 } : { year: actual.year, month: actual.month - 1 }
  const cierre = new Date(`${estimateClosing(anterior.year, anterior.month)}T00:00:00Z`)
  const siguiente = new Date(cierre.getTime() + 86_400_000)
  for (const [description, amount, date] of [
    ["Pago:ticketmaster chile", 40000, cierre],
    ["Pago:ripley costanera", 70000, siguiente],
  ] as const)
    await gasto({ categoryId: cat("Compras"), description, amount, date, accountId: creditCardId, bucketId: nationalBucketId })

  // Reembolso con suplemento: la cena de $60.000 se paga entera y los $20.000 recibidos suben el
  // disponible de Compras solo en este período.
  const abono = await prisma.category.create({ data: { userId, name: "Abono de terceros", type: "income" } })
  const cena = await gasto({ categoryId: cat("Compras"), description: "Cena demo compartida", amount: 60000 })
  const credito = await prisma.transaction.create({
    data: {
      userId, accountId: checkingId, categoryId: abono.id, transactionDate: hoy,
      description: "Transferencia demo recibida", amount: 20000, currency: "CLP", direction: "credit", reviewed: true,
    },
  })
  const { overrides } = await budgetPeriodSettings(prisma)
  await prisma.expenseReimbursement.create({
    data: {
      userId, expenseId: cena.id, creditId: credito.id, amount: 20000,
      budgetEffects: {
        create: MODES.map((mode) => ({ categoryId: cat("Compras"), mode, ...periodOfDay(day, mode, overrides), treatment: "automatic" })),
      },
    },
  })

  // Mes anterior sobregirado: el tope se fija $150.000 bajo lo que se gastó (calendario), así la
  // deuda es siempre la misma corra el seed el día que corra.
  const prev = new Date(Date.UTC(year, month - 2, 1))
  const prevYear = prev.getUTCFullYear()
  const prevMonth = prev.getUTCMonth() + 1
  const gastado = await prisma.transaction.aggregate({
    _sum: { amount: true },
    where: {
      userId, direction: "debit", isInternal: false, currency: "CLP", status: "confirmed",
      transactionDate: { gte: prev, lt: new Date(Date.UTC(year, month - 1, 1)) },
    },
  })
  const globalLimit = Math.max(0, Number(gastado._sum.amount ?? 0) - 150000)
  for (const mode of MODES)
    await prisma.monthlyBudget.upsert({
      where: { userId_mode_year_month: { userId, mode, year: prevYear, month: prevMonth } },
      create: { userId, mode, year: prevYear, month: prevMonth, globalLimit }, update: { globalLimit },
    })

  console.log(
    `[seed] Presupuesto: Vivienda $500.000 con arriendo $400.000 por cobrar; gasto sin categoría $15.990; ` +
      `${prevMonth}/${prevYear} cerró $150.000 por sobre el tope (calendario).`
  )
}
