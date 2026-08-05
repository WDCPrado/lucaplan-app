// Datos falsos para los entornos EFÍMEROS de PR en Railway: cada PR levanta su propia base vacía,
// y sin datos no hay review posible (no hay con qué entrar ni qué mirar). Corre solo ahí: la guarda
// exige RAILWAY_ENVIRONMENT_NAME = "pr-*", que Railway únicamente inyecta en esos entornos.
// Idempotente: si el usuario demo ya existe no toca nada (SEED_PR_FORCE=1 lo re-siembra desde cero).

import { prDemoAccount } from "../lib/pr-demo.ts"

// Misma fuente que usa el login para ofrecer la cuenta: null fuera de un entorno de PR.
const demo = prDemoAccount()
if (!demo) {
  console.log(
    `[seed:pr] omitido — RAILWAY_ENVIRONMENT_NAME="${process.env.RAILWAY_ENVIRONMENT_NAME ?? ""}" no es un entorno de PR.`
  )
  process.exit(0)
}

// El registro cerrado (landing) desactiva signUpEmail al CONSTRUIR Better Auth, así que la variable
// se fuerza antes de importarlo; de ahí que estos dos imports sean dinámicos y no estáticos.
process.env.NEXT_PUBLIC_LANDING_ONLY = "false"
const { prisma } = await import(
  "../arch/v1/infrastructure/database/prisma/client.ts"
)
const { auth } = await import("../arch/v1/infrastructure/auth/auth.ts")

const { env: envName, email: EMAIL, password: PASSWORD } = demo

const now = new Date()
const year = now.getFullYear()
const month = now.getMonth() + 1
const today = now.getDate()
const prev = new Date(year, month - 2, 1) // mes anterior (month-1 en base 0, menos 1 mes)
const prevYear = prev.getFullYear()
const prevMonth = prev.getMonth() + 1

// [nombre, icono, color, límite del mes, descripción para la IA]
const EXPENSE_CATEGORIES: [string, string, string, number, string][] = [
  ["Supermercado", "ShoppingCart", "#f59e0b", 250000, "Compras de supermercado y almacén: Lider, Jumbo, Unimarc, ferias."],
  ["Comida", "UtensilsCrossed", "#ef4444", 120000, "Restaurantes, delivery y cafés: Rappi, Uber Eats, PedidosYa."],
  ["Transporte", "Bus", "#38bdf8", 80000, "Micro, metro, Uber, bencina, TAG y estacionamientos."],
  ["Suscripciones", "CreditCard", "#8b5cf6", 45000, "Servicios mensuales: streaming, música, nube, gimnasio."],
  ["Cuentas", "Receipt", "#0ea5e9", 180000, "Servicios básicos del hogar: luz, agua, gas, internet, gastos comunes."],
  ["Salud", "HeartPulse", "#22c55e", 60000, "Farmacia, consultas médicas, dentista, exámenes."],
  ["Compras", "ShoppingBag", "#ec4899", 90000, "Ropa, tecnología y compras del hogar que no son del mes a mes."],
  ["Entretención", "Popcorn", "#a855f7", 55000, "Cine, panoramas, salidas y hobbies."],
]

// [día, descripción, monto, categoría (null = queda para el triage), dirección]
const MOVEMENTS: [number, string, number, string | null, "debit" | "credit"][] = [
  [2, "Pago:lider Vitacura", 48990, "Supermercado", "debit"],
  [3, "MERCPAGO*UBER TRIP", 6400, "Transporte", "debit"],
  [4, "DL*RAPPI CHILE", 13590, "Comida", "debit"],
  [5, "Pago:enel distribucion", 38450, "Cuentas", "debit"],
  [6, "Pago:aguas andinas", 21300, "Cuentas", "debit"],
  [7, "Pago:copec pronto", 32000, "Transporte", "debit"],
  [8, "FARMACIA CRUZ VERDE", 18740, "Salud", "debit"],
  [9, "Pago:unimarc Providencia", 27650, "Supermercado", "debit"],
  [10, "MERCADOPAGODUNKIN", 6750, "Comida", "debit"],
  [11, "CINEHOYTS LA REINA", 14000, "Entretención", "debit"],
  [12, "Pago:falabella plaza egana", 59990, "Compras", "debit"],
  [13, "COMPRA WEB 4821 PAYU", 15990, null, "debit"],
  [14, "Transferencia de Camila", 45000, null, "credit"],
  [15, "Pago:jumbo costanera", 62480, "Supermercado", "debit"],
  [17, "Pago:metro tarjeta bip", 12000, "Transporte", "debit"],
  [18, "SUSHI ITTO LOS LEONES", 24900, "Comida", "debit"],
  [20, "AMAZON MKTPLACE", 34500, "Compras", "debit"],
  [22, "Pago:integramedica", 45000, "Salud", "debit"],
  [24, "Pago:lider express", 19870, "Supermercado", "debit"],
  [26, "Pago:sodimac homecenter", 28990, "Compras", "debit"],
]

