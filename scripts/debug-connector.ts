// Debug del conector propio: corre ensureSession + readProducts y reporta dónde se traba y cuánto
// tarda. Headless por defecto; SHOW=1 abre la ventana. Guarda login-fail.png si el login falla.
//   node --env-file=.env scripts/debug-connector.ts        (headless)
//   SHOW=1 node --env-file=.env scripts/debug-connector.ts (visible)
import { BancoChileConnector } from "../arch/v1/infrastructure/http/bancochile/bancochile.connector.ts";
import { loadBancoChileCreds } from "../arch/v1/infrastructure/http/bancochile/bancochile-credentials.ts";
import { prisma } from "../arch/v1/infrastructure/database/prisma/client.ts";

const cred = await prisma.bankCredential.findFirst({ where: { provider: "bancochile" } });
if (!cred) {
  console.error("SIN CREDENCIALES en la DB — reconéctate en la app primero.");
  process.exit(1);
}
const creds = await loadBancoChileCreds(cred.userId);
console.log("creds OK (rut", creds?.rut, ") — instanciando conector", process.env.SHOW === "1" ? "VISIBLE" : "headless");

const c = new BancoChileConnector("scripts/.bch-local/debug-profile", { creds: creds!, show: process.env.SHOW === "1" });
const t = Date.now();
const secs = () => ((Date.now() - t) / 1000).toFixed(0) + "s";
try {
  console.log(`[${secs()}] ensureSession()…`);
  await c.ensureSession();
  console.log(`[${secs()}] sesión OK — readProducts()…`);
  const p = await c.readProducts();
  console.log(`[${secs()}] productos:`, p.products.length, p.products.map((x) => `${x.rawType}(${x.buckets.length}b)`).join(", "));
} catch (e) {
  console.error(`[${secs()}] FALLÓ:`, (e as Error).message);
} finally {
  await c.close();
  await prisma.$disconnect();
}
