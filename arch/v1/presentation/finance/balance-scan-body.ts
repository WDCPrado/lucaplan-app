// Parseo de los bodies de "Actualizar saldo con captura". Solo validación de forma: las fórmulas y
// las invariantes viven en el dominio.
import {
  BalanceScanError,
  MAX_SCAN_IMAGES,
  type BalanceReading,
  type BucketReading,
} from "../../domain/finance/balance-scan.domain.ts"

// Tope del data: URL de cada captura. El cliente las reescala antes de subir (~150 KB); esto es la
// red de seguridad para un cliente que no lo haga, no el tamaño esperado.
const MAX_IMAGE_CHARS = 8_000_000
const DATA_URL = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/

export function parseImagesBody(body: unknown): string[] {
  const raw = (body as { images?: unknown })?.images
  const images = Array.isArray(raw) ? raw : []
  if (images.length === 0)
    throw new BalanceScanError("Falta la captura que hay que leer")
  if (images.length > MAX_SCAN_IMAGES)
    throw new BalanceScanError(
      `Se pueden leer hasta ${MAX_SCAN_IMAGES} capturas a la vez`
    )
  return images.map((url) => {
    if (typeof url !== "string" || !DATA_URL.test(url))
      throw new BalanceScanError("Las capturas deben ser JPEG, PNG o WebP")
    if (url.length > MAX_IMAGE_CHARS)
      throw new BalanceScanError("Hay una captura demasiado grande")
    return url
  })
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

// El cupo total NO se acepta del cliente: vive en la cuenta y el escaneo solo mueve el disponible y
// el usado. Lo que venga en `limit` se ignora aquí mismo, antes de llegar a las fórmulas.
function bucket(raw: unknown): BucketReading {
  const b = (raw ?? {}) as Record<string, unknown>
  return {
    limit: null,
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
