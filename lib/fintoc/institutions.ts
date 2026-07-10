// Bancos que Fintoc soporta para movimientos en Chile (ver docs "products and institutions -
// movements"). La creación manual ("nueva tarjeta") es para bancos/medios que NO están acá: los que
// sí están se conectan por Fintoc, que trae los movimientos automáticamente. Client-safe (sin keys).
const FINTOC_BANK_KEYWORDS = [
  "banco de chile",
  "banco chile",
  "bancochile",
  "edwards", // Banco de Chile / Edwards
  "santander",
  "itau", // Itaú (sin acento tras normalizar)
  "bice",
  "scotia", // Scotiabank
  "bci",
  "bancoestado",
  "banco estado",
  "estado",
  "security", // Banco Security
];

// Normaliza para comparar: minúsculas, sin acentos, sin espacios de más.
function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
}

// ¿El nombre de banco escrito por el usuario corresponde a uno soportado por Fintoc?
export function isFintocSupportedBank(name: string): boolean {
  const n = normalize(name);
  if (!n) return false;
  return FINTOC_BANK_KEYWORDS.some((k) => n.includes(k));
}
