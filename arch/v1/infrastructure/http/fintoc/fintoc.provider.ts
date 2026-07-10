// Adapter Fintoc del port BankAggregationProvider. Usa `fetch` contra la REST API
// (https://api.fintoc.com/v1). Auth por header `Authorization: <secret>` (sin "Bearer") + el
// `link_token` como query param. Devuelve datos crudos; el mapeo a dominio vive en la aplicación.
import { fintocConfig } from "../../../../../lib/fintoc/config.ts";
import { BankConnectionError } from "../../../domain/finance/finance.domain.ts";
import type {
  BankAggregationProvider,
  ProviderAccount,
  ProviderMovement,
} from "../../../domain/finance/bank-aggregation.port.ts";

const MAX_PAGES = 20; // ponytail: tope de páginas (≈600 movimientos/cuenta). Subir si hace falta más histórico.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fintocGet(path: string): Promise<{ rows: any[] }> {
  const { secretKey, baseUrl } = fintocConfig();
  // Sigue la paginación por header `Link` (rel="next") hasta agotar o el tope.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows: any[] = [];
  let url: string | null = `${baseUrl}${path}`;
  for (let page = 0; url && page < MAX_PAGES; page++) {
    const res: Response = await fetch(url, {
      headers: { Authorization: secretKey, Accept: "application/json" },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new BankConnectionError(`Fintoc ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = await res.json();
    if (Array.isArray(data)) rows.push(...data);
    else return { rows: [data] };
    url = nextLink(res.headers.get("link"));
  }
  return { rows };
}

// Extrae la URL `rel="next"` del header Link (RFC 5988), o null si no hay.
function nextLink(header: string | null): string | null {
  if (!header) return null;
  for (const part of header.split(",")) {
    const m = part.match(/<([^>]+)>\s*;\s*rel="?next"?/);
    if (m) return m[1];
  }
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toProviderAccount(a: any): ProviderAccount {
  const number: string | null = a.number ?? null;
  return {
    externalId: a.id,
    name: a.name ?? a.official_name ?? "Cuenta",
    officialName: a.official_name ?? null,
    rawType: a.type ?? "",
    currency: a.currency ?? "CLP",
    numberLast4: number ? number.replace(/\D/g, "").slice(-4) || null : null,
    balanceCurrent: Number(a.balance?.current ?? 0),
    balanceLimit: a.balance?.limit == null ? null : Number(a.balance.limit),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toProviderMovement(m: any): ProviderMovement {
  return {
    externalId: m.id,
    description: m.description ?? "",
    amount: Number(m.amount ?? 0),
    currency: m.currency ?? "CLP",
    postDate: m.post_date ?? m.transaction_date,
    transactionDate: m.transaction_date ?? m.post_date,
    status: m.status ?? null,
    pending: Boolean(m.pending),
  };
}

export const fintocProvider: BankAggregationProvider = {
  async listAccounts(linkToken) {
    const { rows } = await fintocGet(`/accounts/?link_token=${encodeURIComponent(linkToken)}`);
    return rows.map(toProviderAccount);
  },
  async listMovements(linkToken, accountExternalId, opts) {
    const params = new URLSearchParams({
      link_token: linkToken,
      confirmed_only: String(opts?.confirmedOnly ?? false),
      per_page: "300",
    });
    // updated_since → solo movimientos nuevos o modificados desde el último sync (incremental).
    if (opts?.updatedSince) params.set("updated_since", opts.updatedSince.toISOString());
    // since → solo movimientos con post_date ≥ fecha (YYYY-MM-DD). Acota la primera conexión al mes
    // actual sin descargar todo el histórico.
    if (opts?.since) params.set("since", opts.since.toISOString().slice(0, 10));
    const { rows } = await fintocGet(`/accounts/${encodeURIComponent(accountExternalId)}/movements?${params.toString()}`);
    return rows.map(toProviderMovement);
  },
  async revokeLink(linkId) {
    const { secretKey, baseUrl } = fintocConfig();
    const res = await fetch(`${baseUrl}/links/${encodeURIComponent(linkId)}`, {
      method: "DELETE",
      headers: { Authorization: secretKey, Accept: "application/json" },
    });
    // 204 = revocado; 404 = ya no existe (ok). Otro código → error.
    if (!res.ok && res.status !== 404) {
      const body = await res.text().catch(() => "");
      throw new BankConnectionError(`Fintoc DELETE link ${res.status}: ${body.slice(0, 200)}`);
    }
  },
};
