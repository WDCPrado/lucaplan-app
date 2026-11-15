import { z } from "zod"
import {
  reconciliationPreviewSchema,
  reconciliationProposalSchema,
  type BankReconciliationInput,
  type ReconciliationPreview,
} from "@/lib/schemas/bank-reconciliation"
import { financeResponseError } from "../finance-form-field"
import { ApiError } from "../onboarding/http"

export { ApiError }
export type { ReconciliationPreview }

// Filas que no se pueden conciliar en esta cuenta (moneda sin cupo, etc.). Opcional mientras el
// servidor no la mande; `.extend` también la acepta si el esquema compartido ya la trae.
const proposalSchema = reconciliationProposalSchema.extend({
  skipped: z
    .array(
      z.object({
        rowIndex: z.int().nonnegative().nullish(),
        reason: z.string(),
        detail: z.string(),
      })
    )
    .optional(),
})
export type ReconciliationProposal = z.infer<typeof proposalSchema>

/** El servidor rechaza aplicar con un token que ya no calza con los datos: hay que previsualizar de nuevo. */
export const isStalePreview = (e: unknown) =>
  e instanceof ApiError && /cambiaron desde la previsualizaci/i.test(e.message)

// Conciliar cartola (WDC-183): leer el archivo → propuesta (3.1), previsualizar y aplicar (3.2).

/** La entrada que va a la ruta: el id de la cuenta viaja en la URL, no en el cuerpo. */
export type ReconcileInput = Omit<BankReconciliationInput, "accountId">

async function post(url: string, init: RequestInit) {
  const res = await fetch(url, { method: "POST", cache: "no-store", ...init })
  if (!res.ok)
    throw new ApiError(
      await financeResponseError(
        res,
        "No se pudo completar. Vuelve a intentarlo."
      ),
      res.status
    )
  return res.json()
}
const json = (body: unknown): RequestInit => ({
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
})

/** POST /api/accounts/[id]/statement (multipart `file`) → propuesta. */
export async function readStatement(
  accountId: string,
  file: File
): Promise<ReconciliationProposal> {
  const body = new FormData()
  body.append("file", file)
  return proposalSchema.parse(
    await post(`/api/accounts/${accountId}/statement`, { body })
  )
}

/** POST /api/accounts/[id]/reconciliation sin previewToken: previsualiza. */
export async function previewReconciliation(
  accountId: string,
  input: ReconcileInput
): Promise<ReconciliationPreview> {
  return reconciliationPreviewSchema.parse(
    await post(`/api/accounts/${accountId}/reconciliation`, json(input))
  )
}

/** POST /api/accounts/[id]/reconciliation con previewToken: aplica. */
export async function applyReconciliation(
  accountId: string,
  input: ReconcileInput,
  previewToken: string
): Promise<ReconciliationPreview> {
  return reconciliationPreviewSchema.parse(
    await post(
      `/api/accounts/${accountId}/reconciliation`,
      json({ ...input, previewToken })
    )
  )
}
