import { headers } from "next/headers"
import { redirect } from "next/navigation"

import { auth } from "@/arch/v1/infrastructure/auth/auth"
import { todayKey } from "@/lib/finance-format"
import { getBudgetPeriod } from "@/arch/v1/application/finance-use-cases/budget-period-use-cases"
import { periodOfDay, periodRange } from "@/arch/shared/billing-cycle"
import { financeDeps } from "@/arch/v1/presentation/finance/finance-http"
import {
  listAccounts,
  getBudgetView,
  getAmountBounds,
} from "@/arch/v1/application/finance-use-cases/finance-read"
import { AppFrame } from "@/components/finance/app-shell"
import { AppearanceProvider } from "@/components/appearance-provider"
import { appearanceScript } from "@/lib/appearance"
import { getUserSettingsState } from "@/arch/v1/application/user-use-cases/user-settings-use-cases"
import { userSettingsDeps } from "@/arch/v1/infrastructure/database/prisma/user-settings.infrastructure"

// Marco de las pantallas con sesión: sidebar, barras superior e inferior y la búsqueda se
// montan una vez aquí y no se desmontan al cambiar de ruta (un layout no se vuelve a renderizar en
// la navegación; sí con router.refresh(), que es lo que hacen los modales al guardar, así las
// cuentas y categorías de la búsqueda se ponen al día).
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) redirect("/login")

  // Deps CRUDAS a propósito: el layout se renderiza en paralelo con la página, y el dashboard
  // abre los períodos de las recurrentes (escribe) antes de leer con `financePageDeps`. Si el
  // layout llenara esa memoización primero, el dashboard leería el mes sin su comprometido.
  // ponytail: getBudgetView completo solo por sus categorías; en /dashboard cada router.refresh()
  // lo calcula dos veces (aquí y en la página). Una lectura liviana de categorías si pesa.
  const userId = session.user.id
  // El período en curso, como lo calcula el Inicio: el marco lo muestra en el MonthNav deshabilitado
  // de las vistas sin selector de mes.
  const { mode, overrides } = await getBudgetPeriod(financeDeps)
  const now = periodOfDay(todayKey(), mode, overrides)
  // Los topes del slider de monto de la búsqueda global, que vive en el marco.
  const [accounts, budget, amountBounds, { settings, stored }] =
    await Promise.all([
      listAccounts(financeDeps, userId),
      getBudgetView(financeDeps, userId, now.year, now.month),
      getAmountBounds(financeDeps, userId),
      getUserSettingsState(userSettingsDeps, userId),
    ])

  // Los datos de la cuenta del marco: el menú del sidebar y la hoja del perfil, que edita el
  // nombre tal cual está guardado (vacío si no hay; el menú cae al correo).
  const label = session.user.name || session.user.email || "Usuario"
  return (
    <AppearanceProvider initial={settings} stored={stored}>
      {/* Tema y vidrio del usuario sobre <html> antes de pintar la app (ver lib/appearance.ts).
          Corre en la carga del documento; en una navegación del cliente React no ejecuta scripts
          (queda inerte) y ahí los aplica AppearanceProvider antes de pintar. */}
      <script
        dangerouslySetInnerHTML={{ __html: appearanceScript(settings, stored) }}
      />
      <AppFrame
        user={{
          name: session.user.name ?? "",
          initial: label.charAt(0).toUpperCase(),
          email: session.user.email,
        }}
        accounts={accounts}
        categories={budget.categories}
        amountBounds={amountBounds}
        currentPeriod={{
          ...now,
          cycleRange:
            mode === "card_cycle"
              ? periodRange(now.year, now.month, mode, overrides)
              : undefined,
        }}
      >
        {children}
      </AppFrame>
    </AppearanceProvider>
  )
}
