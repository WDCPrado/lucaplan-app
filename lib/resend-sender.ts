import { z } from "zod"

// Remitente de Resend (RESEND_FROM) armado en dos pasos en Ajustes → Integraciones (WDC-181). Solo
// arma el string; la API lo vuelve a validar con `valueFor("RESEND_FROM")`.

const DOMAIN_RE =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/
// Parte local de un correo (RFC 5322 «dot-atom», sin comillas): lo que vale antes de la @.
const LOCAL_CHARS = /[^a-z0-9.!#$%&'*+/=?^_`{|}~-]/gi
const LOCAL_RE =
  /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/i

export const senderSchema = z.object({
  domain: z
    .string()
    .trim()
    .min(1, "Escribe el dominio verificado en Resend")
    .regex(DOMAIN_RE, "Escribe un dominio como lucaplan.cl"),
  name: z
    .string()
    .trim()
    .max(100, "Máximo 100 caracteres")
    .refine((v) => !/[<>"]/.test(v), "No puede llevar < > ni comillas"),
  local: z
    .string()
    .trim()
    .min(1, "Escribe la parte antes de la @")
    .max(64, "Máximo 64 caracteres")
    .regex(LOCAL_RE, "Usa letras, números, puntos o guiones, sin puntos seguidos ni en los bordes"),
})
export type Sender = z.infer<typeof senderSchema>

/** «Luca Plan <codigos@lucaplan.cl>» o «codigos@lucaplan.cl» → sus partes; otra cosa, null. */
export function parseSender(value: string | null): Sender | null {
  const match = value
    ?.trim()
    .match(/^(?:"?([^"<]*?)"?\s*<([^@\s<>]+)@([^@\s<>]+)>|([^@\s<>]+)@([^@\s<>]+))$/)
  if (!match) return null
  return match[2]
    ? { name: match[1].trim(), local: match[2], domain: match[3].toLowerCase() }
    : { name: "", local: match[4], domain: match[5].toLowerCase() }
}

/** `lucaplan.cl` → «Lucaplan»: lo de antes del primer punto, con la inicial en mayúscula. */
export function nameFromDomain(domain: string) {
  const first = domain.trim().split(".")[0] ?? ""
  return first.charAt(0).toUpperCase() + first.slice(1)
}

// Lo que un nombre puede llevar sin comillas (RFC 5322 «atom» con espacios); con otra cosa
// («Plan, Luca») va entre comillas.
const ATOM_PHRASE = /^[a-z0-9!#$%&'*+/=?^_`{|}~ -]+$/i

export function buildSender({ name, local, domain }: Sender) {
  const address = `${local.trim()}@${domain.trim()}`
  const shown = name.trim()
  if (!shown) return address
  return `${ATOM_PHRASE.test(shown) ? shown : `"${shown}"`} <${address}>`
}

// Saneo mientras se escribe: lo que no cabe en cada parte no se puede escribir.
export const cleanDomain = (v: string) => v.replace(/\s/g, "").toLowerCase()
export const cleanName = (v: string) => v.replace(/[<>"]/g, "")
/** Lo de antes de la @ (si pegan el correo entero) y solo los caracteres que valen ahí. */
export const cleanLocal = (v: string) => v.split("@")[0].replace(LOCAL_CHARS, "")

