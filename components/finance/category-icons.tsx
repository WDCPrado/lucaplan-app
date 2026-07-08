import {
  ShoppingBag,
  ShoppingCart,
  Utensils,
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
  Stethoscope,
  GraduationCap,
  BookOpen,
  Dumbbell,
  Film,
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
} from "lucide-react";

// Catálogo predefinido de iconos de categoría (lucide-react). El campo `icon` guarda el NOMBRE
// (ej. "ShoppingBag") o, alternativamente, un emoji de teclado. Un solo lugar para el set.
export const CATEGORY_ICONS: { name: string; Icon: LucideIcon }[] = [
  { name: "ShoppingBag", Icon: ShoppingBag },
  { name: "ShoppingCart", Icon: ShoppingCart },
  { name: "Utensils", Icon: Utensils },
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
  { name: "Stethoscope", Icon: Stethoscope },
  { name: "GraduationCap", Icon: GraduationCap },
  { name: "BookOpen", Icon: BookOpen },
  { name: "Dumbbell", Icon: Dumbbell },
  { name: "Film", Icon: Film },
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
];

const MAP: Record<string, LucideIcon> = Object.fromEntries(CATEGORY_ICONS.map((i) => [i.name, i.Icon]));

// Renderiza el icono de una categoría: lucide si `icon` es un nombre conocido; si no, lo trata como
// emoji; si está vacío, muestra un icono por defecto (Tag). `size` en px, funciona para ambos.
export function CategoryIcon({ icon, size = 20, color }: { icon: string | null; size?: number; color?: string }) {
  const Lucide = icon ? MAP[icon] : undefined;
  if (Lucide) return <Lucide size={size} color={color} />;
  if (icon) return <span style={{ fontSize: size * 1.05, lineHeight: 1 }}>{icon}</span>;
  const Fallback = Tag;
  return <Fallback size={size} color={color} />;
}
