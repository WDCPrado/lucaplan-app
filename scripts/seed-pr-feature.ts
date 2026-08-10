// Datos EXTRA del PR actual: lo que la feature de esta rama necesita para poder probarse y que el
// seed base (scripts/seed-pr.ts) no siembra. Lo corre el seed base al final de la primera siembra,
// con el usuario demo ya creado, y solo en entornos de PR de Railway.
//
// SE REESCRIBE COMPLETO EN CADA FEATURE, antes de abrir el PR. El contenido pertenece al PR en
// curso, no al repo: si tu cambio no necesita datos propios, déjalo como no-op.
//
// Reglas al escribirlo:
//   - Solo la data mínima de la feature y sus dependencias. Usuario, cuentas, categorías,
//     presupuesto, movimientos, recurrentes y planes de cuotas ya vienen del seed base: tómalos
//     del ctx en vez de crear otros.
//   - Nada de datos reales ni secretos: el entorno de PR es público.
//   - Si falla, el seed base lo registra y sigue (no tumba el deploy), pero la feature queda sin
//     datos. Pruébalo antes con `SEED_PR_FORCE=1 pnpm seed:pr` contra una base local.
//
// --- PR actual: categorías por defecto al crear la cuenta ---
// Lo que hay que mirar es una cuenta RECIÉN creada, y el usuario demo del seed base no sirve: se le
// borran las categorías por defecto para dejarle su set de demo. Así que se crea una segunda cuenta
// por Better Auth (el mismo camino que un registro real, así dispara el hook) y se deja intacta:
// entrando con ella se ve el estado inicial de verdad — las 10 categorías, sin presupuesto asignado.
import type { FeatureSeedContext } from "./seed-pr.ts" // solo el tipo: no ejecuta el seed base

const EMAIL = "nueva@lucaplan.cl"
const PASSWORD = "lucaplan1234"

export default async function seedFeature({ prisma }: FeatureSeedContext) {
  // El seed base ya forzó NEXT_PUBLIC_LANDING_ONLY=false antes de construir Better Auth, así que
  // signUpEmail está habilitado aquí aunque el entorno tenga el registro cerrado.
  const { auth } = await import("../arch/v1/infrastructure/auth/auth.ts")
  const existing = await prisma.user.findUnique({ where: { email: EMAIL } })
  if (existing) return

  await auth.api.signUpEmail({
    body: { name: "Cuenta nueva", email: EMAIL, password: PASSWORD },
  })
  console.log(
    `[seed:pr] cuenta recién creada para revisar la feature: ${EMAIL} / ${PASSWORD}`
  )
}
