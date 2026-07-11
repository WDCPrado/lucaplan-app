// Conector LOCAL de Banco de Chile con AUTO-LOGIN (implementa LocalBankConnector). Patchright
// (Chromium stealth) + perfil persistente, en la máquina del usuario. Login de solo-lectura por
// RUT + clave (BCH no pide 2FA para consultar; sí para transferir). Baja cadencia (cron 1-2×/día)
// para no gatillar el anti-bot. Llama las APIs internas DESDE la página (page.evaluate + fetch), lo
// único que pasa el anti-bot. Solo lectura; para duro ante 401/403/429/challenge. El mapeo crudo→
// dominio es el compartido (bancochile-map.ts).
/* eslint-disable @typescript-eslint/no-explicit-any */
import path from "node:path";
import { chromium } from "patchright";
import type {
  LocalBankConnector,
  LocalProductsSnapshot,
  RawMovement,
  RawUnbilledMovement,
} from "../../../domain/finance/local-bank-connector.port.ts";
import { BankBlockedError } from "../../../domain/finance/local-bank-connector.port.ts";
import { mapProducts, mapCartolaMovimientos, mapNoFacturados } from "./bancochile-map.ts";

const BASE = "https://portalpersonas.bancochile.cl/mibancochile/rest/persona";
const HOME = "https://portalpersonas.bancochile.cl/mibancochile-web/front/persona/index.html";
const EP = {
  saldos: "/bff-pp-prod-ctas-saldos/productos/cuentas/saldos",
  productos: "/selectorproductos/selectorProductos/obtenerProductos?incluirTarjetas=true",
  infoTarjetas: "/tarjetas/widget/informacion-tarjetas",
  getCartola: "/bff-pper-prd-cta-movimientos/movimientos/getCartola",
  tarjetaSaldo: "/tarjeta-credito-digital/saldo/obtener-saldo",
  noFacturados: "/tarjeta-credito-digital/movimientos-no-facturados",
} as const;
const MAX_PAGES = 40;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type ApiResult = { status: number; body: any };

export type BancoChileCreds = { rut: string; pass: string };

export class BancoChileConnector implements LocalBankConnector {
  private ctx: any = null;
  private page: any = null;
  private productos: any = null;
  private infoTarjetas: any[] = [];
  private readonly rut: string;
  private readonly pass: string;
  private readonly headless: boolean;

  constructor(private readonly profileDir: string, opts?: { creds?: BancoChileCreds; headless?: boolean }) {
    this.rut = opts?.creds?.rut ?? process.env.BCH_RUT ?? "";
    this.pass = opts?.creds?.pass ?? process.env.BCH_PASS ?? "";
    this.headless = opts?.headless ?? true; // cron/background: headless. Poné false para depurar.
  }

  private async apiGet(path: string): Promise<ApiResult> {
    return this.page.evaluate(async ([base, p]: [string, string]) => {
      const r = await fetch(base + p, { headers: { accept: "application/json" }, credentials: "include" });
      const text = await r.text();
      let body: any = null;
      try { body = JSON.parse(text); } catch { /* challenge/HTML */ }
      return { status: r.status, body };
    }, [BASE, path]);
  }

  private async apiPost(path: string, data: unknown): Promise<ApiResult> {
    return this.page.evaluate(async ([base, p, d]: [string, string, unknown]) => {
      const r = await fetch(base + p, {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify(d),
      });
      const text = await r.text();
      let body: any = null;
      try { body = JSON.parse(text); } catch { /* challenge/HTML */ }
      return { status: r.status, body };
    }, [BASE, path, data]);
  }

  private assertOk(r: ApiResult, what: string): void {
    if (r.status === 401 || r.status === 403 || r.status === 429) throw new BankBlockedError(`${what}: HTTP ${r.status} (bloqueo/sesión)`);
    if (r.body == null) throw new BankBlockedError(`${what}: respuesta no-JSON (challenge anti-bot)`);
  }

  private async isAuthed(): Promise<boolean> {
    if (!String(this.page.url()).includes("portalpersonas")) return false;
    const r = await this.apiGet(EP.saldos).catch(() => null);
    return !!(r && r.status === 200 && r.body);
  }

  async ensureSession(): Promise<void> {
    if (!this.rut || !this.pass) throw new BankBlockedError("Faltan credenciales BCH_RUT / BCH_PASS en el entorno.");
    if (!this.ctx) {
      this.ctx = await chromium.launchPersistentContext(this.profileDir, { channel: "chrome", headless: this.headless, viewport: null });
      this.page = this.ctx.pages()[0] ?? (await this.ctx.newPage());
    }
    if (!(await this.isAuthed())) {
      await this.autoLogin();
    }
    // Cachea identificadores para armar los payloads.
    const prods = await this.apiGet(EP.productos);
    this.assertOk(prods, "obtenerProductos");
    this.productos = prods.body;
    const info = await this.apiPost(EP.infoTarjetas, {});
    this.infoTarjetas = Array.isArray(info.body) ? info.body : [];
  }

