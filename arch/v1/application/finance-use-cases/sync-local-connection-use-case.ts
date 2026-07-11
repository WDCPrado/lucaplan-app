// Sincroniza una conexión LOCAL (scraper de banco) contra el modelo por entidades:
// Bank → Cuenta → Tarjeta → Saldo(bucket) → Transaction. Orquesta el `LocalBankConnector`
// (dominio) con operaciones de persistencia (deps, implementadas por infra). No toca navegador ni DB
// directo. Estrategia por fuente:
//   - Cuenta corriente (cartola, id estable): upsert idempotente + ventana de reconciliación solapada.
//   - Tarjeta no facturada (sin id): snapshot-replace atómico (bajar+validar antes de reemplazar).
import { Money, type CurrencyCode } from "../../domain/finance/money.ts";
import type {
  AccountType,
  BucketKind,
  CardType,
  Direction,
  ImportMovement,
  ConnectedCardInput,
  ConnectedBucketInput,
} from "../../domain/finance/finance.domain.ts";
import { overdraftUsed } from "../../domain/finance/finance.domain.ts";
import type {
  LocalBankConnector,
  RawBucket,
  RawMovement,
  RawUnbilledMovement,
} from "../../domain/finance/local-bank-connector.port.ts";

// Primera conexión: ventana inicial ~3 meses. Incremental: re-lee esta ventana solapada y hace upsert
// (movimientos tardíos o corregidos no quedan atrás; el `id` estable dedupea).
const INITIAL_MONTHS = 3;
const OVERLAP_DAYS = 30;

// Movimiento no facturado listo para persistir (sin id externo; va en un snapshot que se reemplaza).
export type UnbilledInsert = {
  bucketId: string;
  date: Date;
  description: string;
  amount: Money;
  direction: Direction;
};

export type SyncLocalDeps = {
  connector: LocalBankConnector;
  // Upsert del banco local por (userId, name). Devuelve id y el último sync (para la ventana).
  upsertBank(userId: string, name: string): Promise<{ id: string; lastSyncedAt: Date | null }>;
  // Upsert de cuenta/producto por (userId, externalId).
  upsertAccount(input: {
    userId: string;
    bankId: string;
    externalId: string;
    name: string;
    accountType: AccountType;
    currency: CurrencyCode;
  }): Promise<{ id: string }>;
  upsertCard(input: ConnectedCardInput): Promise<{ id: string }>;
  upsertBucket(input: ConnectedBucketInput): Promise<{ id: string }>;
  // Cartola: upsert por (accountId, externalId), preserva categoría. No ajusta saldo.
  importCartola(userId: string, accountId: string, bucketId: string | null, movements: ImportMovement[]): Promise<number>;
  // No facturados: reemplazo ATÓMICO de la foto de una tarjeta (borra la previa e inserta la nueva).
  replaceUnbilled(userId: string, accountId: string, cardId: string, movements: UnbilledInsert[]): Promise<number>;
  // Saldo representativo de la cuenta para la UI (corriente = cash; crédito = deuda negativa).
  setAccountBalance(accountId: string, amount: Money): Promise<void>;
  // Marca el fin de la sync (lastSyncedAt del banco).
  markSynced(bankId: string): Promise<void>;
  // Categoriza con IA los movimientos confirmados sin categoría (best-effort). Opcional.
  categorize?(userId: string): Promise<number>;
};

// --- Mapeo crudo BCH → dominio ---

function mapAccountType(rawType: string): AccountType {
  switch (rawType.toUpperCase()) {
    case "CUENTA_CORRIENTE":
      return "checking";
    case "TARJETA_CREDITO":
      return "credit_card";
    case "LINEA_CREDITO":
      return "credit_line";
    default:
      return "wallet";
  }
}

function mapBucketKind(raw: string): BucketKind {
  switch (raw) {
    case "cash":
    case "overdraft":
    case "credit_national":
    case "credit_international":
      return raw;
    default:
      return "cash";
  }
}

function cardTypeFor(accountType: AccountType): CardType {
  return accountType === "checking" ? "debito" : "credito";
}

// Money desde unidad mínima; moneda no soportada → null (se omite el producto).
function money(minor: number | null, currency: string): Money | null {
  if (currency !== "CLP" && currency !== "USD") return null;
  return Money.fromMinor(minor ?? 0, currency as CurrencyCode);
}

function bucketFromRaw(raw: RawBucket): ConnectedBucketInput | null {
  const currency = raw.currency;
  if (currency !== "CLP" && currency !== "USD") return null;
  const cur = currency as CurrencyCode;
  const kind = mapBucketKind(raw.kind);
  const limitAmount = Money.fromMinor(raw.limit ?? 0, cur);
  const available = Money.fromMinor(raw.available ?? 0, cur);
  // Sobregiro/línea: el "usado" (deuda) se calcula autorizado − disponible (el banco infla el
  // disponible con la línea). Otros buckets: el banco reporta el usado directo (o 0).
  const used =
    kind === "overdraft" ? overdraftUsed(limitAmount, available) : Money.fromMinor(raw.used ?? 0, cur);
  return {
    userId: "", // lo completa el llamador
    accountId: "",
    cardId: null,
    kind,
    currency: cur,
    limitAmount,
    used,
    available,
    asOf: null,
  };
}

function directionOf(amountMinor: number): Direction {
  return amountMinor >= 0 ? "credit" : "debit";
}

function toImportMovement(m: RawMovement): ImportMovement | null {
  const amount = money(Math.abs(m.amount), m.currency);
  if (!amount) return null;
  return {
    externalId: m.externalId,
    date: m.date,
    description: m.description,
    amount,
    direction: directionOf(m.amount),
    status: "confirmed",
  };
}

