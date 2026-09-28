// Corrección del cierre de la tarjeta de un mes (Inicio → rango del ciclo). `date: null` borra la
// corrección y vuelve al estimado. Responde el cierre efectivo tras guardar; una fecha fuera del
// mes responde 422 y no guarda nada. Global, como el modo.
import {
  withUser,
  financeDeps,
} from "@/arch/v1/presentation/finance/finance-http"
import { setCardClosing } from "@/arch/v1/application/finance-use-cases/budget-period-use-cases"

export async function PUT(req: Request) {
  const body = await req.json().catch(() => null)
  const date = body?.date
  // Validación de forma en el boundary; qué fecha es válida lo decide el caso de uso.
  if (date !== null && typeof date !== "string")
    return Response.json(
      { error: "date debe ser YYYY-MM-DD o null" },
      { status: 400 }
    )
  return withUser(req, async () =>
    setCardClosing(financeDeps, Number(body?.year), Number(body?.month), date)
  )
}
