// Enriquece la categorización: dado el descriptor crudo de un movimiento bancario, busca el comercio
// más probable en el catálogo chileno curado y devuelve una PISTA de texto para el prompt de IA. NO
// decide la categoría final (las categorías son del usuario); solo aporta "esta glosa es X, rubro Y".
//
// Las glosas bancarias son ruidosas: "MERPAGOCABIFY2629BV7CDHP", "PAYU*UBER RIDES 8324 SCL". Reglas:
//  - Un intermediario_pago (MercadoPago, Webpay, Transbank...) NUNCA gana: es pasarela, no el comercio.
//    Solo se usa de fallback si ningún comercio real matchea (ej.: "MERCADOPAGO*RECARGA").
//  - alias con ≥5 alfanuméricos → substring (tolera pegado a basura: "CABIFY" en "...CABIFY2629...").
//  - alias con <5 → palabra completa (evita que "LG" matchee dentro de "ALGO").
//  - A igualdad de prioridad, el alias más largo (más específico) gana: "UBER EATS" > "UBER".

export type MerchantCompany = {
  name: string;
  category: string;
  aliases?: string[];
  match_terms?: string[];
};
export type MerchantHint = { name: string; category: string };
export type MerchantIndex = IndexedTerm[];

type IndexedTerm = { term: string; alnum: number; name: string; category: string; gateway: boolean };

const GATEWAY_CATEGORY = "intermediario_pago";

// upper, sin acentos, cualquier no-[A-Z0-9] → espacio, espacios colapsados.
export function normalizeDesc(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

export function buildMerchantIndex(companies: MerchantCompany[]): MerchantIndex {
  const seen = new Set<string>();
  const index: MerchantIndex = [];
  for (const c of companies) {
    const gateway = c.category === GATEWAY_CATEGORY;
    for (const raw of [...(c.aliases ?? []), ...(c.match_terms ?? [])]) {
      const term = normalizeDesc(raw);
      const alnum = term.replace(/ /g, "").length;
      if (alnum < 2) continue; // 1 char = ruido puro
      const key = `${term}|${c.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      index.push({ term, alnum, name: c.name, category: c.category, gateway });
    }
  }
  return index;
}

export function findMerchant(index: MerchantIndex, desc: string): MerchantHint | null {
  const g = normalizeDesc(desc);
  if (!g) return null;
  const padded = ` ${g} `;
  let best: IndexedTerm | null = null;
  for (const t of index) {
    const hit = t.alnum >= 5 ? g.includes(t.term) : padded.includes(` ${t.term} `);
    if (hit && (!best || betterMatch(t, best))) best = t;
  }
  return best ? { name: best.name, category: best.category } : null;
}

// Prioridad: comercio real gana a pasarela; a igualdad, el término más largo.
function betterMatch(a: IndexedTerm, b: IndexedTerm): boolean {
  if (a.gateway !== b.gateway) return !a.gateway;
  return a.alnum > b.alnum;
}
