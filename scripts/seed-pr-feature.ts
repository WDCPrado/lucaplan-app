// Datos EXTRA del PR actual: lo que la feature de esta rama necesita para poder probarse y que el
// seed base (scripts/seed-pr.ts) no siembra. Lo corre el seed base al final de la primera siembra,
// con el usuario demo ya creado, y solo en entornos de PR de Railway.
//
// SE REESCRIBE COMPLETO EN CADA FEATURE, antes de abrir el PR. El contenido pertenece al PR en
// curso, no al repo: si tu cambio no necesita datos propios, déjalo como está (no-op).
//
// Reglas al escribirlo:
//   - Solo la data mínima de la feature y sus dependencias. Usuario, cuentas, categorías,
//     presupuesto, movimientos, recurrentes y planes de cuotas ya vienen del seed base: tómalos
//     del ctx en vez de crear otros.
//   - Nada de datos reales ni secretos: el entorno de PR es público.
//   - Si falla, el seed base lo registra y sigue (no tumba el deploy), pero la feature queda sin
//     datos. Pruébalo antes con `SEED_PR_FORCE=1 pnpm seed:pr` contra una base local.

import type { FeatureSeedContext } from "./seed-pr.ts" // solo el tipo: no ejecuta el seed base

// WDC-58 — la línea de ritmo de cada categoría muestra lo DISPONIBLE del período.
export default async function seedFeature({
  userId,
  prisma,
  checkingId,
  categoryId,
}: FeatureSeedContext) {
  // Los movimientos del seed base caen en días fijos del mes, así que el período en curso (hoy /
  // esta semana, según Configuración) puede quedar sin gasto y la línea saldría siempre entera.
  // Se siembran dos gastos de HOY para ver las dos caras del texto nuevo: Transporte gasta parte
  // del ritmo (queda disponible, en gris) y Comida se lo pasa (línea roja "sobre el ritmo").
  const today = new Date()
  await prisma.transaction.createMany({
    data: [
      {
        userId,
        accountId: checkingId,
        categoryId: categoryId.get("Transporte")!,
        transactionDate: today,
        description: "MERCPAGO*UBER TRIP",
        amount: 4200,
        currency: "CLP",
        direction: "debit",
        reviewed: true,
      },
      {
        userId,
        accountId: checkingId,
        categoryId: categoryId.get("Comida")!,
        transactionDate: today,
        description: "Pago:pedidosya",
        amount: 45900,
        currency: "CLP",
        direction: "debit",
        reviewed: true,
      },
    ],
  })

  console.log(
    "[seed:pr] WDC-58: gastos de hoy en Transporte y Comida (ritmo con margen y ritmo excedido)."
  )
}
