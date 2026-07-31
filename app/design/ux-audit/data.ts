// Datos en memoria del mock de auditoría UX. Mismo escenario que las capturas del "antes"
// (julio 2026) para poder comparar 1:1 la vista actual con la propuesta.

export type Cat = {
  id: string
  name: string
  icon: string
  color: string
  limit: number
  spent: number
}

export type Mov = {
  id: string
  day: number
  desc: string
  amount: number // negativo = gasto
  catId: string | null
  account: string
  tag?: "cuota" | "recurrente" | "interno"
}

export type Acc = {
  id: string
  name: string
  kind: "Cuenta corriente" | "Ahorro" | "Tarjeta de crédito"
  currency: "CLP" | "USD"
  balance: number
  limit?: number // cupo total (tarjetas)
  color: string
}

export type Rec = {
  id: string
  name: string
  amount: number
  day: number
  cat: string
  account: string
  active: boolean
  chargedThisMonth: boolean
}

export type Plan = {
  id: string
  name: string
  monthly: number
  paid: number
  total: number
  nextDay: number
  endsOn: string
  account: string
}

export const PERIOD = { year: 2026, month: 7, today: 30, daysInMonth: 31 }

export const GLOBAL_LIMIT = 1_650_000
export const INCOME_TOTAL = 2_250_000

export const CATS: Cat[] = [
  { id: "sup", name: "Supermercado", icon: "ShoppingCart", color: "#f59e0b", limit: 320_000, spent: 366_510 },
  { id: "com", name: "Comida y delivery", icon: "Utensils", color: "#ef4444", limit: 150_000, spent: 59_770 },
  { id: "tra", name: "Transporte", icon: "Bus", color: "#38bdf8", limit: 90_000, spent: 57_640 },
  { id: "cue", name: "Cuentas del hogar", icon: "Receipt", color: "#a855f7", limit: 280_000, spent: 112_330 },
  { id: "sub", name: "Suscripciones", icon: "CreditCard", color: "#8b5cf6", limit: 45_000, spent: 47_430 },
  { id: "sal", name: "Salud", icon: "Stethoscope", color: "#ec4899", limit: 120_000, spent: 91_150 },
  { id: "cmp", name: "Compras", icon: "ShoppingBag", color: "#f43f5e", limit: 200_000, spent: 238_190 },
  { id: "mas", name: "Mascotas", icon: "PawPrint", color: "#84cc16", limit: 60_000, spent: 67_990 },
  { id: "aho", name: "Ahorro e inversión", icon: "TrendingUp", color: "#22c55e", limit: 300_000, spent: 0 },
]

export const ACCOUNTS: Acc[] = [
  { id: "cc", name: "Cuenta corriente", kind: "Cuenta corriente", currency: "CLP", balance: 842_315, color: "#1e3a8a" },
  { id: "ah", name: "Cuenta de ahorro", kind: "Ahorro", currency: "CLP", balance: 3_250_000, color: "#0f766e" },
  { id: "tc", name: "Visa Signature", kind: "Tarjeta de crédito", currency: "CLP", balance: -487_600, limit: 1_500_000, color: "#334155" },
  { id: "us", name: "Visa Internacional", kind: "Tarjeta de crédito", currency: "USD", balance: -184.5, limit: 2_000, color: "#475569" },
]

