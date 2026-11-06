// Onboarding de una cuenta nueva (WDC-181): proponer y guardar el set de categorías, y marcar el
// onboarding como terminado. Solo tipos y ports.
import type { CategoryType } from "../finance/finance.domain.ts"

// Catálogo de iconos y colores de categoría. La pantalla (components/finance/category-icons.tsx)
// deriva de aquí sus listas, así que la API y la UI aceptan exactamente el mismo set.
const ICON_NAMES = [
  "ShoppingBag",
  "ShoppingCart",
  "Utensils",
  "UtensilsCrossed",
  "Coffee",
  "Car",
  "Bus",
  "Fuel",
  "Plane",
  "House",
  "Zap",
  "Wifi",
  "Smartphone",
  "Shirt",
  "Gift",
  "Heart",
  "HeartPulse",
  "Stethoscope",
  "GraduationCap",
  "BookOpen",
  "Dumbbell",
  "Film",
  "Popcorn",
  "Music",
  "Gamepad2",
  "PiggyBank",
  "CreditCard",
  "Wallet",
  "Receipt",
  "TrendingUp",
  "Baby",
  "PawPrint",
  "Wrench",
  "Droplet",
  "Flame",
] as const
export type CategoryIconName = (typeof ICON_NAMES)[number]
export const CATEGORY_ICON_NAMES: readonly string[] = ICON_NAMES

// Paleta curada: hex persistido (dato, no token CSS), legible sobre fondo claro y oscuro.
export const CATEGORY_COLOR_VALUES: readonly string[] = [
  "#6366f1", // índigo
  "#3b82f6", // azul
  "#06b6d4", // cian
  "#10b981", // esmeralda
  "#84cc16", // lima
  "#eab308", // amarillo
  "#f97316", // naranja
  "#ef4444", // rojo
  "#ec4899", // rosa
  "#a855f7", // púrpura
  "#14b8a6", // teal
  "#64748b", // slate
]

export type BaseCategory = {
  name: string
  type: CategoryType
  icon: string
  color: string
  description: string | null
}

// IA que ajusta el set precreado según lo que la persona cuenta de su día a día. Devuelve la
// respuesta cruda (`unknown`): el use-case la valida y cae al set precreado si no calza.
export interface CategoryProposer {
  propose(input: {
    description: string
    base: readonly BaseCategory[]
  }): Promise<unknown>
}

// Qué categorías del usuario tienen algo colgando (movimientos, límites, recurrentes, cuotas,
// ingresos): esas no se borran al guardar el onboarding aunque no vengan en el set.
export interface CategoryUsage {
  usedCategoryIds(userId: string): Promise<Set<string>>
}

export interface OnboardingRepository {
  completedAt(userId: string): Promise<Date | null>
  markCompleted(userId: string, at: Date): Promise<void>
}
