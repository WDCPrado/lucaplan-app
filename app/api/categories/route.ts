import { categorySchema } from "@/lib/finance-form-schemas"
import {
  withUser,
  financeDeps,
} from "@/arch/v1/presentation/finance/finance-http"
import { upsertCategory } from "@/arch/v1/application/finance-use-cases/upsert-category-use-case"

// Crear/editar una categoría GLOBAL del usuario (nombre, icono, color). El límite va aparte.
export async function POST(req: Request) {
  const body = await req.json()

  return withUser(
    req,
    async (userId) => {
      const parsed = categorySchema.parse({
        id: body.id,
        name: body.name,
        type: body.type === "income" ? "income" : "expense",
        icon: body.icon ?? null,
        color: body.color ?? null,
        description:
          typeof body.description === "string" && body.description.trim()
            ? body.description.trim()
            : null,
        paceEnabled:
          typeof body.paceEnabled === "boolean" ? body.paceEnabled : undefined,
      })
      const c = await upsertCategory(financeDeps, userId, parsed)
      return { id: c.id }
    },
    body.id ? 200 : 201
  )
}
