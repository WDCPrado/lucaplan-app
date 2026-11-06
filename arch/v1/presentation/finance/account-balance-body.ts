// Parseo del body de "Actualizar saldo". Solo validación de forma: las fórmulas y las invariantes
// viven en el dominio.
import {
  AccountBalanceError,
  type BalanceReading,
  type BucketReading,
} from "../../domain/finance/account-balance.domain.ts"

// number finito → valor; ausente, null o basura → null. Un campo que no viene NO es cero: significa
// "no se informó", y el dominio decide qué se puede calcular sin él.
function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null
  const n = Number(value)
  if (!Number.isFinite(n))
    throw new AccountBalanceError("Hay un monto que no es un número")
  return n
}

// El cupo total NO se acepta del cliente: vive en la cuenta y actualizar el saldo solo mueve el
// disponible y el usado. Lo que venga en `limit` se ignora aquí mismo, antes de llegar a las fórmulas.
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
