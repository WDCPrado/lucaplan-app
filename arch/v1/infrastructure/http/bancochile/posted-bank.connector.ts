// Conector de datos POSTEADOS: implementa LocalBankConnector a partir del JSON crudo que la extensión/
// userscript ya leyó desde el navegador del usuario. No abre navegador ni hace fetch (la sesión y la
// lectura las hizo el usuario en su navegador real). Reusa el mapeo puro compartido.
import type {
  LocalBankConnector,
  LocalProductsSnapshot,
  RawMovement,
  RawUnbilledMovement,
} from "../../../domain/finance/local-bank-connector.port.ts";
import { mapProducts, mapCartolaMovimientos, mapNoFacturados, type BchRawData } from "./bancochile-map.ts";

export class PostedBankConnector implements LocalBankConnector {
  constructor(private readonly data: BchRawData) {}

  async ensureSession(): Promise<void> {
    // no-op: la autenticación y la lectura ocurrieron en el navegador del usuario.
  }

  async readProducts(): Promise<LocalProductsSnapshot> {
    return mapProducts(this.data);
  }

  async readCartola(accountExternalId: string, opts?: { since?: Date }): Promise<RawMovement[]> {
    const movs = mapCartolaMovimientos(this.data.cartola?.[accountExternalId] ?? []);
    return opts?.since ? movs.filter((m) => m.date >= opts.since!) : movs;
  }

  async readUnbilled(cardExternalId: string): Promise<RawUnbilledMovement[]> {
    return mapNoFacturados(this.data.noFacturados?.[cardExternalId] ?? []);
  }

  async close(): Promise<void> {
    // no-op
  }
}
