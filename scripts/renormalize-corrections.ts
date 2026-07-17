// Re-normaliza el `normalizedText` de TODAS las correcciones de aprendizaje con la versión vigente
// de normalizeMovementText. Necesario tras cambiar esa función: las correcciones viejas quedaron con
// la forma anterior y dejarían de matchear en silencio. Re-deriva el texto desde `sampleText` (la
// descripción original guardada) y resuelve colisiones (dos correcciones que ahora normalizan igual)
// quedándose con la MÁS RECIENTE y borrando las demás.
//
//   node --env-file=.env scripts/renormalize-corrections.ts          # dry-run: solo informa
//   node --env-file=.env scripts/renormalize-corrections.ts --apply  # aplica los cambios
import { prisma } from "../arch/v1/infrastructure/database/prisma/client.ts"
import { normalizeMovementText } from "../arch/v1/domain/finance/categorization-learning.domain.ts"

const apply = process.argv.includes("--apply")

async function main() {
  // Más nuevas primero: ante colisión, la primera vista (más reciente) gana.
  const all = await prisma.categorizationCorrection.findMany({
    orderBy: { updatedAt: "desc" },
  })

  const keptKeys = new Set<string>() // `${userId}|${direction}|${newNorm}`
  const toUpdate: { id: string; from: string; to: string; sample: string }[] =
    []
  const toDelete: { id: string; reason: string; sample: string }[] = []

  for (const c of all) {
    const to = normalizeMovementText(c.sampleText)
    if (!to) {
      toDelete.push({
        id: c.id,
        reason: "vacío tras normalizar",
        sample: c.sampleText,
      })
      continue
    }
    const key = `${c.userId}|${c.direction}|${to}`
    if (keptKeys.has(key)) {
      toDelete.push({
        id: c.id,
        reason: "colisión (ya hay una más reciente)",
        sample: c.sampleText,
      })
      continue
    }
    keptKeys.add(key)
    if (c.normalizedText !== to)
      toUpdate.push({
        id: c.id,
        from: c.normalizedText,
        to,
        sample: c.sampleText,
      })
  }

  console.log(
    `Correcciones: ${all.length} · cambian ${toUpdate.length} · se borran ${toDelete.length} (colisiones/vacías)`
  )
  for (const u of toUpdate.slice(0, 20))
    console.log(`  ~ "${u.from}"  →  "${u.to}"   (${u.sample})`)
  if (toUpdate.length > 20) console.log(`  … y ${toUpdate.length - 20} más`)
  for (const d of toDelete) console.log(`  ✗ borrar ${d.reason}: "${d.sample}"`)

  if (!apply) {
    console.log("\n(dry-run) Nada se modificó. Corre con --apply para aplicar.")
    return
  }

  // Borrar primero libera los unique (userId, direction, normalizedText).
  if (toDelete.length)
    await prisma.categorizationCorrection.deleteMany({
      where: { id: { in: toDelete.map((d) => d.id) } },
    })

  // Dos fases: primero a un valor temporal único (evita choques transitorios con filas aún sin
  // actualizar), luego al valor final. Los finales son únicos entre las que quedan.
  for (const u of toUpdate)
    await prisma.categorizationCorrection.update({
      where: { id: u.id },
      data: { normalizedText: `__tmp__${u.id}` },
    })
  for (const u of toUpdate)
    await prisma.categorizationCorrection.update({
      where: { id: u.id },
      data: { normalizedText: u.to },
    })

  console.log(
    `\n✓ Aplicado: ${toUpdate.length} actualizadas, ${toDelete.length} borradas.`
  )
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
