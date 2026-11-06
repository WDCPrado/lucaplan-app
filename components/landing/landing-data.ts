// Datos de ejemplo de la landing, tipados con los DTO reales para que los componentes de la app
// (AccountCard, MovementRow, PlanSummary, SpendPaceChart) los pinten tal cual en el dashboard.
// Las cifras del plan se derivan de las listas: la landing nunca se contradice entre secciones.
import type {
  AccountDTO,
  SpendableDTO,
  TransactionDTO,
} from "@/arch/v1/application/finance-use-cases/finance-read"

export const GITHUB_URL = "https://github.com/WDCPrado/lucaplan-app"
export const LINKEDIN_URL =
  "https://www.linkedin.com/in/welliton-da-costa-prado-5050b4251"

export const cta = {
  create: { href: "/login", label: "Crear mi cuenta" },
  enter: { href: "/login", label: "Entrar" },
}

function tx(
  id: string,
  description: string,
  amount: number,
  category: [name: string, icon: string, color: string] | null,
  extra: Partial<TransactionDTO> = {}
): TransactionDTO {
  return {
    id,
    accountId: "demo",
    currency: "CLP",
    editable: false,
    description,
    amount,
    direction: "debit",
    date: "",
    status: "confirmed",
    categoryId: category ? category[0] : null,
    categoryName: category?.[0] ?? null,
    categoryIcon: category?.[1] ?? null,
    categoryColor: category?.[2] ?? null,
    remaining: null,
    categoryLimit: null,
    ...extra,
  }
}

const SUPER = ["Supermercado", "ShoppingCart", "#4f6ef7"] as [string, string, string]
const TRANSPORTE = ["Transporte", "Bus", "#0e9488"] as [string, string, string]
const COMIDA = ["Comida", "Utensils", "#f97316"] as [string, string, string]
const CUENTAS = ["Cuentas", "Receipt", "#06b6d4"] as [string, string, string]
const OCIO = ["Ocio", "Film", "#e8618c"] as [string, string, string]
const SALUD = ["Salud", "HeartPulse", "#10b981"] as [string, string, string]

// Ritmo por categoría (débito, mes calendario). `committed` = recurrentes y cuotas por cobrar.
export const categories = [
  { name: "Supermercado", icon: "ShoppingCart", color: "#4f6ef7", limit: 420000, used: 268450, committed: 0 },
  { name: "Comida", icon: "Utensils", color: "#f97316", limit: 150000, used: 112900, committed: 0 },
  { name: "Transporte", icon: "Bus", color: "#0e9488", limit: 90000, used: 41300, committed: 0 },
  { name: "Cuentas", icon: "Receipt", color: "#06b6d4", limit: 800000, used: 588900, committed: 43980 },
  { name: "Ocio", icon: "Film", color: "#e8618c", limit: 80000, used: 51200, committed: 9990 },
  { name: "Tecnología", icon: "Smartphone", color: "#6366f1", limit: 110000, used: 45000, committed: 58000 },
] as const

// Ciclo de tarjeta: la misma persona en modo crédito, con sus propios topes heredados.
export const creditCategories = [
  { name: "Supermercado", icon: "ShoppingCart", color: "#4f6ef7", limit: 300000, used: 187600, committed: 0 },
  { name: "Comida", icon: "Utensils", color: "#f97316", limit: 120000, used: 131400, committed: 0 },
  { name: "Ocio", icon: "Film", color: "#e8618c", limit: 60000, used: 18990, committed: 9990 },
  { name: "Tecnología", icon: "Smartphone", color: "#6366f1", limit: 70000, used: 0, committed: 58000 },
] as const

export const recurring = [
  { label: "Arriendo", meta: "Cuentas", icon: "House", color: "#06b6d4", amount: 520000, note: "Pagado", paid: true },
  { label: "Plan celular", meta: "Cuentas", icon: "Smartphone", color: "#06b6d4", amount: 18990, note: "Cobra el 22 nov", paid: false },
  { label: "Internet hogar", meta: "Cuentas", icon: "Wifi", color: "#06b6d4", amount: 24990, note: "Cobra el 25 nov", paid: false },
  { label: "Netflix", meta: "Ocio", icon: "Film", color: "#e8618c", amount: 9990, note: "Cobra mañana", paid: false },
] as const

export const installments = [
  { label: "iPhone 16", meta: "Cuota 4 de 12", icon: "Smartphone", color: "#6366f1", monthly: 58000, outstanding: 464000, progress: 33, paid: false },
  { label: "Notebook Lenovo", meta: "Cuota 6 de 6", icon: "Smartphone", color: "#6366f1", monthly: 45000, outstanding: 0, progress: 100, paid: true },
] as const

const recurringPending = recurring.filter((r) => !r.paid).reduce((s, r) => s + r.amount, 0)
const installmentsPending = installments.filter((i) => !i.paid).reduce((s, i) => s + i.monthly, 0)

export const plan = (() => {
  const income = 1850000
  const spent = categories.reduce((s, c) => s + c.used, 0)
  const committed = recurringPending + installmentsPending
  const margin = income - spent - committed
  const plannedLeft = categories.reduce((s, c) => s + (c.limit - c.used - c.committed), 0)
  const spendable: SpendableDTO = {
    amount: Math.min(margin, plannedLeft),
    margin,
    plannedLeft,
    limitedBy: plannedLeft <= margin ? "plan" : "margin",
  }
  return {
    income,
    spent,
    committed,
    cash: 1248500,
    overdraftDebt: 0,
    spendable,
    recurringPending,
    installmentsPending,
  }
})()