  // Entra por el portal (inicia el OAuth con estado limpio) y completa RUT + clave en la pantalla de
  // login. Sin 2FA (BCH no lo pide para consultar). Falla → BankBlockedError.
  private async autoLogin(): Promise<void> {
    await this.page.goto(HOME, { waitUntil: "domcontentloaded" }).catch(() => {});
    // El HOME sin sesión redirige al login de Auth0 (login.portales.bancochile.cl) con el estado
    // OAuth correcto. Esperamos el campo RUT directamente (más robusto que esperar la URL).
    try {
      const rutField = this.page.getByPlaceholder(/RUT/i).first();
      await rutField.waitFor({ timeout: 45_000 });
      await rutField.fill(this.rut);
      const passField = this.page.getByPlaceholder(/Contrase|Clave/i).first();
      await passField.fill(this.pass);
      await this.page.waitForTimeout(600); // el form (Angular) tarda en habilitar INGRESAR tras rellenar
      // Submit robusto: botón INGRESAR (varias formas) o Enter en la clave. Reintenta si el 1er clic
      // corre antes de que el botón esté accionable (era la causa del "funcionó a la segunda").
      const btn = this.page.locator('button:has-text("INGRESAR"), button[type=submit], input[type=submit]').first();
      let ok = false;
      for (let i = 0; i < 3 && !ok; i++) {
        ok = await btn.click({ timeout: 6000 }).then(() => true).catch(() => false);
        if (!ok) await this.page.waitForTimeout(800);
      }
      if (!ok) await passField.press("Enter").catch(() => {});
    } catch {
      // Form no encontrado (¿ya autenticado?, ¿challenge?, ¿layout distinto?); se valida por API.
    }
    for (let i = 0; i < 45; i++) {
      await sleep(2000);
      if (await this.isAuthed()) return;
    }
    await this.captureFailure();
    throw new BankBlockedError(
      `Login no completado. URL: ${this.page.url()}. Hay un screenshot en el perfil (login-fail.png). ` +
        "Causas posibles: clave incorrecta, challenge anti-bot en headless, o layout distinto.",
    );
  }

  // Guarda un screenshot al fallar el login, para diagnosticar sin estar mirando.
  private async captureFailure(): Promise<void> {
    try {
      await this.page.screenshot({ path: path.join(this.profileDir, "login-fail.png"), fullPage: true });
    } catch {
      /* best-effort */
    }
  }

  async readProducts(): Promise<LocalProductsSnapshot> {
    const saldos = await this.apiGet(EP.saldos);
    this.assertOk(saldos, "cuentas/saldos");
    const prods: any[] = this.productos?.productos ?? [];
    const tarjetaSaldos: Record<string, any> = {};
    for (const t of prods.filter((p) => p.codigo === "TNM")) {
      const info = this.infoTarjetas.find((x) => x.idProducto === t.id);
      const r = await this.apiPost(EP.tarjetaSaldo, this.cardPayload(t, info));
      this.assertOk(r, "tarjeta saldo/obtener-saldo");
      tarjetaSaldos[t.id] = r.body;
    }
    return mapProducts({ saldos: saldos.body, productos: this.productos, infoTarjetas: this.infoTarjetas, tarjetaSaldos });
  }

  async readCartola(accountExternalId: string, opts?: { since?: Date }): Promise<RawMovement[]> {
    const t = (this.productos?.productos ?? []).find((p: any) => p.numero === accountExternalId && p.codigo === "CTD");
    if (!t) return [];
    const cuentaSeleccionada = {
      nombreCliente: this.productos.nombre, rutCliente: this.productos.rut, numero: t.numero, mascara: t.mascara,
      selected: true, codigoProducto: t.codigo, claseCuenta: t.claseCuenta, moneda: t.codigoMoneda,
    };
    const all: any[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const r = await this.apiPost(EP.getCartola, { cuentaSeleccionada, cabecera: { statusGenerico: true, paginacionDesde: page } });
      this.assertOk(r, "getCartola");
      const movs: any[] = r.body?.movimientos ?? [];
      all.push(...movs);
      // Corte por ventana: los movimientos vienen del más nuevo al más viejo.
      if (opts?.since && movs.length) {
        const oldest = mapCartolaMovimientos([movs[movs.length - 1]])[0];
        if (oldest && oldest.date < opts.since) break;
      }
      if (r.body?.pagina?.[0]?.masPaginas !== "Y") break;
    }
    const mapped = mapCartolaMovimientos(all);
    return opts?.since ? mapped.filter((m) => m.date >= opts.since!) : mapped;
  }

  async readUnbilled(cardExternalId: string): Promise<RawUnbilledMovement[]> {
    const t = (this.productos?.productos ?? []).find((p: any) => p.id === cardExternalId);
    if (!t) return [];
    const info = this.infoTarjetas.find((x) => x.idProducto === cardExternalId);
    const r = await this.apiPost(EP.noFacturados, this.cardPayload(t, info));
    this.assertOk(r, "movimientos-no-facturados");
    return mapNoFacturados(r.body?.listaMovNoFactur ?? []);
  }

  async close(): Promise<void> {
    await this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.page = null;
  }

  // VERIFICAR: `nombreTitular` — se usa el nombre de obtenerProductos como aproximación.
  private cardPayload(t: any, info: any): Record<string, unknown> {
    return {
      idTarjeta: t.id,
      codigoProducto: "TNM",
      tipoTarjeta: info ? `${info.marca} ${info.tipo}` : "",
      mascara: t.mascara ?? "",
      nombreTitular: this.productos?.nombre ?? "",
      tipoCliente: "T",
    };
  }
}
