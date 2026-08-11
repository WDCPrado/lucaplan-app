// Alta manual de una cuenta contra la base que se le indique (producción incluida). Hace falta
// porque el registro está cerrado en la app (NEXT_PUBLIC_LANDING_ONLY): no hay forma de crear un
// usuario desde la UI. Va por Better Auth y no por Prisma directo para que la cuenta quede igual
// que una registrada: hash de la contraseña, fila `account` y categorías por defecto.
//
// Uso:
//   node --env-file-if-exists=.env scripts/create-account.ts --db-prod "postgresql://user:pass@host:5432/db?sslmode=require" --email alguien@correo.cl
//   (o: pnpm create:account --db-prod "postgresql://..." --email alguien@correo.cl)
//
// Opcionales: --password (si no, se genera una y se imprime) y --name (si no, la parte local del correo).
// Nota de seguridad: la URL de prod y la contraseña van en la línea de comandos (quedan en el historial del shell).
import { randomBytes } from "node:crypto"

// Acepta "--flag <valor>" y "--flag=<valor>" (mismo parser que scripts/clone-prod-db.mjs).
function argValue(flag: string) {
  const i = process.argv.indexOf(flag)
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1]
  const eq = process.argv.find((a) => a.startsWith(`${flag}=`))
  return eq ? eq.slice(flag.length + 1) : null
}

const dbUrl = argValue("--db-prod")
const email = argValue("--email")
if (!dbUrl || !email) {
  console.error(
    '✗ Faltan argumentos.\n  Uso: node scripts/create-account.ts --db-prod "postgresql://user:pass@host:5432/db?sslmode=require" --email alguien@correo.cl [--password ...] [--name "..."]'
  )
  process.exit(1)
}
const password = argValue("--password") ?? randomBytes(9).toString("base64url")
const name = argValue("--name") ?? email.split("@")[0]
const host = new URL(dbUrl).hostname

// El adapter de Prisma y Better Auth se construyen AL IMPORTARSE leyendo el entorno, así que la base
// de destino y el registro abierto tienen que estar puestos antes: de ahí los imports dinámicos.
process.env.DATABASE_URL = dbUrl
process.env.NEXT_PUBLIC_LANDING_ONLY = "false"
const { prisma } = await import(
  "../arch/v1/infrastructure/database/prisma/client.ts"
)
const { auth } = await import("../arch/v1/infrastructure/auth/auth.ts")

// Better Auth también rechaza el duplicado, pero con un error genérico; este avisa contra qué base.
if (await prisma.user.findUnique({ where: { email } })) {
  console.error(`✗ ${email} ya tiene cuenta en ${host} — no se toca nada.`)
  process.exit(1)
}

await auth.api.signUpEmail({ body: { name, email, password } })

console.log(
  `✓ Cuenta creada en ${host}\n  correo: ${email}\n  clave:  ${password}\n  (cámbiala desde la app: la contraseña quedó en el historial del shell)`
)
process.exit(0)
