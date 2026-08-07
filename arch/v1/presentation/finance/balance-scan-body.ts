// Parseo de los bodies de "Actualizar saldo con captura". Solo validación de forma: las fórmulas y
// las invariantes viven en el dominio.
import {
  BalanceScanError,
  type BalanceReading,
  type BucketReading,
} from "../../domain/finance/balance-scan.domain.ts"

// Tope del data: URL de la captura. El cliente la reescala antes de subir (~150 KB); esto es la red
// de seguridad para un cliente que no lo haga, no el tamaño esperado.
const MAX_IMAGE_CHARS = 8_000_000
const DATA_URL = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/

export function parseImageBody(body: unknown): string {
  const url = (body as { image?: unknown })?.image
  if (typeof url !== "string" || !DATA_URL.test(url))
    throw new BalanceScanError("La imagen debe ser JPEG, PNG o WebP")
  if (url.length > MAX_IMAGE_CHARS)
    throw new BalanceScanError("La imagen es demasiado grande")
  return url
}

// number finito → valor; ausente, null o basura → null. Un campo que no viene NO es cero: significa
// "la captura no lo mostraba", y el dominio decide qué se puede calcular sin él.
function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null
  const n = Number(value)
  if (!Number.isFinite(n))
    throw new BalanceScanError("Hay un monto que no es un número")
  return n
}

function bucket(raw: unknown): BucketReading {
  const b = (raw ?? {}) as Record<string, unknown>
  return {
    limit: num(b.limit),
    available: num(b.available),
    used: num(b.used),
  }
}

export function parseReadingBody(body: unknown): BalanceReading {
  const b = (body ?? {}) as Record<string, unknown>
  const last4 = String(b.last4 ?? "").replace(/\D/g, "")
  return {
    last4: /^\d{4}$/.test(last4) ? last4 : null,
    cash: num(b.cash),
    overdraft: bucket(b.overdraft),
    national: bucket(b.national),
    international: bucket(b.international),
  }
}
