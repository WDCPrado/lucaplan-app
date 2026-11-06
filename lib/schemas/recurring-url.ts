import { z } from "zod"

// Enlace opcional de un recurrente (p. ej. el portal donde se paga la cuenta). Vacío → null;
// sin esquema se asume https; solo http/https, para que nunca se abra un `javascript:`.
export const RECURRING_URL_MAX = 2048
const message = "Escribe un enlace válido, como https://www.enel.cl"
// Un esquema es `letras:` seguido de algo que no sea un puerto (`enel.cl:8080` no es esquema).
const hasScheme = /^[a-z][a-z\d+.-]*:(?!\d)/i
// El enlace se detecta como en WhatsApp: el primero que aparezca en el texto, con o sin https y
// con o sin www, siempre que el dominio tenga su terminación (`.cl`, `.com`). «Paga en enel.cl/pagos»
// guarda https://enel.cl/pagos; «enel» solo no es enlace. No toma el dominio de un correo (a@b.cl).
const linkInText =
  /(?<![@\p{L}\d.-])(?:https?:\/\/)?(?:[\p{L}\d](?:[\p{L}\d-]*[\p{L}\d])?\.)+\p{L}{2,}(?::\d{1,5})?(?:[/?#][^\s]*)?/iu
// La puntuación con que se cierra una frase no es parte del enlace: «entra a enel.cl.»
const trailing = /[.,;:!?)\]}»"'’]+$/

export const recurringUrlSchema = z
  .string()
  .nullish()
  .transform((value, ctx): string | null => {
    const trimmed = value?.trim() ?? ""
    if (!trimmed) return null
    // Un esquema explícito que no es web (javascript:, mailto:, ftp://) se rechaza, no se busca
    // un enlace adentro.
    const explicit =
      !/\s/.test(trimmed) && hasScheme.test(trimmed) && !/^https?:\/\//i.test(trimmed)
    const found = explicit ? null : trimmed.match(linkInText)?.[0].replace(trailing, "")
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
