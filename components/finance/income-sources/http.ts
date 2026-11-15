import type {
  CreateIncomeSourceInput,
  UpdateIncomeSourceInput,
} from "@/lib/schemas/income-source"
import type { IncomeSourceDTO } from "@/arch/v1/application/finance-use-cases/income-source-use-cases"
import { financeResponseError } from "../finance-form-field"
import { ApiError } from "../onboarding/http"

export { ApiError }
export type { IncomeSourceDTO }

// Ingresos programados (WDC-185): lo que se espera recibir cada mes (el sueldo). Es una
// expectativa, nunca un movimiento: el dinero real sigue llegando solo del banco.

async function call<T>(url: string, init: RequestInit, fallback: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init })
  if (!res.ok) throw new ApiError(await financeResponseError(res, fallback), res.status)
  return res.status === 204 ? (undefined as T) : res.json()
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
})

/** GET /api/income-sources: los programados con su estado en el período del plan. */
export const listIncomeSources = (
  period: { year: number; month: number } | null,
  signal?: AbortSignal
) =>
  call<{ sources: IncomeSourceDTO[] }>(
    period ? `/api/income-sources?year=${period.year}&month=${period.month}` : "/api/income-sources",
    { signal },
    "No se pudieron cargar los ingresos programados."
  ).then((d) => d.sources)

/** POST /api/income-sources */
export const createIncomeSource = (body: CreateIncomeSourceInput) =>
  call<unknown>("/api/income-sources", json("POST", body), "No se pudo crear el ingreso programado.")

/** PATCH /api/income-sources/[id]: solo lo que cambió. */
export const updateIncomeSource = (id: string, body: UpdateIncomeSourceInput) =>
  call<unknown>(`/api/income-sources/${id}`, json("PATCH", body), "No se pudo guardar el ingreso programado.")

/** DELETE /api/income-sources/[id]: con abonos vinculados no borra, lo termina hoy. */
export const deleteIncomeSource = (id: string) =>
  call<{ ended?: boolean; deleted?: boolean }>(
    `/api/income-sources/${id}`,
    { method: "DELETE" },
    "No se pudo eliminar el ingreso programado."
  )

/** PATCH /api/transactions/[id]/income-source: vincula o desvincula un abono. */
export const linkCreditToIncomeSource = (transactionId: string, incomeSourceId: string | null) =>
  call<unknown>(
    `/api/transactions/${transactionId}/income-source`,
    json("PATCH", { incomeSourceId }),
    "No se pudo cambiar el ingreso programado del abono."
  )

/** PUT /api/income-sources/[id]/amounts/[yyyy-mm]: el monto esperado de un mes. */
export const setMonthAmount = (id: string, month: string, amount: number) =>
  call<unknown>(
    `/api/income-sources/${id}/amounts/${month}`,
    json("PUT", { amount }),
    "No se pudo guardar el monto del mes."
  )

/** DELETE /api/income-sources/[id]/amounts/[yyyy-mm]: el mes vuelve al monto base. */
export const deleteMonthAmount = (id: string, month: string) =>
  call<unknown>(
    `/api/income-sources/${id}/amounts/${month}`,
    { method: "DELETE" },
    "No se pudo quitar el monto del mes."
  )