export const MOVS: Mov[] = [
  { id: "m30", day: 30, desc: "Abono de remuneraciones", amount: 1_850_000, catId: null, account: "Cuenta corriente" },
  { id: "m29", day: 29, desc: "Lider Express Providencia", amount: -38_900, catId: "sup", account: "Cuenta corriente" },
  { id: "m28", day: 28, desc: "Vet & Pet Spa", amount: -25_000, catId: "mas", account: "Cuenta corriente" },
  { id: "m27", day: 27, desc: "Pago tarjeta de crédito", amount: -300_000, catId: null, account: "Cuenta corriente", tag: "interno" },
  { id: "m26", day: 26, desc: "Santa Isabel Los Leones", amount: -52_380, catId: "sup", account: "Cuenta corriente" },
  { id: "m25", day: 25, desc: "Cabify", amount: -8_900, catId: "tra", account: "Cuenta corriente" },
  { id: "m24", day: 24, desc: "Paris Costanera Center", amount: -74_990, catId: "cmp", account: "Visa Signature" },
  { id: "m23", day: 23, desc: "Amazon Web Services", amount: -32_450, catId: "sub", account: "Visa Signature" },
  { id: "m22", day: 22, desc: "Dunkin Donuts", amount: -6_750, catId: "com", account: "Cuenta corriente" },
  { id: "m21", day: 21, desc: "Unimarc Vitacura", amount: -41_230, catId: "sup", account: "Cuenta corriente" },
  { id: "m20b", day: 20, desc: "Refrigerador Samsung", amount: -54_166, catId: "cmp", account: "Visa Signature", tag: "cuota" },
  { id: "m20", day: 20, desc: "Sodimac Homecenter", amount: -27_890, catId: "cmp", account: "Cuenta corriente" },
  { id: "m19", day: 19, desc: "Transferencia a Juan P", amount: -50_000, catId: null, account: "Cuenta corriente" },
  { id: "m18", day: 18, desc: "Uber Eats", amount: -18_450, catId: "com", account: "Cuenta corriente" },
  { id: "m17", day: 17, desc: "Clínica Alemana", amount: -68_000, catId: "sal", account: "Cuenta corriente" },
  { id: "m16", day: 16, desc: "Internet VTR", amount: -39_990, catId: "cue", account: "Cuenta corriente", tag: "recurrente" },
  { id: "m15b", day: 15, desc: "Pasajes a Buenos Aires", amount: -160_000, catId: "cmp", account: "Visa Signature", tag: "cuota" },
  { id: "m15", day: 15, desc: "Proyecto freelance", amount: 400_000, catId: null, account: "Cuenta corriente" },
  { id: "m14", day: 14, desc: "Amazon Marketplace", amount: -45_320, catId: "cmp", account: "Cuenta corriente" },
  { id: "m13", day: 13, desc: "Jumbo Kennedy", amount: -112_450, catId: "sup", account: "Cuenta corriente" },
  { id: "m12", day: 12, desc: "Starbucks Costanera", amount: -5_900, catId: "com", account: "Cuenta corriente" },
  { id: "m11", day: 11, desc: "Copec estación", amount: -32_000, catId: "tra", account: "Cuenta corriente" },
  { id: "m10", day: 10, desc: "Falabella Plaza Egaña", amount: -89_990, catId: "cmp", account: "Visa Signature" },
  { id: "m09", day: 9, desc: "Pet Lovers", amount: -42_990, catId: "mas", account: "Cuenta corriente" },
  { id: "m08", day: 8, desc: "Uber", amount: -6_740, catId: "tra", account: "Cuenta corriente" },
  { id: "m07", day: 7, desc: "Rappi", amount: -15_680, catId: "com", account: "Cuenta corriente" },
  { id: "m06", day: 6, desc: "Lider Express Providencia", amount: -34_210, catId: "sup", account: "Cuenta corriente" },
  { id: "m05b", day: 5, desc: "Farmacia Cruz Verde", amount: -23_150, catId: "sal", account: "Cuenta corriente" },
  { id: "m05", day: 5, desc: "Spotify", amount: -5_490, catId: "sub", account: "Visa Signature", tag: "recurrente" },
  { id: "m04", day: 4, desc: "Netflix", amount: -9_490, catId: "sub", account: "Visa Signature", tag: "recurrente" },
  { id: "m03", day: 3, desc: "Metro BIP carga", amount: -10_000, catId: "tra", account: "Cuenta corriente" },
  { id: "m02b", day: 2, desc: "Jumbo Kennedy", amount: -87_340, catId: "sup", account: "Cuenta corriente" },
  { id: "m02", day: 2, desc: "Aguas Andinas", amount: -28_450, catId: "cue", account: "Cuenta corriente" },
  { id: "m01", day: 1, desc: "Enel distribución", amount: -43_890, catId: "cue", account: "Cuenta corriente" },
]

// Movimientos que llegaron por correo y la IA no supo clasificar: alimentan la revisión rápida.
export const PENDING = ["m19", "m27", "m15"]

// Sugerencia de la IA por movimiento pendiente (lo que hoy el triage no muestra).
export const SUGGESTED: Record<string, { catId: string; why: string }> = {
  m19: { catId: "cue", why: "Transferiste a Juan P los días 19 de mayo y junio, y clasificaste ambas como Cuentas del hogar." },
  m27: { catId: "interno", why: "Es un pago de tu Visa Signature desde tu cuenta corriente: mueve plata entre tus cuentas, no es un gasto nuevo." },
  m15: { catId: "ingreso", why: "Coincide con tu ingreso Proyecto freelance del día 15." },
}

export const RECURRING: Rec[] = [
  { id: "r1", name: "Arriendo", amount: 620_000, day: 5, cat: "Cuentas del hogar", account: "Cuenta corriente", active: true, chargedThisMonth: true },
  { id: "r2", name: "Internet VTR", amount: 39_990, day: 16, cat: "Cuentas del hogar", account: "Cuenta corriente", active: true, chargedThisMonth: true },
  { id: "r3", name: "Gimnasio Smart Fit", amount: 24_990, day: 12, cat: "Salud", account: "Visa Signature", active: true, chargedThisMonth: false },
  { id: "r4", name: "Netflix", amount: 9_490, day: 4, cat: "Suscripciones", account: "Visa Signature", active: true, chargedThisMonth: true },
  { id: "r5", name: "Spotify", amount: 5_490, day: 5, cat: "Suscripciones", account: "Visa Signature", active: true, chargedThisMonth: true },
]

export const PLANS: Plan[] = [
  { id: "p1", name: "Notebook Lenovo", monthly: 149_998, paid: 3, total: 6, nextDay: 10, endsOn: "septiembre 2026", account: "Visa Signature" },
  { id: "p2", name: "Refrigerador Samsung", monthly: 54_166, paid: 5, total: 12, nextDay: 20, endsOn: "enero 2027", account: "Visa Signature" },
  { id: "p3", name: "Pasajes a Buenos Aires", monthly: 160_000, paid: 1, total: 3, nextDay: 15, endsOn: "agosto 2026", account: "Visa Signature" },
]

export const catById = (id: string | null) => CATS.find((c) => c.id === id)

const DIAS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"]

/** Fecha larga de un día de julio 2026, con "Hoy" y "Ayer" cuando corresponde. */
export function dayLabel(day: number): string {
  if (day === PERIOD.today) return "Hoy"
  if (day === PERIOD.today - 1) return "Ayer"
  const d = new Date(Date.UTC(PERIOD.year, PERIOD.month - 1, day))
  return `${DIAS[d.getUTCDay()]} ${day} de julio`
}
