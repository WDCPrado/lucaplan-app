import type {
  CategoryRepository,
  CategoryType,
} from "../../domain/finance/finance.domain.ts"

// Categorías con las que parte una cuenta nueva. La `description` NO es decorativa: es el contexto
// que recibe el modelo al categorizar (ver openai-categorization.provider.ts), así que nombra
// comercios chilenos reconocibles en la glosa del movimiento bancario. Sin categoría "Otros": un
// cajón genérico invita al modelo a vaciar ahí lo dudoso; lo que no encaja queda sin categoría y lo
// resuelve el triage, que es donde el usuario enseña.
// `icon` y `color` son literales del catálogo de la UI (components/finance/category-icons.tsx); no
// se importa de ahí porque es TSX y arrastra lucide-react a esta capa.
export const DEFAULT_CATEGORIES: {
  name: string
  type: CategoryType
  icon: string
  color: string
  description: string
}[] = [
  {
    name: "Sueldo",
    type: "income",
    icon: "Wallet",
    color: "#10b981",
    description:
      "Sueldo líquido, honorarios y bonos del trabajo. Es el ingreso ordinario que financia el presupuesto del mes.",
  },
  {
    name: "Supermercado",
    type: "expense",
    icon: "ShoppingCart",
    color: "#f97316",
    description:
      "Comida y mercadería para la casa: Líder, Jumbo, Santa Isabel, Unimarc, Tottus, ferias y almacenes de barrio. No incluye delivery ni restaurantes.",
  },
  {
    name: "Restaurantes y delivery",
    type: "expense",
    icon: "Utensils",
    color: "#ef4444",
    description:
      "Comer fuera y pedidos a domicilio: restaurantes, cafeterías, bares, Uber Eats, PedidosYa y Rappi.",
  },
  {
    name: "Transporte",
    type: "expense",
    icon: "Car",
    color: "#3b82f6",
    description:
      "Traslados: bencina (Copec, Shell, Petrobras), Bip! y Red Movilidad, metro, TAG y peajes, estacionamientos, Uber, Cabify y mantención del auto.",
  },
  {
    name: "Salud",
    type: "expense",
    icon: "Stethoscope",
    color: "#06b6d4",
    description:
      "Farmacias (Cruz Verde, Salcobrand, Ahumada), consultas médicas, dentista, exámenes, ópticas y cotizaciones de isapre o Fonasa.",
  },
  {
    name: "Cuentas y servicios",
    type: "expense",
    icon: "Zap",
    color: "#eab308",
    description:
      "Servicios del hogar: luz (Enel, CGE), agua (Aguas Andinas), gas (Lipigas, Abastible, Metrogas), internet y telefonía (Entel, Movistar, VTR, WOM), gastos comunes y contribuciones.",
  },
  {
    name: "Arriendo o dividendo",
    type: "expense",
    icon: "House",
    color: "#6366f1",
    description:
      "Pago mensual de la vivienda: arriendo o dividendo hipotecario.",
  },
  {
    name: "Suscripciones",
    type: "expense",
    icon: "CreditCard",
    color: "#a855f7",
    description:
      "Servicios digitales recurrentes: Netflix, Spotify, Disney+, HBO Max, iCloud, ChatGPT, gimnasio y apps por suscripción.",
  },
  {
    name: "Compras",
    type: "expense",
    icon: "ShoppingBag",
    color: "#ec4899",
    description:
      "Ropa, tecnología y cosas para la casa: Falabella, Ripley, París, Mercado Libre, AliExpress, Sodimac y retail en general.",
  },
  {
    name: "Entretenimiento",
    type: "expense",
    icon: "Film",
    color: "#84cc16",
    description:
      "Panoramas y ocio: cine, conciertos, eventos, videojuegos, salidas y viajes.",
  },
]

// Siembra el set inicial de una cuenta recién creada. Idempotente: con cualquier categoría ya
// existente no escribe nada (no re-crea las que el usuario borró). Un solo createMany: o entran
// todas o ninguna, para no dejar un conjunto a medias que nadie completa.
export async function seedDefaultCategories(
  deps: { categories: CategoryRepository },
  userId: string
): Promise<void> {
  const existing = await deps.categories.listByUser(userId)
  if (existing.length > 0) return
  await deps.categories.createMany(
    DEFAULT_CATEGORIES.map((c) => ({ userId, ...c }))
  )
}
