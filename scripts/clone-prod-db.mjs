// Clona la DB de PRODUCCIÓN a la LOCAL. El dump/restore corre en un contenedor cliente EFÍMERO de
// Postgres cuya versión ≥ la de producción (pg_dump solo puede volcar servidores de su versión o
// anteriores). Ese cliente comparte la red del contenedor local (`--network container:...`), así
// alcanza la DB local en localhost:5432 y, a la vez, producción por internet. El dump viaja por un
// volumen temporal de Docker (evita bind-mounts de rutas de Windows).
//
// ⚠ DESTRUCTIVO sobre la DB local: borra el schema `public` completo y lo reemplaza por el de prod.
//   Aborta si DATABASE_URL (.env) no apunta a localhost, para no pisar una base remota por error.
//   El dump de prod se hace ANTES de tocar la local: si la URL de prod falla, la local queda intacta.
//
// Uso:
//   node scripts/clone-prod-db.mjs --db-prod "postgresql://user:pass@host:5432/db?sslmode=require"
//   (o: pnpm clone:db --db-prod "postgresql://...")
//
// Nota de seguridad: la URL de prod va en la línea de comandos (queda en el historial del shell).
import "dotenv/config";
import { execFileSync } from "node:child_process";
import { assertDocker } from "./docker.mjs";

const CONTAINER = "lucaplan-postgres";
// Imagen cliente: su versión mayor DEBE ser ≥ la de producción. Prod hoy es 18 (Railway) → 18.
// Si producción sube de versión mayor, subir esta imagen en consecuencia.
const CLIENT_IMAGE = "postgres:18-alpine";
const TMP_VOLUME = "lucaplan-clone-tmp"; // volumen efímero para el dump
const DUMP_PATH = "/dump/prod.dump";

// --- Argumento --db-prod (acepta "--db-prod <url>" y "--db-prod=<url>") ---
function argValue(flag) {
  const i = process.argv.indexOf(flag);
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1];
  const eq = process.argv.find((a) => a.startsWith(`${flag}=`));
  return eq ? eq.slice(flag.length + 1) : null;
}
const prodUrl = argValue("--db-prod");
if (!prodUrl) {
  console.error(
    '✗ Falta --db-prod.\n  Uso: node scripts/clone-prod-db.mjs --db-prod "postgresql://user:pass@host:5432/db?sslmode=require"'
  );
  process.exit(1);
}

// --- Destino local (desde .env) con guardas ---
const localRaw = process.env.DATABASE_URL;
if (!localRaw) {
  console.error("✗ Falta DATABASE_URL (revisa tu .env)");
  process.exit(1);
}
if (!["localhost", "127.0.0.1", ""].includes(new URL(localRaw).hostname)) {
  console.error(
    `✗ DATABASE_URL apunta a "${new URL(localRaw).hostname}", no a localhost.\n` +
      "  Este script es DESTRUCTIVO y solo debe correr contra la DB local."
  );
  process.exit(1);
}

// libpq no entiende el parámetro `?schema=` de Prisma: se quita. Compartiendo la red del contenedor
// local, la DB local se ve en localhost:5432 (no en el puerto del host :5433).
function libpqUrl(raw, override = {}) {
  const u = new URL(raw);
  u.searchParams.delete("schema");
  if (override.hostname) u.hostname = override.hostname;
  if (override.port) u.port = override.port;
  return u.toString();
}
const localInside = libpqUrl(localRaw, { hostname: "localhost", port: "5432" });
const prodClean = libpqUrl(prodUrl);

// --- Ejecución ---
const docker = (args, opts = {}) =>
  execFileSync("docker", args, { stdio: "inherit", ...opts });
// Cliente Postgres efímero que comparte la red del contenedor local y monta el volumen del dump.
const client = (cmd) =>
  docker([
    "run",
    "--rm",
    `--network=container:${CONTAINER}`,
    "-v",
    `${TMP_VOLUME}:/dump`,
    CLIENT_IMAGE,
    ...cmd,
  ]);

// ¿Docker responde? ¿Y el contenedor local está corriendo?
assertDocker();
const running = execFileSync("docker", ["ps", "-q", "-f", `name=^${CONTAINER}$`])
  .toString()
  .trim();
if (!running) {
  console.error(
    `✗ El contenedor ${CONTAINER} no está corriendo.\n  Levántalo con: pnpm setup:db   (o: docker start ${CONTAINER})`
  );
  process.exit(1);
}

try {
  console.log(`▶ 1/3 Dump de producción (cliente ${CLIENT_IMAGE})…`);
  client([
    "pg_dump",
    "--format=custom",
    "--no-owner",
    "--no-privileges",
    "-f",
    DUMP_PATH,
    prodClean,
  ]);

  console.log("▶ 2/3 Reseteando la DB local (DROP SCHEMA public)…");
  client([
    "psql",
    localInside,
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    "DROP SCHEMA public CASCADE; CREATE SCHEMA public;",
  ]);

  console.log("▶ 3/3 Restaurando en la DB local…");
  client([
    "pg_restore",
    "--no-owner",
    "--no-privileges",
    "--dbname",
    localInside,
    DUMP_PATH,
  ]);
} finally {
  // Borra el volumen temporal (contiene el dump con datos de prod); no aborta si falla.
  try {
    execFileSync("docker", ["volume", "rm", "-f", TMP_VOLUME], {
      stdio: "ignore",
    });
  } catch {}
}

console.log(
  "✓ DB de producción clonada a local. Si el schema cambió, corre: pnpm prisma generate"
);
