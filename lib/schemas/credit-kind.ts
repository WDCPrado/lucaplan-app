import { z } from "zod"

/** cambiarTipoAbono: corrige la clasificación de un abono no interno (ingreso ↔ reembolso). */
export const changeCreditKindSchema = z.strictObject({
  transactionId: z.string().trim().min(1).max(200),
  creditKind: z.enum(["income", "reimbursement"]),
})
export type ChangeCreditKindInput = z.infer<typeof changeCreditKindSchema>
