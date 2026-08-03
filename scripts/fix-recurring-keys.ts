// Repara la CLAVE de match (`description`) de las plantillas recurrentes que quedaron rotas por un
// renombre, cuando `description` cumplía a la vez de nombre visible y de clave (ver change
// split-recurring-label-key). Por cada plantilla toma su cargo REAL vinculado (la Transaction con
// `recurringTemplateId` = plantilla y `externalId` no nulo, la más antigua = la de origen) y
// setea `description` = la descripción de ese cargo. Es la clave verdadera del correo del banco.
//
// El `label` (nombre visible) NO se toca: la migración de schema ya hizo el backfill
// `label = description`, así que quedó con el nombre que el usuario veía. Por eso ORDEN:
//   1) deploy con la migración (columna label + backfill)   2) este script
//
// Idempotente: correrlo de nuevo vuelve a fijar la misma clave. DRY-RUN por defecto; escribe solo
// con --apply.
//
// Uso:
//   node scripts/fix-recurring-keys.ts --db-prod "postgresql://user:pass@host:5432/db?sslmode=require"          (dry-run)
//   node scripts/fix-recurring-keys.ts --db-prod "postgresql://..." --apply                                     (escribe)
//   (o: pnpm fix:recurring-keys --db-prod "postgresql://..." [--apply])
//
// Nota de seguridad: la URL de prod va en la línea de comandos (queda en el historial del shell).
export {} // marca el archivo como módulo (usa top-level await con import dinámico)

function argValue(flag: string): string | null {
  const i = process.argv.indexOf(flag)
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1]
  const eq = process.argv.find((a) => a.startsWith(`${flag}=`))
  return eq ? eq.slice(flag.length + 1) : null
}

const prodUrl = argValue("--db-prod")
if (!prodUrl) {
  console.error(
    '✗ Falta --db-prod.\n  Uso: node scripts/fix-recurring-keys.ts --db-prod "postgresql://user:pass@host:5432/db?sslmode=require" [--apply]'
  )
  process.exit(1)
}
const apply = process.argv.includes("--apply")

// El cliente Prisma lee DATABASE_URL al importarse: hay que fijarla ANTES del import.
process.env.DATABASE_URL = prodUrl
const { prisma } = await import(
  "../arch/v1/infrastructure/database/prisma/client.ts"
)

console.log(
  `▶ ${apply ? "APLICANDO" : "DRY-RUN (usa --apply para escribir)"} sobre ${new URL(prodUrl).host}\n`
)

const templates = await prisma.recurringTemplate.findMany({
  select: { id: true, label: true, description: true },
})

let fixed = 0
let alreadyOk = 0
const unrepairable: { id: string; label: string }[] = []

for (const t of templates) {
  // Cargo real de origen: el vinculado más antiguo con externalId (vino del banco).
  const charge = await prisma.transaction.findFirst({
    where: { recurringTemplateId: t.id, externalId: { not: null } },
    orderBy: { transactionDate: "asc" },
    select: { description: true },
  })
  if (!charge) {
    unrepairable.push({ id: t.id, label: t.label })
    continue
  }
  if (charge.description === t.description) {
    alreadyOk++
    continue
  }
  console.log(
    `  · ${t.label}\n      description: "${t.description}"  →  "${charge.description}"`
  )
  if (apply)
    await prisma.recurringTemplate.update({
      where: { id: t.id },
      data: { description: charge.description },
    })
  fixed++
}

console.log(
  `\n${apply ? "✓ Corregidas" : "→ A corregir"}: ${fixed} · ya correctas: ${alreadyOk} · sin cargo real vinculado: ${unrepairable.length}`
)
if (unrepairable.length) {
  console.log(
    "  Sin cargo real del banco no se puede derivar la clave; corrígelas re-creándolas desde el movimiento:"
  )
  for (const u of unrepairable) console.log(`    - ${u.label} (${u.id})`)
}

await prisma.$disconnect()
