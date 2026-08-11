// Parseo del body de "Registrar del banco" (confirmación). Solo validación de forma: las reglas de
// lectura y la deduplicación viven en el dominio. Las imágenes las valida `parseImagesBody`, que ya
// cubre formato, tope de tamaño y MAX_SCAN_IMAGES.
import {
  DIRECTIONS,
  type Direction,
} from "../../domain/finance/finance.domain.ts"
import { MovementScanError } from "../../domain/finance/movement-scan.domain.ts"
import type { ConfirmedMovement } from "../../application/finance-use-cases/movement-scan-use-cases.ts"

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const MAX_DESCRIPTION = 120

export function parseMovementsBody(body: unknown): ConfirmedMovement[] {
  const raw = (body as { movements?: unknown })?.movements
  if (!Array.isArray(raw))
    throw new MovementScanError("Falta la lista de movimientos")
  return raw.map((item) => {
    const m = (item ?? {}) as Record<string, unknown>
    const date = String(m.date ?? "")
    if (!ISO_DATE.test(date))
      throw new MovementScanError("Hay un movimiento con fecha inválida")
    // Medianoche UTC: misma convención que el alta manual, y la que usa la app para mostrar el día.
    const parsed = new Date(`${date}T00:00:00.000Z`)
    if (Number.isNaN(parsed.getTime()))
      throw new MovementScanError("Hay un movimiento con fecha inválida")
    const amount = Number(m.amount)
    if (!Number.isFinite(amount) || amount <= 0)
      throw new MovementScanError("Hay un movimiento sin monto válido")
    if (!(DIRECTIONS as readonly string[]).includes(String(m.direction)))
      throw new MovementScanError("Hay un movimiento sin cargo/abono")
    return {
      date: parsed,
      description:
        String(m.description ?? "")
          .trim()
          .slice(0, MAX_DESCRIPTION) || "Movimiento del banco",
      amount,
      direction: m.direction as Direction,
    }
  })
}
