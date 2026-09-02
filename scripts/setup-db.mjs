// Setup de la DB local desde cero: parsea DATABASE_URL, levanta Postgres en Docker, espera a que
// responda, y RESETEA la base (borra TODO) re-aplicando migraciones + seed.
// ⚠ Destructivo: borra todos los datos. Solo actúa sobre una DB local (aborta si no lo es).
// Uso: pnpm setup:db   (o: node scripts/setup-db.mjs)
import "dotenv/config";
import { execFileSync, execSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { assertDocker } from "./docker.mjs";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("✗ Falta DATABASE_URL (revisa tu .env)");
  process.exit(1);
}

const { username, password, hostname, port, pathname } = new URL(url);
const user = decodeURIComponent(username);
const pass = decodeURIComponent(password);
const db = decodeURIComponent(pathname.replace(/^\//, ""));
const hostPort = port || "5432";
const name = "lucaplan-postgres";

if (!["localhost", "127.0.0.1", ""].includes(hostname)) {
  console.warn(`⚠ DATABASE_URL apunta a ${hostname}, no a localhost; el Docker local igual escuchará en :${hostPort}`);
}

assertDocker();

const dockerOut = (args) =>
  execFileSync("docker", args, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();

// 1. Contenedor: reusar si existe, si no crearlo. Siempre con restart=unless-stopped para que
// arranque solo con el daemon (Docker Desktop, o systemd en Linux con `docker` habilitado;
// sin esto la DB queda caída tras cada reinicio).
if (dockerOut(["ps", "-aq", "-f", `name=^${name}$`])) {
  console.log(`▶ ${name} ya existe → docker start (+ restart unless-stopped)`);
  execFileSync("docker", ["update", "--restart", "unless-stopped", name], { stdio: "ignore" });
  execFileSync("docker", ["start", name], { stdio: "inherit" });
} else {
  console.log(`▶ Creando ${name} (postgres:17-alpine) en :${hostPort}`);
  execFileSync("docker", [
    "run", "-d", "--name", name,
    "--restart", "unless-stopped",
    "-e", `POSTGRES_USER=${user}`,
    "-e", `POSTGRES_PASSWORD=${pass}`,
    "-e", `POSTGRES_DB=${db}`,
    "-p", `${hostPort}:5432`,
    "-v", `${name}-data:/var/lib/postgresql/data`,
    "postgres:17-alpine",
  ], { stdio: "inherit" });
}

// 2. Esperar a que Postgres acepte conexiones
process.stdout.write("▶ Esperando a Postgres");
let ready = false;
for (let i = 0; i < 30; i++) {
  try {
    execFileSync("docker", ["exec", name, "pg_isready", "-U", user, "-d", db], { stdio: "ignore" });
    ready = true;
    break;
  } catch {
    process.stdout.write(".");
    await sleep(1000);
  }
}
console.log(ready ? " ✓" : "");
if (!ready) {
  console.error("✗ Postgres no respondió tras 30s");
  process.exit(1);
}

// 3. Prisma: reset destructivo (borra TODO) + re-aplica migraciones + seed.
// Guarda: migrate reset usa DATABASE_URL; si apunta a una DB no local, abortar para no nukear prod.
if (!["localhost", "127.0.0.1", ""].includes(hostname)) {
  console.error(`✗ setup:db BORRA TODA la base. DATABASE_URL apunta a "${hostname}" (no local); abortando por seguridad.`);
  process.exit(1);
}
console.log("▶ prisma generate");
execSync("prisma generate", { stdio: "inherit" });
console.log("▶ prisma migrate reset --force  (borra todo y re-aplica migraciones)");
execSync("prisma migrate reset --force", { stdio: "inherit" });
console.log("▶ seed");
execSync("node --env-file=.env prisma/seed.ts", { stdio: "inherit" });

console.log("✓ Base de datos reseteada: todo borrado, migraciones + seed aplicados");
