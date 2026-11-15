import { financeResponseError } from "../finance-form-field"
import { ApiError } from "../onboarding/http"

/** PATCH /api/transactions/[id]/credit-kind: ingreso ↔ reembolso (422 si no aplica). */
export async function changeCreditKind(
  transactionId: string,
  creditKind: "income" | "reimbursement"
): Promise<void> {
  const res = await fetch(`/api/transactions/${transactionId}/credit-kind`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ creditKind }),
  })
  if (!res.ok)
    throw new ApiError(
      await financeResponseError(res, "No se pudo cambiar el tipo del abono."),
      res.status
    )
}
