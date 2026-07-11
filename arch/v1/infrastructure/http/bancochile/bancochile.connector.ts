// Conector LOCAL de Banco de Chile (implementa LocalBankConnector). Automatiza el navegador con
// Patchright (Chromium stealth) y perfil persistente. Solo lectura. Llama las APIs JSON internas del
// portal DESDE la página (page.evaluate + fetch), que es lo único que pasa el anti-bot (Shape/F5):
// `context.request` recibe un challenge, no el JSON. El usuario inicia sesión (2FA) en la ventana;
// no automatizamos credenciales ni evadimos controles. Ante 401/403/429/challenge → BankBlockedError.
//
// Fuentes de los endpoints/payloads/formas: spike guiado (scripts/spike-bch-*.ts). Puntos marcados
// `VERIFICAR` requieren una sesión limpia para confirmar (monto de movimientos internacionales,
// nombre del titular en el payload de tarjeta).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { chromium } from "patchright";
import type {
  LocalBankConnector,
  LocalProductsSnapshot,
  RawBucket,
  RawMovement,
  RawProduct,
  RawUnbilledMovement,
} from "../../../domain/finance/local-bank-connector.port.ts";
import { BankBlockedError } from "../../../domain/finance/local-bank-connector.port.ts";

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
const MAX_PAGES = 40; // ponytail: tope de páginas de cartola (~4000 movs). Subir si hace falta más histórico.
const LOGIN_TIMEOUT_MS = 180_000;

type ApiResult = { status: number; body: any; raw: string | null };

// USD llega en unidad mayor (ej. 48.51) → a mínima (centavos). CLP ya es entero (peso = mínima).
const usd = (v: any): number => Math.round(Number(v ?? 0) * 100);
const clp = (v: any): number => Math.round(Number(v ?? 0));
const last4 = (s: any): string | null => {
  const d = String(s ?? "").replace(/\D/g, "");
  return d.length >= 4 ? d.slice(-4) : null;
};

// "20260710 21:46:41" → Date (parte fecha, UTC). Fallback a epoch si viene fechaContableMovimiento.
function parseCartolaDate(fecha: any, epoch?: any): Date {
  const s = String(fecha ?? "").replace(/\D/g, "");
  if (s.length >= 8) return new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8)));
  return new Date(Number(epoch ?? 0));
}

export class BancoChileConnector implements LocalBankConnector {
  private ctx: any = null;
  private page: any = null;
  private productos: any = null; // cache de obtenerProductos (identificadores para los payloads)
  private infoTarjetas: any[] = []; // cache de informacion-tarjetas

  constructor(private readonly profileDir: string) {}

  // --- API vía la página (contexto autenticado + anti-bot) ---

  private async apiGet(path: string): Promise<ApiResult> {
    return this.page.evaluate(async ([base, p]: [string, string]) => {
      const r = await fetch(base + p, { headers: { accept: "application/json" }, credentials: "include" });
      const text = await r.text();
      let body: any = null;
      try { body = JSON.parse(text); } catch { /* challenge/HTML */ }
      return { status: r.status, body, raw: body ? null : text.slice(0, 200) };
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
      return { status: r.status, body, raw: body ? null : text.slice(0, 200) };
    }, [BASE, path, data]);
  }

  // Parada dura ante bloqueo/anti-bot: 401/403/429 o respuesta que no es JSON (challenge).
  private assertOk(r: ApiResult, what: string): void {
    if (r.status === 401 || r.status === 403 || r.status === 429) {
      throw new BankBlockedError(`${what}: HTTP ${r.status} (bloqueo/sesión expirada)`);
    }
    if (r.body == null) {
      throw new BankBlockedError(`${what}: respuesta no-JSON (challenge anti-bot)`);
    }
  }

  private async isAuthed(): Promise<boolean> {
    if (!this.page.url().includes("portalpersonas")) return false;
    const r = await this.apiGet(EP.saldos).catch(() => null);
    return !!(r && r.status === 200 && r.body);
  }

