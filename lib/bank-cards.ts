// Arte de tarjeta: NO usamos una imagen de tarjeta completa, sino nuestro propio estilo
// (gradiente por variante: azul débito / negro crédito) + el icono/isotipo del banco como
// marca de agua de fondo. El catálogo `{ banco: icono }` es la misma forma que tendrá la
// futura tabla `banco → url de icono`, así que migrar a un bucket es cambiar la fuente aquí.

export type CardVariant = "debito" | "credito";

// Nombre del banco (tal como se guarda) → isotipo del catálogo. Solo los mapeados tienen arte.
const BANK_ICONS: Record<string, string> = {
  "Banco de Chile": "/imagenes/bancos/banco-chile/bch.png",
};

// Variante de tarjeta según el tipo de cuenta: checking = débito, credit_card = crédito.
// Los demás tipos (ahorro, billetera, …) no tienen tarjeta → null.
export function variantForType(accountType: string): CardVariant | null {
  if (accountType === "checking") return "debito";
  if (accountType === "credit_card") return "credito";
  return null;
}

// Arte de la tarjeta: variante (define el color) + icono del banco (marca de fondo).
// null si el banco no tiene icono o el tipo no tiene tarjeta → la tarjeta cae a color plano.
export function resolveCardArt(bankName: string, accountType: string): { variant: CardVariant; icon: string } | null {
  const variant = variantForType(accountType);
  const icon = BANK_ICONS[bankName];
  if (!variant || !icon) return null;
  return { variant, icon };
}
