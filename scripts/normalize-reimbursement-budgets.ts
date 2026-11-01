// Explicit, scoped, non-destructive backfill. Preview unless --apply is present.
import { normalizeManualReimbursements } from "../arch/v1/infrastructure/database/prisma/reimbursement.infrastructure.ts"
import { prisma } from "../arch/v1/infrastructure/database/prisma/client.ts"

const args = process.argv.slice(2)
const value = (key: string) => args.find(arg => arg.startsWith(`${key}=`))?.slice(key.length + 1)
const userId = value("--user-id")
const ids = value("--reimbursement-ids")?.split(",").filter(Boolean)
const mode = value("--mode")
try {
  if (!userId || !ids?.length || (mode !== "calendar" && mode !== "card_cycle"))
    throw new Error("Uso: --user-id=ID --reimbursement-ids=ID,ID --mode=calendar|card_cycle [--apply]")
  console.log(JSON.stringify(await normalizeManualReimbursements({
    userId, reimbursementIds: ids, mode, apply: args.includes("--apply"),
  }), null, 2))
} finally {
  await prisma.$disconnect()
}