// Ventana `since`: primera vez ~3 meses; incremental = último sync − solape.
function windowSince(lastSyncedAt: Date | null, now: Date): Date {
  if (!lastSyncedAt) {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (INITIAL_MONTHS - 1), 1));
  }
  const d = new Date(lastSyncedAt);
  d.setUTCDate(d.getUTCDate() - OVERLAP_DAYS);
  return d;
}

export type SyncLocalResult = {
  bankId: string;
  accounts: number;
  cards: number;
  cartolaMovements: number;
  unbilledMovements: number;
};

// Progreso de la sincronización para reportar en vivo a la UI (paso + etiqueta legible).
export type SyncProgress = { step: string; label: string };

export async function syncLocalConnection(
  deps: SyncLocalDeps,
  userId: string,
  opts: { now?: Date; onProgress?: (p: SyncProgress) => void } = {},
): Promise<SyncLocalResult> {
  const now = opts.now ?? new Date();
  const progress = opts.onProgress ?? (() => {});

  progress({ step: "login", label: "Iniciando sesión en Banco de Chile…" });
  await deps.connector.ensureSession();
  progress({ step: "products", label: "Leyendo cuentas, tarjetas y saldos…" });
  const snapshot = await deps.connector.readProducts();
  const bank = await deps.upsertBank(userId, snapshot.institutionName || "Banco de Chile");
  const since = windowSince(bank.lastSyncedAt, now);

  let accounts = 0;
  let cards = 0;
  let cartolaMovements = 0;
  let unbilledMovements = 0;

  for (const product of snapshot.products) {
    const currency = product.currency;
    if (currency !== "CLP" && currency !== "USD") continue; // moneda no soportada → se omite
    const accountType = mapAccountType(product.rawType);
    if (accountType === "credit_line") continue; // la línea va como bucket overdraft de la corriente

    const account = await deps.upsertAccount({
      userId,
      bankId: bank.id,
      externalId: product.externalId,
      name: product.name,
      accountType,
      currency: currency as CurrencyCode,
    });
    accounts++;

    // Tarjeta: solo con identidad real (últimos 4). Todos los buckets del producto cuelgan de ella.
    let cardId: string | null = null;
    if (product.last4) {
      const card = await deps.upsertCard({
        userId,
        accountId: account.id,
        cardType: cardTypeFor(accountType),
        cardLast4: product.last4,
        brand: product.name,
        externalId: product.externalId,
      });
      cardId = card.id;
      cards++;
    }

    // Buckets (saldos/cupos). Guardo el id por kind para asignar los no facturados a su cupo, y el
    // saldo representativo para la tarjeta de la UI (corriente = cash; crédito = deuda nacional −).
    const bucketIdByKind = new Map<BucketKind, string>();
    let repBalance: Money | null = null;
    for (const rawBucket of product.buckets) {
      const b = bucketFromRaw(rawBucket);
      if (!b) continue;
      const bucket = await deps.upsertBucket({ ...b, userId, accountId: account.id, cardId });
      bucketIdByKind.set(b.kind, bucket.id);
      if (b.kind === "cash") repBalance = b.available;
      else if (b.kind === "credit_national" && !repBalance) repBalance = b.used.negate();
    }
    if (repBalance) await deps.setAccountBalance(account.id, repBalance);

    // Movimientos por fuente.
    if (accountType === "checking") {
      progress({ step: "cartola", label: `Importando movimientos de ${product.name}…` });
      const raw = await deps.connector.readCartola(product.externalId, { since });
      const movements = raw
        .map(toImportMovement)
        .filter((m): m is ImportMovement => m !== null)
        .filter((m) => m.date >= since);
      cartolaMovements += await deps.importCartola(userId, account.id, null, movements);
    } else if (accountType === "credit_card" && cardId) {
      progress({ step: "unbilled", label: `Leyendo no facturados de ${product.name}…` });
      // Snapshot-replace: bajar y VALIDAR la foto nueva antes de reemplazar (atómico en el repo).
      const unbilled = await deps.connector.readUnbilled(product.externalId);
      const toInsert = unbilledToInserts(unbilled, bucketIdByKind);
      unbilledMovements += await deps.replaceUnbilled(userId, account.id, cardId, toInsert);
    }
  }

  progress({ step: "saving", label: "Guardando…" });
  await deps.markSynced(bank.id);

  // Categorización con IA best-effort (solo confirmados; los no facturados quedan sin categoría).
  if (deps.categorize) {
    progress({ step: "categorize", label: "Categorizando movimientos…" });
    await deps.categorize(userId).catch(() => {});
  }

  return { bankId: bank.id, accounts, cards, cartolaMovements, unbilledMovements };
}

// Mapea los no facturados a inserts, asignando el bucket por ámbito (NAC→credit_national CLP,
// INT→credit_international USD). Si el bucket del ámbito no existe o la moneda no calza, se omite
// (no se adivina).
function unbilledToInserts(
  unbilled: RawUnbilledMovement[],
  bucketIdByKind: Map<BucketKind, string>,
): UnbilledInsert[] {
  const out: UnbilledInsert[] = [];
  for (const m of unbilled) {
    const kind: BucketKind = m.scope === "international" ? "credit_international" : "credit_national";
    const bucketId = bucketIdByKind.get(kind);
    if (!bucketId) continue;
    const cur: CurrencyCode = m.scope === "international" ? "USD" : "CLP";
    if (m.currency !== cur) continue;
    out.push({
      bucketId,
      date: m.date,
      description: m.description,
      amount: Money.fromMinor(Math.abs(m.amount), cur),
      direction: "debit", // una compra no facturada es un gasto
    });
  }
  return out;
}
