import { z } from "zod"

// Ingreso programado (WDC-185): una expectativa mensual (el sueldo), nunca un movimiento. La API, el
// formulario y el MCP validan con estos esquemas.

const day = z.iso.date("Fecha inválida (YYYY-MM-DD)")

const fields = {
  name: z.string().trim().min(1, "Escribe un nombre").max(80, "Máximo 80 caracteres"),
  categoryId: z.string().trim().min(1, "Elige una categoría de ingreso").max(200),
  currency: z.enum(["CLP", "USD"]),
  amount: z.number().positive("El monto debe ser mayor a cero").max(1e12, "Monto demasiado grande"),
  dayOfMonth: z.number().int().min(1, "Día entre 1 y 31").max(31, "Día entre 1 y 31"),
  startsOn: day,
  endsOn: day.nullable(),
}

const yearMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Mes inválido (YYYY-MM)")
/** Montos de meses que reemplazan al base: [{ month: "YYYY-MM", amount }]. Fija o reemplaza esos meses. */
const amounts = z
  .array(z.strictObject({ month: yearMonth, amount: fields.amount }))
  .max(120)
  .refine((a) => new Set(a.map((x) => x.month)).size === a.length, "Un mes repetido")

// CLP en pesos enteros, USD con hasta 2 decimales.
const amountFits = (v: { currency?: "CLP" | "USD"; amount?: number }) =>
  v.amount === undefined ||
  v.currency === undefined ||
  (v.currency === "CLP"
    ? Number.isInteger(v.amount)
    : Math.abs(v.amount * 100 - Math.round(v.amount * 100)) < 1e-6)
const endsAfterStart = (v: { startsOn?: string; endsOn?: string | null }) =>
  !v.startsOn || !v.endsOn || v.endsOn >= v.startsOn

export const createIncomeSourceSchema = z
  .strictObject({ ...fields, endsOn: fields.endsOn.optional().default(null), amounts: amounts.optional() })
  .refine(amountFits, { path: ["amount"], message: "CLP en pesos enteros; USD con hasta 2 decimales" })
  .refine(endsAfterStart, { path: ["endsOn"], message: "«Hasta» no puede ser antes de «Desde»" })
export type CreateIncomeSourceInput = z.infer<typeof createIncomeSourceSchema>

/** PATCH: solo lo que cambia. La moneda y el monto juntos se revisan en el caso de uso. */
export const updateIncomeSourceSchema = z
  .strictObject({
    name: fields.name.optional(),
    categoryId: fields.categoryId.optional(),
    currency: fields.currency.optional(),
    amount: fields.amount.optional(),
    dayOfMonth: fields.dayOfMonth.optional(),
    startsOn: fields.startsOn.optional(),
    endsOn: fields.endsOn.optional(),
    amounts: amounts.optional(),
  })
  .refine(amountFits, { path: ["amount"], message: "CLP en pesos enteros; USD con hasta 2 decimales" })
  .refine(endsAfterStart, { path: ["endsOn"], message: "«Hasta» no puede ser antes de «Desde»" })
export type UpdateIncomeSourceInput = z.infer<typeof updateIncomeSourceSchema>

/** Vincula (o desvincula con null) un abono de ingreso a un programado. */
export const linkIncomeSourceSchema = z.strictObject({
  incomeSourceId: z.string().trim().min(1).max(200).nullable(),
})
export type LinkIncomeSourceInput = z.infer<typeof linkIncomeSourceSchema>

/** PUT /api/income-sources/[id]/amounts/[yyyy-mm]: el monto de ese mes. */
export const monthAmountSchema = z.strictObject({ amount: fields.amount })
export const yearMonthSchema = yearMonth
