import { z } from "zod"

/** vincularReembolso desde la app: el abono va en la ruta; el gasto y el importe en CLP, aquí. */
export const linkReimbursementSchema = z.strictObject({
  expenseId: z.string().trim().min(1).max(200),
  amount: z.number().int("El importe es en pesos enteros").positive("El importe debe ser mayor a cero"),
})
export type LinkReimbursementInput = z.infer<typeof linkReimbursementSchema>
