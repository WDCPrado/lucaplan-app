// Deploy / setup inicial de una base de datos (p. ej. la de producción): genera el cliente
// Prisma y aplica TODAS las migraciones pendientes contra la URL indicada. Úsalo la primera
// vez que apuntas a una DB nueva, o para correr migraciones ad-hoc desde tu máquina.
//
// Uso:
//   node scripts/deploy-init.mjs "<DATABASE_URL>"      (o: pnpm deploy:init "<DATABASE_URL>")
//   DATABASE_URL="<url>" node scripts/deploy-init.mjs   (sin exponer la URL en el historial)
//
// Nota de seguridad: pasar la URL como argumento la deja en el historial del shell. Para prod,
// prefiere la variable de entorno. En Railway esto ya lo hace el Pre-deploy Command; este script
// es para el setup manual desde local.
import { execSync } from "node:child_process";

const url = process.argv[2] ?? process.env.DATABASE_URL;
if (!url) {
  console.error('✗ Falta la URL. Uso: node scripts/deploy-init.mjs "<DATABASE_URL>"');
  process.exit(1);
}

const host = (() => {
  try {
    return new URL(url).host;
  } catch {
    console.error("✗ DATABASE_URL inválida");
    process.exit(1);
  }
})();

const env = { ...process.env, DATABASE_URL: url };
const run = (cmd) => execSync(cmd, { stdio: "inherit", env });

console.log(`▶ Objetivo: ${host}`);
console.log("▶ prisma generate");
run("prisma generate");
console.log("▶ prisma migrate deploy");
run("prisma migrate deploy");
console.log("✓ Base de datos lista (migraciones aplicadas)");
