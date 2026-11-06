import { z } from "zod"

// Enlace opcional de un recurrente (p. ej. el portal donde se paga la cuenta). Vacío → null;
// sin esquema se asume https; solo http/https, para que nunca se abra un `javascript:`.
export const RECURRING_URL_MAX = 2048
// Tope del texto crudo, antes de cualquier regex: un texto pegado («Paga en enel.cl/pagos») puede
// ser algo más largo que el enlace, pero nunca un megabyte. Sin este corte, un POST enorme hacía
// trabajar a las expresiones regulares sobre todo el cuerpo.
export const RECURRING_INPUT_MAX = 4096
const message = "Escribe un enlace válido, como https://www.enel.cl"
// Un esquema es `letras:` seguido de algo que no sea un puerto (`enel.cl:8080` no es esquema).
const hasScheme = /^[a-z][a-z\d+.-]*:(?!\d)/i
// El enlace se detecta como en WhatsApp: el primero que aparezca en el texto, con o sin https y
// con o sin www, siempre que el dominio tenga su terminación (`.cl`, `.com`). «Paga en enel.cl/pagos»
// guarda https://enel.cl/pagos; «enel» solo no es enlace. No toma el dominio de un correo (a@b.cl).
const linkInText =
  /(?<![@\p{L}\d.-])(?:https?:\/\/)?(?:[\p{L}\d](?:[\p{L}\d-]*[\p{L}\d])?\.)+\p{L}{2,}(?::\d{1,5})?(?:[/?#][^\s]*)?/iu
// La puntuación con que se cierra una frase no es parte del enlace: «entra a enel.cl.». Se recorta
// con un bucle desde el final: la regex `[…]+$` reintentaba en cada posición (cuadrática).
const TRAILING = ".,;:!?)]}»\"'’"
function trimTrailing(text: string): string {
  let end = text.length
  while (end > 0 && TRAILING.includes(text[end - 1])) end--
  return text.slice(0, end)
}

export const recurringUrlSchema = z
  .string()
  .max(RECURRING_INPUT_MAX, message)
  .nullish()
  .transform((value, ctx): string | null => {
    const trimmed = value?.trim() ?? ""
    if (!trimmed) return null
    // Un esquema explícito que no es web (javascript:, mailto:, ftp://) se rechaza, no se busca
    // un enlace adentro.
    const explicit =
      !/\s/.test(trimmed) && hasScheme.test(trimmed) && !/^https?:\/\//i.test(trimmed)
    const found = explicit ? null : trimTrailing(trimmed.match(linkInText)?.[0] ?? "")
    const url = !found ? "" : /^https?:\/\//i.test(found) ? found : `https://${found}`
    let protocol: string
    try {
      protocol = new URL(url).protocol
    } catch {
      protocol = ""
    }
    if (
      (protocol !== "http:" && protocol !== "https:") ||
      url.length > RECURRING_URL_MAX
    ) {
      ctx.addIssue({ code: "custom", message })
      return z.NEVER
    }
    return url
  })

// Lo que se muestra del enlace guardado: el dominio sin «www.», que es como se reconoce el portal.
export function linkHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return url
  }
}