// Curva del Inicio: noviembre, hoy es el día 18. Gasto de ritmo por día: sin los pagos que saldan
// una recurrente o una cuota (el arriendo y la última cuota del notebook). Pesos fijos para que el
// SSR y el cliente dibujen lo mismo.
const weights = [3, 1, 0, 5, 2, 2, 4, 6, 1, 0, 3, 2, 5, 2, 1, 4, 3, 2]
const commitmentPayments =
  recurring.filter((r) => r.paid).reduce((s, r) => s + r.amount, 0) +
  installments.filter((i) => i.paid).reduce((s, i) => s + i.monthly, 0)
const paceSpent = plan.spent - commitmentPayments
const wSum = weights.reduce((s, w) => s + w, 0)
export const pace = {
  days: Array.from({ length: 30 }, (_, i) => `2026-11-${String(i + 1).padStart(2, "0")}`),
  spend: Array.from({ length: 30 }, (_, i) =>
    i < weights.length ? Math.round((paceSpent * weights[i]) / wSum) : 0
  ),
  limit: plan.spendable.amount + paceSpent,
  lastIndex: weights.length - 1,
  daysLeft: 30 - weights.length,
}

export const homeMovements: TransactionDTO[] = [
  tx("h1", "Jumbo Costanera Center", 48230, SUPER, { remaining: 151550, categoryLimit: 420000 }),
  tx("h2", "Sueldo noviembre", 1850000, ["Sueldo", "TrendingUp", "#22a06b"], { direction: "credit" }),
  tx("h3", "Carga Bip!", 10000, TRANSPORTE, { remaining: 48700, categoryLimit: 90000 }),
]

// Glosas crudas del aviso del banco y cómo quedan categorizadas.
export const rawToCategorized: { raw: string; tx: TransactionDTO }[] = [
  { raw: "Pago:payu *uber eats", tx: tx("ai1", "Uber Eats", 14990, COMIDA) },
  { raw: "Pago:red Movilidad San", tx: tx("ai2", "Red Movilidad", 815, TRANSPORTE) },
  { raw: "Pago:enel Distribucion", tx: tx("ai3", "Enel", 38420, CUENTAS) },
  { raw: "Pago:cine Hoyts La Reina", tx: tx("ai4", "Cine Hoyts", 11800, OCIO) },
  { raw: "Pago:farmacias Ahumada", tx: tx("ai5", "Farmacias Ahumada", 7390, SALUD) },
]

// Lo que se importa al conectar: un vistazo a los meses anteriores ya categorizados.
export const importedMovements: TransactionDTO[] = [
  tx("i1", "Unimarc Vitacura", 23180, SUPER),
  tx("i2", "Copec Av. Kennedy", 32000, TRANSPORTE),
  tx("i3", "Spotify", 6500, OCIO),
]

export const onboardingCategories = [
  { name: "Supermercado", icon: "ShoppingCart", color: "#4f6ef7" },
  { name: "Transporte", icon: "Bus", color: "#0e9488" },
  { name: "Gimnasio", icon: "Dumbbell", color: "#10b981" },
  { name: "Mascotas", icon: "PawPrint", color: "#f59e0b" },
] as const

function account(a: Partial<AccountDTO> & Pick<AccountDTO, "id" | "bankName" | "name" | "accountType" | "buckets">): AccountDTO {
  return {
    bankId: "demo",
    currency: "CLP",
    balance: 0,
    color: null,
    cardLast4: null,
    provider: "bancochile",
    connectionMethod: "email",
    lastSyncedAt: null,
    ...a,
  }
}

export const accounts: AccountDTO[] = [
  account({
    id: "demo-credit",
    bankName: "Banco de Chile",
    name: "Tarjeta de crédito",
    accountType: "credit_card",
    cardLast4: "2140",
    buckets: [
      { kind: "credit_national", currency: "CLP", limit: 3500000, used: 421300, available: 3078700, asOf: null },
      { kind: "credit_international", currency: "USD", limit: 2500, used: 305.4, available: 2194.6, asOf: null },
    ],
  }),
  account({
    id: "demo-checking",
    bankName: "Banco de Chile",
    name: "Cuenta corriente",
    accountType: "checking",
    balance: 1248500,
    cardLast4: "8901",
    buckets: [
      { kind: "cash", currency: "CLP", limit: 0, used: 0, available: 1248500, asOf: null },
      { kind: "overdraft", currency: "CLP", limit: 1000000, used: 0, available: 1000000, asOf: null },
    ],
  }),
  account({
    id: "demo-bice",
    bankName: "Banco BICE",
    name: "Tarjeta de crédito",
    accountType: "credit_card",
    cardLast4: "7712",
    provider: "bice",
    buckets: [
      { kind: "credit_national", currency: "CLP", limit: 1800000, used: 212450, available: 1587550, asOf: null },
      { kind: "credit_international", currency: "USD", limit: 1000, used: 42.9, available: 957.1, asOf: null },
    ],
  }),
]
