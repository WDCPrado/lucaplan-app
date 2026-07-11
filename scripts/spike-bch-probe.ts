// Sonda GUIADA del conector BCH. NO producción. Abre el portal con perfil persistente; cuando detecta
// sesión viva (cuentas/saldos responde 200), llama a CADA endpoint con los payloads reales (armados
// desde obtenerProductos) y vuelca las respuestas para confirmar el contrato del conector:
// paginación de cartola, forma de movimientos internacionales, y qué payload aceptan las tarjetas.
//
//   node_modules/.bin/tsx scripts/spike-bch-probe.ts
// ponytail: descartable; todo local en scripts/.bch-local (gitignored).

import { chromium } from "patchright";
import { mkdirSync, writeFileSync } from "node:fs";

const OUT = "scripts/.bch-local/probe";
mkdirSync(OUT, { recursive: true });
const BASE = "https://portalpersonas.bancochile.cl/mibancochile/rest/persona";
// Entrar por el portal (no el /login pelado de Auth0): inicia el OAuth con estado/nonce limpios,
// como cuando abres tu banco normalmente. El /login directo entra en loop "no encontramos tu sesión".
const HOME = "https://portalpersonas.bancochile.cl/mibancochile-web/front/persona/index.html";
const J = { accept: "application/json" };
const JP = { accept: "application/json", "content-type": "application/json" };

const ctx = await chromium.launchPersistentContext(`${OUT}/../profile`, {
  channel: "chrome",
  headless: false,
  viewport: null,
});
const page = ctx.pages()[0] ?? (await ctx.newPage());
void J;
void JP;

// Llama los endpoints DESDE la página (contexto autenticado + anti-bot), como hace el SPA. `ctx.request`
// no lleva ese contexto y recibe un challenge en vez del JSON.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function get(path: string): Promise<any> {
  return page.evaluate(async ([base, p]) => {
    const r = await fetch(base + p, { headers: { accept: "application/json" }, credentials: "include" });
    const text = await r.text();
    let body = null;
    try { body = JSON.parse(text); } catch { /* no JSON (challenge/HTML) */ }
    return { status: r.status, body, raw: body ? null : text.slice(0, 300) };
  }, [BASE, path] as const);
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function post(path: string, data: unknown): Promise<any> {
  return page.evaluate(async ([base, p, d]) => {
    const r = await fetch(base + p, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify(d),
    });
    const text = await r.text();
    let body = null;
    try { body = JSON.parse(text); } catch { /* no JSON */ }
    return { status: r.status, body, raw: body ? null : text.slice(0, 300) };
  }, [BASE, path, data] as const);
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function dump(name: string, obj: any) {
  writeFileSync(`${OUT}/${name}.json`, JSON.stringify(obj, null, 1));
  console.log(`· ${name}: status ${obj.status}`);
}

await page.goto(HOME, { waitUntil: "domcontentloaded" }).catch(() => {});
console.log("Inicia sesión en la ventana (RUT + clave + 2FA). Espero a que la sesión esté viva...");

// Poll: sesión viva cuando, ya en portalpersonas, cuentas/saldos devuelve JSON (no challenge).
let authed = false;
for (let i = 0; i < 90 && !authed; i++) {
  await new Promise((r) => setTimeout(r, 2000));
  if (!page.url().includes("portalpersonas")) continue; // aún en login/2FA
  const s = await get("/bff-pp-prod-ctas-saldos/productos/cuentas/saldos").catch(() => null);
  if (s && s.status === 200 && s.body) authed = true;
}
if (!authed) {
  console.log("No detecté sesión viva en 3 min. Cierro.");
  await ctx.close();
  process.exit(1);
}
console.log("Sesión viva ✓ — sondeando endpoints...\n");

// 1) Productos e identificadores.
const productos = await get("/selectorproductos/selectorProductos/obtenerProductos?incluirTarjetas=true");
dump("obtenerProductos", productos);
const saldos = await get("/bff-pp-prod-ctas-saldos/productos/cuentas/saldos");
dump("cuentas-saldos", saldos);
const infoTarjetas = await post("/tarjetas/widget/informacion-tarjetas", {});
dump("informacion-tarjetas", infoTarjetas);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const prods: any[] = productos.body?.productos ?? [];
const rut = productos.body?.rut;
const nombre = productos.body?.nombre;
const ctd = prods.find((p) => p.codigo === "CTD");
const tarjeta = prods.find((p) => p.codigo === "TNM" || p.tipo === "tarjeta" || (p.codigo && p.codigo.startsWith("T")));
console.log("CTD:", ctd && { numero: ctd.numero, codigo: ctd.codigo, claseCuenta: ctd.claseCuenta, moneda: ctd.codigoMoneda });
console.log("Tarjeta:", tarjeta && { id: tarjeta.id, codigo: tarjeta.codigo, mascara: tarjeta.mascara, tipoCliente: tarjeta.tipoCliente });

// 2) Cartola cuenta corriente — página 1 y 2 (para ver masPaginas / totalRegistros).
if (ctd) {
  const cuentaSeleccionada = {
    nombreCliente: nombre, rutCliente: rut, numero: ctd.numero, mascara: ctd.mascara,
    selected: true, codigoProducto: ctd.codigo, claseCuenta: ctd.claseCuenta, moneda: ctd.codigoMoneda,
  };
  const cartola1 = await post("/bff-pper-prd-cta-movimientos/movimientos/getCartola", { cuentaSeleccionada, cabecera: { statusGenerico: true, paginacionDesde: 1 } });
  dump("getCartola-p1", cartola1);
  const cartola2 = await post("/bff-pper-prd-cta-movimientos/movimientos/getCartola", { cuentaSeleccionada, cabecera: { statusGenerico: true, paginacionDesde: 2 } });
  dump("getCartola-p2", cartola2);
  console.log("  cartola pagina[0]:", JSON.stringify(cartola1.body?.pagina?.[0]));
}

// 3) Tarjeta — saldo (cupos) y no facturados (probando el payload; capturamos INT).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const info0: any = Array.isArray(infoTarjetas.body) ? infoTarjetas.body[0] : null;
if (tarjeta) {
  const mascara = tarjeta.mascara || (info0 ? "****" + String(info0.numero).slice(-4) : "");
  const tipoTarjeta = info0 ? `${info0.marca} ${info0.tipo}` : "";
  const cardPayload = {
    idTarjeta: tarjeta.id, codigoProducto: "TNM", tipoTarjeta, mascara,
    nombreTitular: nombre, tipoCliente: "T",
  };
  writeFileSync(`${OUT}/card-payload-usado.json`, JSON.stringify(cardPayload, null, 1));
  const saldoTarjeta = await post("/tarjeta-credito-digital/saldo/obtener-saldo", cardPayload);
  dump("tarjeta-saldo", saldoTarjeta);
  const noFact = await post("/tarjeta-credito-digital/movimientos-no-facturados", cardPayload);
  dump("no-facturados", noFact);
  // Resumen de los movimientos INT (lo que faltaba confirmar).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lista: any[] = noFact.body?.listaMovNoFactur ?? [];
  const intl = lista.filter((m) => m.origenTransaccion === "INT").slice(0, 3);
  console.log("  no facturados INT (muestra):", JSON.stringify(intl.map((m) => ({ glosa: m.glosaTransaccion, montoCompra: m.montoCompra, montoMonedaOrigen: m.montoMonedaOrigen, codigoMonedaOrigen: m.codigoMonedaOrigen, origen: m.origenTransaccion }))));
}

console.log("\nSonda lista. Respuestas en scripts/.bch-local/probe/. Cierro.");
await ctx.close();
