// Aplica las migraciones de Prisma a la base que TÚ elijas por consola:
//   pnpm migrate:db --db <DATABASE_URL>   (agrega --yes para saltar la confirmación)
// Solo corre `prisma migrate deploy` (aditivo); nunca reset ni borrado. La URL viaja por
// variable de entorno al proceso hijo — nunca interpolada en un string de shell.
import { execFileSync } from "node:child_process";
import readline from "node:readline/promises";

const args = process.argv.slice(2);
const dbIdx = args.indexOf("--db");
const dbUrl = dbIdx >= 0 ? args[dbIdx + 1] : undefined;
if (!dbUrl) {
  console.error("Uso: pnpm migrate:db --db <DATABASE_URL> [--yes]");
  process.exit(1);
}

let host;
try {
  host = new URL(dbUrl).host;
} catch {
  console.error("✗ --db no es una URL válida");
  process.exit(1);
}

if (!args.includes("--yes")) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`▶ Aplicar migraciones (migrate deploy) a "${host}"? [y/N] `);
  rl.close();
  if (!/^[sy]/i.test(answer.trim())) {
    console.log("Abortado.");
    process.exit(0);
  }
}

console.log(`▶ prisma migrate deploy → ${host}`);
// Sin shell (execFileSync + binario JS de Prisma). dotenv (prisma.config.ts) no pisa variables
// ya presentes: este DATABASE_URL gana sobre .env.
execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], {
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: dbUrl },
});
console.log("✓ Migraciones aplicadas");
