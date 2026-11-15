import type { TransactionDTO } from "@/arch/v1/application/finance-use-cases/finance-read"
import { financeResponseError } from "../finance-form-field"
import { ApiError } from "../onboarding/http"

export { ApiError }

// Reembolsos (WDC-184): un abono dice a qué gasto devuelve y cuánto.

export type ReimbursementLink = { id: string; amount: number; transaction: TransactionDTO }

export type ReimbursementCandidate = {
  id: string
  date: string
  description: string
  amount: number
  free: number // lo que al gasto aún le falta por devolver
  categoryName: string | null
}

async function call<T>(url: string, init: RequestInit, fallback: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init })
  if (!res.ok) throw new ApiError(await financeResponseError(res, fallback), res.status)
  return res.json()
}

/** GET /api/transactions/[id]/reimbursements: los vínculos del abono o del gasto. */
export const listReimbursements = (transactionId: string, signal?: AbortSignal) =>
  call<{ links: ReimbursementLink[] }>(
    `/api/transactions/${transactionId}/reimbursements`,
    { signal },
    "No se pudieron cargar los reembolsos."
  ).then((d) => d.links)

/** GET /api/transactions/[id]/reimbursement-candidates: gastos con saldo por devolver. */
export const listReimbursementCandidates = (transactionId: string, signal?: AbortSignal) =>
  call<{ creditFree: number; candidates: ReimbursementCandidate[] }>(
    `/api/transactions/${transactionId}/reimbursement-candidates`,
    { signal },
    "No se pudieron cargar los gastos."
  )

/** POST /api/transactions/[id]/reimbursements: vincula el abono a un gasto por un monto. */
export const linkReimbursement = (transactionId: string, body: { expenseId: string; amount: number }) =>
  call<{ reimbursementId: string; amount: number }>(
    `/api/transactions/${transactionId}/reimbursements`,
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
    "No se pudo vincular el reembolso."
  )

/** DELETE /api/transactions/[id]/reimbursements/[linkId]: deshace un vínculo. */
export const unlinkReimbursement = (transactionId: string, linkId: string) =>
  fetch(`/api/transactions/${transactionId}/reimbursements/${linkId}`, {
    method: "DELETE",
    cache: "no-store",
  }).then(async (res) => {
    if (!res.ok)
      throw new ApiError(await financeResponseError(res, "No se pudo deshacer el vínculo."), res.status)
  })
