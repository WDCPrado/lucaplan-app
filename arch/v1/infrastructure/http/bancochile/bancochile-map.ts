// Mapeo PURO: JSON crudo del portal de Banco de Chile → tipos del port (RawProduct/RawMovement/
// RawUnbilledMovement). Sin navegador ni fetch: lo usan tanto el conector en vivo como el conector de
// datos posteados por la extensión/userscript. Testeable con fixtures.
/* eslint-disable @typescript-eslint/no-explicit-any */
import type {
  LocalProductsSnapshot,
  RawBucket,
  RawMovement,
  RawProduct,
  RawUnbilledMovement,
} from "../../../domain/finance/local-bank-connector.port.ts";

// USD llega en unidad mayor (48.51) → mínima (centavos). CLP ya es entero (peso = mínima).
export const usdMinor = (v: any): number => Math.round(Number(v ?? 0) * 100);
export const clpMinor = (v: any): number => Math.round(Number(v ?? 0));
export const last4 = (s: any): string | null => {
  const d = String(s ?? "").replace(/\D/g, "");
  return d.length >= 4 ? d.slice(-4) : null;
};

// "20260710 21:46:41" → Date (parte fecha, UTC). Fallback a epoch (fechaContableMovimiento).
export function parseCartolaDate(fecha: any, epoch?: any): Date {
  const s = String(fecha ?? "").replace(/\D/g, "");
  if (s.length >= 8) return new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8)));
  return new Date(Number(epoch ?? 0));
}

// Cuerpos crudos que produce el portal (los que postea la extensión, o los que lee el conector en vivo).
export type BchRawData = {
  saldos: any[]; // GET cuentas/saldos
  productos: any; // GET obtenerProductos (rut, nombre, productos[])
  infoTarjetas: any[]; // POST informacion-tarjetas
  tarjetaSaldos: Record<string, any>; // idTarjeta → POST saldo/obtener-saldo
  cartola: Record<string, any[]>; // numero cuenta → movimientos[] (todas las páginas)
  noFacturados: Record<string, any[]>; // idTarjeta → listaMovNoFactur[]
};

// Cuentas, tarjetas y buckets (saldos/cupos) a partir de saldos + obtenerProductos + saldo de tarjetas.
export function mapProducts(d: Pick<BchRawData, "saldos" | "productos" | "infoTarjetas" | "tarjetaSaldos">): LocalProductsSnapshot {
  const saldoRows: any[] = Array.isArray(d.saldos) ? d.saldos : [];
  const prods: any[] = d.productos?.productos ?? [];
  const infoTarjetas: any[] = Array.isArray(d.infoTarjetas) ? d.infoTarjetas : [];
  const products: RawProduct[] = [];

  // Cuenta corriente: cash (saldo CTD) + overdraft (línea LCD como bucket de la cuenta).
  const ctd = prods.find((p) => p.codigo === "CTD");
  if (ctd) {
    const ctdSaldo = saldoRows.find((s) => s.codProducto === "CTD" || s.tipo === "CUENTA_CORRIENTE");
    const lcdSaldo = saldoRows.find((s) => s.codProducto === "LCD" || s.tipo === "LINEA_CREDITO");
    const buckets: RawBucket[] = [
      { kind: "cash", currency: "CLP", limit: 0, used: 0, available: clpMinor(ctdSaldo?.disponible) },
    ];
    if (lcdSaldo) {
      // used=null → el use-case calcula la deuda (autorizado − disponible).
      buckets.push({ kind: "overdraft", currency: "CLP", limit: clpMinor(lcdSaldo.cupo), used: null, available: clpMinor(lcdSaldo.disponible) });
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

  // Tarjetas de crédito (codigo TNM): buckets nacional (CLP) + internacional (USD).
  for (const t of prods.filter((p) => p.codigo === "TNM")) {
    const info = infoTarjetas.find((x) => x.idProducto === t.id);
    const s = d.tarjetaSaldos?.[t.id];
    const buckets: RawBucket[] = [];
    if (s?.cupoTotalNacional != null) {
      buckets.push({ kind: "credit_national", currency: "CLP", limit: clpMinor(s.cupoTotalNacional), used: clpMinor(s.cupoUtilizadoNacional), available: clpMinor(s.cupoDisponibleNacional) });
    }
    if (s?.cupoTotalInternacional != null) {
      buckets.push({ kind: "credit_international", currency: "USD", limit: usdMinor(s.cupoTotalInternacional), used: usdMinor(s.cupoUtilizadoInternacional), available: usdMinor(s.cupoDisponibleInternacional) });
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

// Movimientos internos (no cuentan en presupuesto): pagos/transferencias de línea y tarjeta, y
// traspasos de salida. Se dejan visibles en la lista pero fuera del gasto. Traspasos DE: (entrada)
// se conservan como posible ingreso. ponytail: heurística por glosa; ajustar si aparecen otros casos.
const INTERNAL_CARTOLA_RE =
  /transferencia desde l[ií]nea|pago l[ií]nea de cr|pago tarjeta de cr[eé]dito|cargo por pago tc|pago pr[eé]stamo|intereses l[ií]nea|impuesto l[ií]nea|traspaso a:/i;

export function isInternalCartola(descripcion: string): boolean {
  return INTERNAL_CARTOLA_RE.test(descripcion ?? "");
}

// Movimientos de cartola (cuenta corriente) → RawMovement (id estable; signo por cargo/abono).
export function mapCartolaMovimientos(movimientos: any[]): RawMovement[] {
  return (movimientos ?? []).map((m) => {
    const magnitude = clpMinor(m.monto);
    return {
      externalId: m.id,
      date: parseCartolaDate(m.fecha, m.fechaContableMovimiento),
      description: m.descripcion ?? "",
      amount: m.tipo === "cargo" ? -magnitude : magnitude, // cargo = gasto (−), abono = ingreso (+)
      currency: "CLP",
      isInternal: isInternalCartola(m.descripcion ?? ""),
    };
  });
}

// Movimientos no facturados de tarjeta → RawUnbilledMovement (sin id; ámbito NAC/INT → moneda).
export function mapNoFacturados(lista: any[]): RawUnbilledMovement[] {
  return (lista ?? []).map((m) => {
    const scope: "national" | "international" = m.origenTransaccion === "INT" ? "international" : "national";
    const currency = scope === "international" ? "USD" : "CLP";
    // VERIFICAR: para INT, ¿el monto en USD es montoMonedaOrigen? (montoCompra podría venir en CLP).
    const rawAmount = scope === "international" ? (m.montoMonedaOrigen ?? m.montoCompra) : m.montoCompra;
    const amount = currency === "USD" ? usdMinor(rawAmount) : clpMinor(rawAmount);
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