// [etiqueta, descripción (clave de match), monto, día, categoría]
const RECURRING: [string, string, number, number, string][] = [
  ["Netflix", "Pago:netflix.com", 12900, 8, "Suscripciones"],
  ["Spotify", "SPOTIFY P2B4RT", 5990, 16, "Suscripciones"],
  ["Internet hogar", "Pago:vtr internet", 29990, 19, "Cuentas"],
]

async function resolveUser() {
  const existing = await prisma.user.findUnique({ where: { email: EMAIL } })
  if (!existing) {
    const { user } = await auth.api.signUpEmail({
      body: { name: "Demo Luca", email: EMAIL, password: PASSWORD },
    })
    return { id: user.id, fresh: true }
  }
  if (process.env.SEED_PR_FORCE !== "1") return { id: existing.id, fresh: false }
  // Re-siembra: borrar el banco arrastra en cascada cuentas, tarjetas, movimientos,
  // ingresos, recurrentes y planes de cuotas; la categoría arrastra sus límites.
  await prisma.bank.deleteMany({ where: { userId: existing.id } })
  await prisma.category.deleteMany({ where: { userId: existing.id } })
  await prisma.monthlyBudget.deleteMany({ where: { userId: existing.id } })
  return { id: existing.id, fresh: true }
}

const { id: userId, fresh } = await resolveUser()
if (!fresh) {
  console.log(`[seed:pr] ${EMAIL} ya tiene datos — no se toca nada (SEED_PR_FORCE=1 para rehacerlo).`)
  process.exit(0)
}

const bank = await prisma.bank.create({
  data: { userId, name: "Banco de Chile" },
})

const checking = await prisma.financialAccount.create({
  data: {
    userId,
    bankId: bank.id,
    name: "Cuenta corriente",
    accountType: "checking",
    currency: "CLP",
    balance: 842350,
    overdraftLimit: 1500000,
    cardLast4: "4821",
    color: "#1e3a8a",
  },
})

const creditCard = await prisma.financialAccount.create({
  data: {
    userId,
    bankId: bank.id,
    name: "Tarjeta de crédito",
    accountType: "credit_card",
    currency: "CLP",
    balance: -487600,
    cardLast4: "7734",
    color: "#334155",
  },
})

// Cupos separados por moneda: nunca se suman entre sí (el nacional manda en la UI).
await prisma.balanceBucket.createMany({
  data: [
    {
      userId,
      accountId: creditCard.id,
      kind: "credit_national",
      currency: "CLP",
      limitAmount: 3000000,
      used: 487600,
      available: 2512400,
      asOf: now,
    },
    {
      userId,
      accountId: creditCard.id,
      kind: "credit_international",
      currency: "USD",
      limitAmount: 1500,
      used: 128.4,
      available: 1371.6,
      asOf: now,
    },
  ],
})

const categoryId = new Map<string, string>()
for (const [name, icon, color, limitAmount, description] of EXPENSE_CATEGORIES) {
  const cat = await prisma.category.create({
    data: { userId, name, icon, color, description, type: "expense" },
  })
  categoryId.set(name, cat.id)
  // Solo el mes actual: los meses anteriores heredan por carry-forward.
  await prisma.categoryLimit.create({
    data: { categoryId: cat.id, year, month, limitAmount },
  })
}

const salaryCategory = await prisma.category.create({
  data: {
    userId,
    name: "Sueldo",
    type: "income",
    icon: "Wallet",
    color: "#22c55e",
    description: "Remuneración mensual del trabajo dependiente.",
  },
})

await prisma.monthlyBudget.createMany({
  data: [
    { userId, year, month, globalLimit: 1000000 },
    { userId, year: prevYear, month: prevMonth, globalLimit: 950000 },
  ],
})

