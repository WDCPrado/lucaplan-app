// Setup de la DB local: parsea DATABASE_URL, levanta Postgres en Docker,
// espera a que responda, y corre prisma generate + migrate deploy.
// Uso: pnpm setup:db   (o: node scripts/setup-db.mjs)
import "dotenv/config";
import { execFileSync, execSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

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

const dockerOut = (args) =>
  execFileSync("docker", args, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();

// 1. Contenedor: reusar si existe, si no crearlo
if (dockerOut(["ps", "-aq", "-f", `name=^${name}$`])) {
  console.log(`▶ ${name} ya existe → docker start`);
  execFileSync("docker", ["start", name], { stdio: "inherit" });
} else {
  console.log(`▶ Creando ${name} (postgres:17-alpine) en :${hostPort}`);
  execFileSync("docker", [
    "run", "-d", "--name", name,
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

// 3. Prisma
console.log("▶ prisma generate");
execSync("prisma generate", { stdio: "inherit" });
console.log("▶ prisma migrate deploy");
execSync("prisma migrate deploy", { stdio: "inherit" });

console.log("✓ Base de datos lista");
