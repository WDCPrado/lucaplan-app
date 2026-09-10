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

// Catálogo predefinido de iconos de categoría (lucide-react). El campo `icon` guarda el NOMBRE
// (ej. "ShoppingBag") o, alternativamente, un emoji de teclado. Un solo lugar para el set.
export const CATEGORY_ICONS: { name: string; Icon: LucideIcon }[] = [
  { name: "ShoppingBag", Icon: ShoppingBag },
  { name: "ShoppingCart", Icon: ShoppingCart },
  { name: "Utensils", Icon: Utensils },
  { name: "UtensilsCrossed", Icon: UtensilsCrossed },
  { name: "Coffee", Icon: Coffee },
  { name: "Car", Icon: Car },
  { name: "Bus", Icon: Bus },
  { name: "Fuel", Icon: Fuel },
  { name: "Plane", Icon: Plane },
  { name: "House", Icon: House },
  { name: "Zap", Icon: Zap },
  { name: "Wifi", Icon: Wifi },
  { name: "Smartphone", Icon: Smartphone },
  { name: "Shirt", Icon: Shirt },
  { name: "Gift", Icon: Gift },
  { name: "Heart", Icon: Heart },
  { name: "HeartPulse", Icon: HeartPulse },
  { name: "Stethoscope", Icon: Stethoscope },
  { name: "GraduationCap", Icon: GraduationCap },
  { name: "BookOpen", Icon: BookOpen },
  { name: "Dumbbell", Icon: Dumbbell },
  { name: "Film", Icon: Film },
  { name: "Popcorn", Icon: Popcorn },
  { name: "Music", Icon: Music },
  { name: "Gamepad2", Icon: Gamepad2 },
  { name: "PiggyBank", Icon: PiggyBank },
  { name: "CreditCard", Icon: CreditCard },
  { name: "Wallet", Icon: Wallet },
  { name: "Receipt", Icon: Receipt },
  { name: "TrendingUp", Icon: TrendingUp },
  { name: "Baby", Icon: Baby },
  { name: "PawPrint", Icon: PawPrint },
  { name: "Wrench", Icon: Wrench },
  { name: "Droplet", Icon: Droplet },
  { name: "Flame", Icon: Flame },
]

// Paleta curada de colores de categoría. El color se persiste como hex (dato, no token CSS);
// tonos medios legibles sobre fondo claro y oscuro. Un solo lugar para el set.
export const CATEGORY_COLORS = [
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
