// Port de un CONECTOR DE BANCO LOCAL (lo implementa la infraestructura, ej. el scraper de Banco de
// Chile con Patchright). Orientado a RESULTADO por fuente; la sesión es EFÍMERA (vive solo durante la
// sincronización) y no persiste tokens. El dominio no conoce navegador ni HTTP.
//
// Diferencias con el viejo port de Fintoc (a propósito): sin `linkToken`, sin `revokeLink`, sin
// cursor de servidor. La estrategia de paginación/snapshot vive en el adapter, no aquí.

// --- Datos crudos del banco (sin mapear a dominio) ---

// Un producto: cuenta corriente, línea de crédito o tarjeta de crédito. Montos en unidad MÍNIMA
// entera por moneda (como Money.fromMinor): centavos en USD, pesos en CLP.
export type RawProduct = {
  externalId: string; // número de cuenta / id de producto en el banco
  name: string;
  rawType: string; // CUENTA_CORRIENTE | LINEA_CREDITO | TARJETA_CREDITO | ...
  currency: string; // ISO 4217 crudo (CLP, USD)
  last4: string | null; // últimos 4 del número/tarjeta
  // Buckets (saldos/cupos) que expone el producto. Una tarjeta trae nacional + internacional.
  buckets: RawBucket[];
};

// Un saldo/cupo crudo. `limit`/`used`/`available` en unidad mínima; `used` puede venir null y se
// deriva (ej. sobregiro: autorizado − disponible).
export type RawBucket = {
  kind: string; // cash | overdraft | credit_national | credit_international (crudo)
  currency: string;
  limit: number | null;
  used: number | null;
  available: number | null;
};

// Movimiento de cuenta corriente (cartola): TIENE id estable → upsert idempotente.
export type RawMovement = {
  externalId: string; // id estable del banco
  date: Date;
  description: string;
  amount: number; // unidad mínima, con signo (+ abono / − cargo)
  currency: string;
  isInternal?: boolean; // transferencia/pago interno (traspaso, pago línea/tarjeta): no cuenta en presupuesto
};

// Movimiento no facturado de tarjeta: NO tiene id estable → snapshot-replace (no upsert).
export type RawUnbilledMovement = {
  date: Date;
  description: string;
  amount: number; // unidad mínima, positivo (monto de compra)
  currency: string;
  scope: "national" | "international"; // NAC/INT → determina el bucket
  installments: { current: number; total: number } | null;
};

export type LocalProductsSnapshot = {
  institutionName: string;
  products: RawProduct[];
};

// Error de bloqueo/anti-automatización del portal (401/403/429/challenge/sesión caída). El adapter
// SHALL detenerse y reportarlo, sin evadir ni reintentar agresivo.
export class BankBlockedError extends Error {
  constructor(message = "El portal bloqueó o expiró la sesión") {
    super(message);
    this.name = "BankBlockedError";
  }
}

export interface LocalBankConnector {
  // Asegura una sesión viva: abre el navegador headful (perfil persistente) y espera a que el
  // usuario inicie sesión (incl. 2FA). Idempotente si ya hay sesión. No automatiza credenciales.
  ensureSession(): Promise<void>;
  // Lee cuentas, tarjetas y buckets (saldos/cupos): la foto de productos.
  readProducts(): Promise<LocalProductsSnapshot>;
  // Movimientos de cuenta corriente (cartola), paginado internamente. `since` acota (primera vez
  // ~3 meses; incremental: ventana solapada). Si no se puede acotar, devuelve el máximo disponible.
  readCartola(accountExternalId: string, opts?: { since?: Date }): Promise<RawMovement[]>;
  // Movimientos no facturados de una tarjeta (foto completa, sin id).
  readUnbilled(cardExternalId: string): Promise<RawUnbilledMovement[]>;
  // Cierra navegador/sesión (libera el perfil).
  close(): Promise<void>;
}
