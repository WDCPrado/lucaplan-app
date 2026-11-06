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

// Nombre legible de cada icono, para lectores de pantalla (el identificador no cambia).
const ICON_LABELS: Record<CategoryIconName, string> = {
  ShoppingBag: "Bolsa de compras",
  ShoppingCart: "Carrito",
  Utensils: "Cubiertos",
  UtensilsCrossed: "Restaurante",
  Coffee: "Café",
  Car: "Auto",
  Bus: "Bus",
  Fuel: "Bencina",
  Plane: "Avión",
  House: "Casa",
  Zap: "Electricidad",
  Wifi: "Internet",
  Smartphone: "Celular",
  Shirt: "Ropa",
  Gift: "Regalo",
  Heart: "Corazón",
  HeartPulse: "Salud",
  Stethoscope: "Médico",
  GraduationCap: "Educación",
  BookOpen: "Libro",
  Dumbbell: "Gimnasio",
  Film: "Cine",
  Popcorn: "Cabritas",
  Music: "Música",
  Gamepad2: "Videojuegos",
  PiggyBank: "Ahorro",
  CreditCard: "Tarjeta",
  Wallet: "Billetera",
  Receipt: "Boleta",
  TrendingUp: "Inversiones",
  Baby: "Bebé",
  PawPrint: "Mascota",
  Wrench: "Herramientas",
  Droplet: "Agua",
  Flame: "Gas",
}

export const CATEGORY_ICONS: { name: string; label: string; Icon: LucideIcon }[] =
  CATEGORY_ICON_NAMES.map((name) => ({
    name,
    label: ICON_LABELS[name as CategoryIconName],
    Icon: ICONS[name as CategoryIconName],
  }))

// Paleta curada de colores de categoría (ver CATEGORY_COLOR_VALUES en el dominio).
export const CATEGORY_COLORS = CATEGORY_COLOR_VALUES

// Nombre legible de cada color de la paleta. Un color fuera de ella (dato viejo) no tiene nombre.
export const CATEGORY_COLOR_LABELS: Record<string, string> = {
  "#6366f1": "Índigo",
  "#3b82f6": "Azul",
  "#06b6d4": "Cian",
  "#10b981": "Esmeralda",
  "#84cc16": "Lima",
  "#eab308": "Amarillo",
  "#f97316": "Naranja",
  "#ef4444": "Rojo",
  "#ec4899": "Rosa",
  "#a855f7": "Púrpura",
  "#14b8a6": "Turquesa",
  "#64748b": "Gris azulado",
}

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