  async ensureSession(): Promise<void> {
    if (!this.ctx) {
      this.ctx = await chromium.launchPersistentContext(this.profileDir, {
        channel: "chrome", // Chrome real: menos detección
        headless: false, // el usuario inicia sesión y resuelve 2FA en la ventana
        viewport: null,
      });
      this.page = this.ctx.pages()[0] ?? (await this.ctx.newPage());
    }
    let ok = await this.isAuthed();
    if (!ok) {
      // Entrar por el portal (no el /login pelado de Auth0, que entra en loop sin estado OAuth).
      await this.page.goto(HOME, { waitUntil: "domcontentloaded" }).catch(() => {});
      const deadline = Date.now() + LOGIN_TIMEOUT_MS;
      while (!ok && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 2000));
        ok = await this.isAuthed().catch(() => false);
      }
    }
    if (!ok) throw new BankBlockedError("No se detectó sesión iniciada (login/2FA no completado o bloqueo).");

    // Cachea identificadores para armar los payloads.
    const prods = await this.apiGet(EP.productos);
    this.assertOk(prods, "obtenerProductos");
    this.productos = prods.body;
    const info = await this.apiPost(EP.infoTarjetas, {});
    this.infoTarjetas = Array.isArray(info.body) ? info.body : [];
  }

  // --- Lectura ---

  async readProducts(): Promise<LocalProductsSnapshot> {
    const saldos = await this.apiGet(EP.saldos);
    this.assertOk(saldos, "cuentas/saldos");
    const saldoRows: any[] = Array.isArray(saldos.body) ? saldos.body : [];
    const prods: any[] = this.productos?.productos ?? [];
    const products: RawProduct[] = [];

    // Cuenta corriente: cash (saldo CTD) + overdraft (línea LCD como bucket de la cuenta).
    const ctd = prods.find((p) => p.codigo === "CTD");
    if (ctd) {
      const ctdSaldo = saldoRows.find((s) => s.codProducto === "CTD" || s.tipo === "CUENTA_CORRIENTE");
      const lcdSaldo = saldoRows.find((s) => s.codProducto === "LCD" || s.tipo === "LINEA_CREDITO");
      const buckets: RawBucket[] = [
        { kind: "cash", currency: "CLP", limit: 0, used: 0, available: clp(ctdSaldo?.disponible) },
      ];
      if (lcdSaldo) {
        // used=null → el use-case lo calcula (autorizado − disponible).
        buckets.push({ kind: "overdraft", currency: "CLP", limit: clp(lcdSaldo.cupo), used: null, available: clp(lcdSaldo.disponible) });
      }
      products.push({
        externalId: ctd.numero,
        name: ctd.label ?? "Cuenta Corriente",
        rawType: "CUENTA_CORRIENTE",
        currency: "CLP",
        last4: last4(ctd.mascara ?? ctd.numero),
        buckets,
      });
    }

    // Tarjetas de crédito (codigo TNM): buckets nacional (CLP) + internacional (USD) del saldo.
    for (const t of prods.filter((p) => p.codigo === "TNM")) {
      const info = this.infoTarjetas.find((x) => x.idProducto === t.id);
      const saldoT = await this.apiPost(EP.tarjetaSaldo, this.cardPayload(t, info));
      this.assertOk(saldoT, "tarjeta saldo/obtener-saldo");
      const s = saldoT.body;
      const buckets: RawBucket[] = [];
      if (s?.cupoTotalNacional != null) {
        buckets.push({ kind: "credit_national", currency: "CLP", limit: clp(s.cupoTotalNacional), used: clp(s.cupoUtilizadoNacional), available: clp(s.cupoDisponibleNacional) });
      }
      if (s?.cupoTotalInternacional != null) {
        buckets.push({ kind: "credit_international", currency: "USD", limit: usd(s.cupoTotalInternacional), used: usd(s.cupoUtilizadoInternacional), available: usd(s.cupoDisponibleInternacional) });
      }
      products.push({
        externalId: t.id,
        name: info ? `${info.marca} ${info.tipo}`.trim() : (t.label ?? "Tarjeta de Crédito"),
        rawType: "TARJETA_CREDITO",
        currency: "CLP",
        last4: last4(info?.numero ?? t.mascara),
        buckets,
      });
    }

    return { institutionName: "Banco de Chile", products };
  }

  async readCartola(accountExternalId: string, opts?: { since?: Date }): Promise<RawMovement[]> {
    const t = (this.productos?.productos ?? []).find((p: any) => p.numero === accountExternalId && p.codigo === "CTD");
    if (!t) return [];
    const cuentaSeleccionada = {
      nombreCliente: this.productos.nombre,
      rutCliente: this.productos.rut,
      numero: t.numero,
      mascara: t.mascara,
      selected: true,
      codigoProducto: t.codigo,
      claseCuenta: t.claseCuenta,
      moneda: t.codigoMoneda,
    };
    const out: RawMovement[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const r = await this.apiPost(EP.getCartola, { cuentaSeleccionada, cabecera: { statusGenerico: true, paginacionDesde: page } });
      this.assertOk(r, "getCartola");
      const movs: any[] = r.body?.movimientos ?? [];
      for (const m of movs) {
        const date = parseCartolaDate(m.fecha, m.fechaContableMovimiento);
        if (opts?.since && date < opts.since) return out; // newest-first: al pasar la ventana, corta
        const magnitude = clp(m.monto);
        out.push({
          externalId: m.id,
          date,
          description: m.descripcion ?? "",
          amount: m.tipo === "cargo" ? -magnitude : magnitude, // cargo = gasto (−), abono = ingreso (+)
          currency: "CLP",
        });
      }
      if (r.body?.pagina?.[0]?.masPaginas !== "Y") break; // no hay más páginas
    }
    return out;
  }

  async readUnbilled(cardExternalId: string): Promise<RawUnbilledMovement[]> {
    const t = (this.productos?.productos ?? []).find((p: any) => p.id === cardExternalId);
    if (!t) return [];
    const info = this.infoTarjetas.find((x) => x.idProducto === cardExternalId);
    const r = await this.apiPost(EP.noFacturados, this.cardPayload(t, info));
    this.assertOk(r, "movimientos-no-facturados");
    const lista: any[] = r.body?.listaMovNoFactur ?? [];
    return lista.map((m) => {
      const scope: "national" | "international" = m.origenTransaccion === "INT" ? "international" : "national";
      const currency = scope === "international" ? "USD" : "CLP";
      // VERIFICAR: para INT, ¿el monto en USD es montoMonedaOrigen? (montoCompra podría venir en CLP).
      const rawAmount = scope === "international" ? (m.montoMonedaOrigen ?? m.montoCompra) : m.montoCompra;
      const amount = currency === "USD" ? usd(rawAmount) : clp(rawAmount);
      const [cur, tot] = String(m.despliegueCuotas ?? "").split("/").map((n) => Number(n));
      return {
        date: new Date(Number(m.fechaTransaccion ?? 0)),
        description: m.glosaTransaccion ?? "",
        amount,
        currency,
        scope,
        installments: cur && tot ? { current: cur, total: tot } : null,
      };
    });
  }

  async close(): Promise<void> {
    await this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.page = null;
  }

  // Payload compartido de tarjeta (saldo y no facturados).
  // VERIFICAR: `nombreTitular` — en la captura fue el titular en mayúsculas (formato apellidos-nombre);
  // acá se usa el nombre de obtenerProductos como aproximación hasta confirmar la fuente exacta.
  private cardPayload(t: any, info: any): Record<string, unknown> {
    return {
      idTarjeta: t.id,
      codigoProducto: "TNM",
      tipoTarjeta: info ? `${info.marca} ${info.tipo}` : "",
      mascara: t.mascara ?? (info?.numero ? `****${last4(info.numero)}` : ""),
      nombreTitular: this.productos?.nombre ?? "",
      tipoCliente: "T",
    };
  }
}
