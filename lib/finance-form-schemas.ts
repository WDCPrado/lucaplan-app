import { z } from "zod"
import {
  ACCOUNT_TYPES,
  CATEGORY_TYPES,
  DIRECTIONS,
  accountHasCard,
} from "../arch/v1/domain/finance/finance.domain.ts"

const number = z.number({ error: "Ingresa un monto válido" })
const text = z.string({ error: "Ingresa un texto válido" })
const nullableText = text.nullable()
const period = {
  year: number
    .int("Año inválido")
    .min(2000, "Año inválido")
    .max(2100, "Año inválido"),
  month: number
    .int("Mes inválido (1–12)")
    .min(1, "Mes inválido (1–12)")
    .max(12, "Mes inválido (1–12)"),
}

// Valores canónicos: los controles monetarios entregan números; las rutas conservan sus
// conversiones históricas de JSON antes de validar. No se coaccionan textos de las máscaras.
export const monthlyBudgetSchema = z.object({
  ...period,
  globalLimit: number
    .int("El límite global debe ser un monto CLP entero ≥ 0")
    .min(0, "El límite global debe ser un monto CLP entero ≥ 0"),
})

// El límite de categoría admite decimales y valores negativos como el caso de uso existente:
// Money realiza su redondeo. No se impone aquí la regla exclusiva del presupuesto global.
export const categoryLimitSchema = z.object({
  categoryId: text,
  year: number,
  month: number,
  limit: number,
})

export const categorySchema = z.object({
  id: text.optional(),
  name: text.refine(
    (value) => Boolean(value.trim()),
    "La categoría necesita un nombre"
  ),
  type: z.enum(CATEGORY_TYPES, { error: "Selecciona ingreso o gasto" }),
  icon: nullableText,
  color: nullableText,
  description: nullableText,
  paceEnabled: z.boolean().optional(),
})

export const accountSchema = z
  .object({
    bankName: text.refine(
      (value) => Boolean(value.trim()),
      "Selecciona un banco"
    ),
    name: text.refine(
      (value) => Boolean(value.trim()),
      "La cuenta necesita un nombre"
    ),
    accountType: z.enum(ACCOUNT_TYPES, {
      error: "Selecciona un tipo de cuenta",
    }),
    currency: z.enum(["CLP", "USD"], { error: "Selecciona una moneda" }),
    balance: number,
    overdraftLimit: number.optional(),
    color: nullableText,
    cardLast4: nullableText,
  })
  .superRefine((input, ctx) => {
    if (
      accountHasCard(input.accountType) &&
      (input.cardLast4 ?? "").replace(/\D/g, "").length < 4
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["cardLast4"],
        message:
          "La cuenta requiere los últimos 4 dígitos de la tarjeta (4 dígitos numéricos)",
      })
    }
  })

export const incomeSchema = z.object({
  sourceId: text.optional(),
  accountId: text,
  categoryId: text,
  name: text.refine(
    (value) => Boolean(value.trim()),
    "La fuente de ingreso necesita un nombre"
  ),
  amount: number.positive("El monto del ingreso debe ser mayor que 0"),
  dayOfMonth: number
    .int("El día de ingreso debe estar entre 1 y 31")
    .min(1, "El día de ingreso debe estar entre 1 y 31")
    .max(31, "El día de ingreso debe estar entre 1 y 31"),
})
export const incomeUpdateSchema = incomeSchema.extend({ isActive: z.boolean() })

const transactionFields = {
  categoryId: nullableText,
  description: text,
  date: text.refine(
    (value) => Number.isFinite(new Date(value).getTime()),
    "Selecciona una fecha válida"
  ),
  direction: z.enum(DIRECTIONS, { error: "Selecciona cargo o abono" }),
}
export const transactionSchema = z.object({
  ...transactionFields,
  accountId: text,
  currency: z.enum(["CLP", "USD"], { error: "Selecciona una moneda" }),
  amount: number.positive("El monto debe ser mayor que 0"),
})
// PATCH histórico reemplaza estos campos completos y admite monto cero/negativo; la cuenta y
// moneda quedan fijadas por el movimiento. El dominio conserva permisos y reglas de cuotas.
export const transactionUpdateSchema = z.object({
  ...transactionFields,
  amount: number,
})

// El editor conserva la restricción de la UI existente. El PATCH mantiene su contrato histórico.
export const transactionEditFormSchema = transactionUpdateSchema.extend({
  amount: transactionSchema.shape.amount,
  description: incomeSchema.shape.name,
})

export type MonthlyBudgetFormValues = z.infer<typeof monthlyBudgetSchema>
export type CategoryLimitFormValues = z.infer<typeof categoryLimitSchema>
export type CategoryFormValues = z.infer<typeof categorySchema>
export type AccountFormValues = z.infer<typeof accountSchema>
export type IncomeFormValues = z.infer<typeof incomeSchema>
export type IncomeUpdateFormValues = z.infer<typeof incomeUpdateSchema>
export type TransactionFormValues = z.infer<typeof transactionSchema>
export type TransactionUpdateFormValues = z.infer<
  typeof transactionUpdateSchema
>
