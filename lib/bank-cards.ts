// Arte de tarjeta: NO usamos logos de terceros (son marca registrada). Estilo propio:
// gradiente por variante (azul débito / negro crédito) + el monograma del banco como
// marca de agua de fondo. Mismo criterio que la landing (monogramas, no logos).

export type CardVariant = "debito" | "credito"

// Fondo por variante: azul (débito) / negro (crédito). Estilo propio, no una foto de tarjeta.
export const CARD_VARIANT_BG: Record<CardVariant, string> = {
  debito: "linear-gradient(135deg, #0a2a6b 0%, #0b3f9e 55%, #0850c0 100%)",
  credito: "linear-gradient(135deg, #0a0a0d 0%, #17171c 55%, #26262d 100%)",
}

// Monograma propio por banco (sin logos de terceros). Fallback: iniciales del nombre.
const BANK_MONOGRAMS: Record<string, string> = {
  "Banco de Chile": "Ch",
  BancoEstado: "BE",
  Santander: "S",
  Bci: "Bci",
  Scotiabank: "Sc",
  Itaú: "It",
}

// Variante de tarjeta según el tipo de cuenta: checking = débito, credit_card = crédito.
// Los demás tipos (ahorro, billetera, …) no tienen tarjeta → null.
export function variantForType(accountType: string): CardVariant | null {
  if (accountType === "checking") return "debito"
  if (accountType === "credit_card") return "credito"
  return null
}

function monogramFor(bankName: string): string {
  return BANK_MONOGRAMS[bankName] ?? bankName.slice(0, 2)
}

// Arte de la tarjeta: variante (define el color) + monograma del banco (marca de fondo).
// null si el tipo no tiene tarjeta → la tarjeta cae a color plano.
export function resolveCardArt(
  bankName: string,
  accountType: string
): { variant: CardVariant; monogram: string } | null {
  const variant = variantForType(accountType)
  if (!variant) return null
  return { variant, monogram: monogramFor(bankName) }
}
