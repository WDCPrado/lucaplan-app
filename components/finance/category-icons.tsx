import {
  ShoppingBag,
  ShoppingCart,
  Utensils,
  UtensilsCrossed,
  Coffee,
  Car,
  Bus,
  Fuel,
  Plane,
  House,
  Zap,
  Wifi,
  Smartphone,
  Shirt,
  Gift,
  Heart,
  HeartPulse,
  Stethoscope,
  GraduationCap,
  BookOpen,
  Dumbbell,
  Film,
  Popcorn,
  Music,
  Gamepad2,
  PiggyBank,
  CreditCard,
  Wallet,
  Receipt,
  TrendingUp,
  Baby,
  PawPrint,
  Wrench,
  Droplet,
  Flame,
  Tag,
  type LucideIcon,
} from "lucide-react"
import {
  CATEGORY_COLOR_VALUES,
  CATEGORY_ICON_NAMES,
  type CategoryIconName,
} from "@/arch/v1/domain/onboarding/onboarding.domain"

// Catálogo predefinido de iconos de categoría (lucide-react). El campo `icon` guarda el NOMBRE
// (ej. "ShoppingBag") o, alternativamente, un emoji de teclado. Los nombres y la paleta viven en el
// dominio (onboarding.domain.ts), que la API usa para validar; este Record los cubre todos por tipo.
const ICONS: Record<CategoryIconName, LucideIcon> = {
  ShoppingBag,
  ShoppingCart,
  Utensils,
  UtensilsCrossed,
  Coffee,
  Car,
  Bus,
  Fuel,
  Plane,
  House,
  Zap,
  Wifi,
  Smartphone,
  Shirt,
  Gift,
  Heart,
  HeartPulse,
  Stethoscope,
  GraduationCap,
  BookOpen,
  Dumbbell,
  Film,
  Popcorn,
  Music,
  Gamepad2,
  PiggyBank,
  CreditCard,
  Wallet,
  Receipt,
  TrendingUp,
  Baby,
  PawPrint,
  Wrench,
  Droplet,
  Flame,
}

export const CATEGORY_ICONS: { name: string; Icon: LucideIcon }[] =
  CATEGORY_ICON_NAMES.map((name) => ({
    name,
    Icon: ICONS[name as CategoryIconName],
  }))

// Paleta curada de colores de categoría (ver CATEGORY_COLOR_VALUES en el dominio).
export const CATEGORY_COLORS = CATEGORY_COLOR_VALUES

const MAP: Record<string, LucideIcon> = Object.fromEntries(
  CATEGORY_ICONS.map((i) => [i.name, i.Icon])
)

// Renderiza el icono de una categoría: lucide si `icon` es un nombre conocido; un emoji se pinta tal
// cual; un nombre desconocido (icono retirado del catálogo, dato viejo) o vacío cae a Tag. Sin esa
// guarda, "UtensilsCrossed" se pintaba como palabra encima del arco de la fila de movimiento.
export function CategoryIcon({
  icon,
  size = 20,
  color,
}: {
  icon: string | null
  size?: number
  color?: string
}) {
  const Lucide = icon ? MAP[icon] : undefined
  if (Lucide) return <Lucide size={size} color={color} />
  // Emoji = sin letras ni dígitos. Un nombre de icono siempre los tiene.
  if (icon && !/[\p{L}\p{N}]/u.test(icon))
    return <span style={{ fontSize: size * 1.05, lineHeight: 1 }}>{icon}</span>
  const Fallback = Tag
  return <Fallback size={size} color={color} />
}
