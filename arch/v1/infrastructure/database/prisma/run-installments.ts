// Paso de cuotas para el import de correo: corre ANTES de la IA, igual que el match de recurrentes.
// Lo que un plan reclama queda con su categoría y revisado, así que la IA ya no lo ve.
//
// Solo engancha el pago de una CUOTA de crédito: el movimiento ya existe (lo creó el import) y el
// plan `loan` lo adopta. El pago de la TARJETA no toca cuotas `card`: se saldan al conciliar la
// factura (lucaplan_pagar_cuota), porque el correo trae el total y no dice qué cuotas cobró.
import { prisma } from "./client.ts"
import { Money, type CurrencyCode } from "../../../domain/finance/money.ts"
import { adoptLoanInstallment } from "../../../application/finance-use-cases/installment-use-cases.ts"
import { installmentPlanRepository } from "./installment.infrastructure.ts"

const deps = { installments: installmentPlanRepository }

/**
 * Procesa los movimientos recién importados que disparan cuotas. Devuelve cuántas cuotas quedaron
 * adoptadas.
 */
export async function runInstallmentsForImported(
  userId: string,
  externalIds: string[]
): Promise<number> {
  if (externalIds.length === 0) return 0

  const rows = await prisma.transaction.findMany({
    where: { userId, externalId: { in: externalIds }, installmentItemId: null },
    select: {
      id: true,
      accountId: true,
      amount: true,
      currency: true,
      transactionDate: true,
      description: true,
    },
    orderBy: { transactionDate: "asc" },
  })

  let registered = 0
  for (const row of rows) {
    // El pago de una cuota de crédito de consumo es un gasto real: el plan lo adopta tal cual.
    if (isLoanInstallmentPayment(row.description)) {
      const claimed = await adoptLoanInstallment(deps, {
        transactionId: row.id,
        accountId: row.accountId,
        amount: Money.of(row.amount.toString(), row.currency as CurrencyCode),
        date: row.transactionDate,
        installmentNumber: parseInstallmentNumber(row.description),
      })
      if (claimed) registered++
    }
  }
  return registered
}

// La descripción la escribe el propio parser (bancochile-email-map), no el usuario: es estable.
function isLoanInstallmentPayment(description: string): boolean {
  return /cr[eé]dito de consumo/i.test(description)
}

function parseInstallmentNumber(description: string): number | null {
  const m = description.match(/cuota\s+(\d{1,3})\b/i)
  return m ? Number(m[1]) : null
}