const income = await prisma.income.create({
  data: {
    userId,
    accountId: checking.id,
    categoryId: salaryCategory.id,
    name: "Sueldo",
    currency: "CLP",
    dayOfMonth: 5,
    amounts: {
      create: [
        { year, month, amount: 1400000 },
        { year: prevYear, month: prevMonth, amount: 1350000 },
      ],
    },
  },
})

// Movimientos: el mes actual solo hasta hoy (el ritmo diario del dashboard sería falso si el mes
// apareciera completo), y el anterior entero con montos un poco distintos para que el historial
// y el carry-forward tengan de dónde comparar.
const movementRows = [
  ...MOVEMENTS.filter(([day]) => day <= today).map(([day, description, amount, cat, direction]) => ({
    userId,
    accountId: checking.id,
    categoryId: cat ? categoryId.get(cat)! : null,
    transactionDate: new Date(year, month - 1, day),
    description,
    amount,
    currency: "CLP",
    direction,
    reviewed: cat !== null,
  })),
  ...MOVEMENTS.slice(0, 12).map(([day, description, amount, cat, direction]) => ({
    userId,
    accountId: checking.id,
    categoryId: cat ? categoryId.get(cat)! : null,
    transactionDate: new Date(prevYear, prevMonth - 1, day),
    description,
    amount: Math.round(amount * 0.92),
    currency: "CLP",
    direction,
    reviewed: cat !== null,
  })),
]
await prisma.transaction.createMany({ data: movementRows })

// Sueldo ya recibido de cada mes, enganchado a su fuente de ingreso.
await prisma.transaction.createMany({
  data: [
    { year, month, amount: 1400000 },
    { year: prevYear, month: prevMonth, amount: 1350000 },
  ].map(({ year: y, month: m, amount }) => ({
    userId,
    accountId: checking.id,
    categoryId: salaryCategory.id,
    incomeId: income.id,
    transactionDate: new Date(y, m - 1, 5),
    description: "Abono Sueldo",
    amount,
    currency: "CLP",
    direction: "credit",
    reviewed: true,
  })),
})

for (const [label, description, baseAmount, dayOfMonth, cat] of RECURRING) {
  await prisma.recurringTemplate.create({
    data: {
      userId,
      accountId: checking.id,
      categoryId: categoryId.get(cat)!,
      label,
      description,
      direction: "debit",
      baseAmount,
      currency: "CLP",
      dayOfMonth,
      startDate: new Date(prevYear, prevMonth - 1, 1),
    },
  })
}

// Cuotas: una compra en tarjeta (el plan genera el movimiento de cada cuota) y un crédito de
// consumo (el plan adopta el movimiento que trae el correo). Las cuotas ya vencidas antes de este
// mes van como pagadas fuera de la app: inventarles un movimiento falsearía meses ya cerrados.
const plans: [string, string, string, number, number, number, string][] = [
  ["card", "Notebook Lenovo", creditCard.id, 899990, 12, 3, "Compras"],
  ["loan", "Crédito de consumo", checking.id, 2400000, 24, 8, "Cuentas"],
]
for (const [kind, description, accountId, totalAmount, count, elapsed, cat] of plans) {
  const start = new Date(year, month - 1 - elapsed, 5)
  const amount = Math.round(totalAmount / count)
  await prisma.installmentPlan.create({
    data: {
      userId,
      kind,
      accountId,
      categoryId: categoryId.get(cat)!,
      description,
      totalAmount,
      currency: "CLP",
      installmentsCount: count,
      startDate: start,
      dayOfMonth: 5,
      items: {
        create: Array.from({ length: count }, (_, i) => ({
          index: i + 1,
          dueDate: new Date(start.getFullYear(), start.getMonth() + i, 5),
          // La última absorbe el redondeo para que la suma cuadre con el total.
          amount: i === count - 1 ? totalAmount - amount * (count - 1) : amount,
          paidOutsideApp: i < elapsed,
        })),
      },
    },
  })
}

console.log(
  `[seed:pr] listo en "${envName}": ${EMAIL} / ${PASSWORD} — 2 cuentas, ${EXPENSE_CATEGORIES.length + 1} categorías, ` +
    `presupuesto ${month}/${year}, ${movementRows.length + 2} movimientos, ${RECURRING.length} recurrentes, ${plans.length} planes de cuotas.`
)
process.exit(0)
