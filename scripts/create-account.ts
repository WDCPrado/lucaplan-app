// Alta administrativa de una cuenta sin contraseña y sus categorías.
// Uso: pnpm create:account --db-prod "postgresql://..." --email persona@example.com [--name "Nombre"]
import { randomUUID } from "node:crypto"

// Acepta "--flag <valor>" y "--flag=<valor>" (mismo parser que scripts/clone-prod-db.mjs).
function argValue(flag: string) {
  const i = process.argv.indexOf(flag)
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1]
  const eq = process.argv.find((a) => a.startsWith(`${flag}=`))
  return eq ? eq.slice(flag.length + 1) : null
}

const dbUrl = argValue("--db-prod")
const email = argValue("--email")?.trim().toLowerCase()
if (!dbUrl || !email) {
  console.error(
    '✗ Faltan argumentos.\n  Uso: node scripts/create-account.ts --db-prod "postgresql://user:pass@host:5432/db?sslmode=require" --email alguien@correo.cl [--name "..."]'
  )
  process.exit(1)
}
const name = argValue("--name") ?? email.split("@")[0]

// El proxy público de Railway sirve un certificado autofirmado, y `pg` trata `sslmode=require` como
// `verify-full` (verifica la CA y rechaza la conexión). `uselibpqcompat` le devuelve la semántica de
// libpq —cifrar sin verificar la CA, lo mismo que hace psql— para pegar la URL de Railway tal cual.
const url = new URL(dbUrl)
if (url.searchParams.get("sslmode") === "require")
  url.searchParams.set("uselibpqcompat", "true")
const host = url.hostname

process.env.DATABASE_URL = url.toString()
const { prisma } =
  await import("../arch/v1/infrastructure/database/prisma/client.ts")
const { categoryRepository } =
  await import("../arch/v1/infrastructure/database/prisma/finance.infrastructure.ts")
const { seedDefaultCategories } =
  await import("../arch/v1/application/finance-use-cases/seed-default-categories-use-case.ts")

if (await prisma.user.findUnique({ where: { email } })) {
  console.error(`✗ ${email} ya tiene cuenta en ${host} — no se toca nada.`)
  process.exit(1)
}

const user = await prisma.user.create({
  data: { id: randomUUID(), name, email, role: "USER" },
})
await seedDefaultCategories({ categories: categoryRepository }, user.id)
console.log(
  `Cuenta creada en ${host}. Accede con un código enviado al correo indicado.`
)
await prisma.$disconnect()
