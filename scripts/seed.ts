// Seed de la app. Primero producción (catálogos fijos; hoy vacío) y después la cuenta demo, que
// corre SOLO fuera de producción:
//   - en un entorno de PR de Railway (RAILWAY_ENVIRONMENT_NAME = …pr-<n>), donde cada PR estrena
//     su base vacía y sin datos no hay qué revisar;
//   - en local con NODE_ENV=development exacto (`pnpm seed`, `pnpm setup:db`), y solo contra una
//     base en localhost.
// Producción, Docker Compose y cualquier otro entorno se saltan la demo sin tocar la base.
//
// El orden lo declaran las listas de scripts/seed/orden.ts; un archivo fuera de ellas aborta.
// Idempotente: una cuenta demo ya sembrada no se toca (SEED_DEMO_FORCE=1 la rehace de cero).
import { DEMO_EMAIL, prDemoAccount } from "../lib/pr-demo.ts"
import { DEMO, PRODUCCION, desajustesDelSeed } from "./seed/orden.ts"
// Solo el tipo: el módulo abre el cliente de Prisma y se carga después de las guardas.
import type { DemoContext } from "./seed/demo/1-base/cuenta-demo.ts"

const problemas = desajustesDelSeed()
if (problemas.length) {
  console.error(`[seed] el disco no coincide con scripts/seed/orden.ts:\n  ${problemas.join("\n  ")}`)
  process.exit(1)
}

for (const archivo of PRODUCCION) {
  const { seed } = (await import(`./seed/produccion/${archivo}`)) as { seed: () => Promise<void> }
  await seed()
}

const pr = prDemoAccount()
const local = process.env.NODE_ENV === "development"
if (!pr && !local) {
  console.log(
    `[seed] demo omitida — ni entorno de PR (RAILWAY_ENVIRONMENT_NAME="${process.env.RAILWAY_ENVIRONMENT_NAME ?? ""}") ni NODE_ENV=development.`
  )
  process.exit(0)
}
if (!pr) {
  const host = (() => {
    try {
      return new URL(process.env.DATABASE_URL ?? "").hostname
    } catch {
      return ""
    }
  })()
  if (!["localhost", "127.0.0.1"].includes(host)) {
    console.error(`[seed] la demo local solo siembra una base en localhost; DATABASE_URL apunta a "${host}".`)
    process.exit(1)
  }
}

const email = pr?.email ?? DEMO_EMAIL
const [[, [base]], ...areas] = DEMO
const { seed: sembrarBase } = (await import(`./seed/demo/1-base/${base}`)) as {
  seed: (input: { email: string; nombre: string }) => Promise<DemoContext | null>
}
const ctx = await sembrarBase({ email, nombre: "Demo Luca" })
let fallidos = 0
if (ctx) {
  for (const [area, archivos] of areas)
    for (const archivo of archivos) {
      // Un caso roto (típicamente uno viejo contra un esquema que cambió) no tumba el deploy del PR:
      // se registra y siguen los demás.
      try {
        const { seed } = (await import(`./seed/demo/${area}/${archivo}`)) as { seed: (c: DemoContext) => Promise<void> }
        await seed(ctx)
      } catch (error) {
        fallidos++
        console.error(`[seed] falló demo/${area}/${archivo}:`, error)
      }
    }
}
console.log(
  `[seed] listo en ${pr ? `"${pr.env}"` : "local"} — ${email} ${ctx ? "sembrada" : "ya estaba"}` +
    `${fallidos ? ` · casos fallidos: ${fallidos}` : ""}. Acceso por código${local ? " (en local, 000000)" : " al correo"}.`
)
process.exit(0)
