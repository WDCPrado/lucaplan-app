/**
 * Qué webmail abrir para ir a buscar el código, según el dominio del correo. Un dominio propio
 * (no se puede deducir el proveedor desde el dominio) ofrece los dos.
 */
export type MailApp = { label: string; href: string; icon: "gmail" | "outlook" }

const GMAIL = new Set(["gmail.com", "googlemail.com"])
const OUTLOOK = /^(outlook|hotmail|live)\.[a-z.]+$|^msn\.com$/

export const mailAppsFor = (email: string): MailApp[] => {
  const domain = email.split("@")[1]?.toLowerCase() ?? ""
  const hint = encodeURIComponent(email)
  const gmail: MailApp = {
    label: "Gmail",
    href: `https://mail.google.com/mail/u/?authuser=${hint}`,
    icon: "gmail",
  }
  const outlook: MailApp = {
    label: "Outlook",
    href: `https://outlook.live.com/mail/0/?login_hint=${hint}`,
    icon: "outlook",
  }
  if (GMAIL.has(domain)) return [gmail]
  if (OUTLOOK.test(domain)) return [outlook]
  return [gmail, outlook]
}

/**
 * Enmascara un correo para mostrarlo en pantalla sin exponerlo entero: los dos primeros
 * caracteres del usuario, puntos hasta su largo original (mínimo 3) y el dominio completo.
 * Un usuario de 1 o 2 caracteres muestra solo el primero.
 */
export const maskEmail = (email: string): string => {
  const at = email.indexOf("@")
  if (at < 0) return email
  const user = email.slice(0, at)
  const domain = email.slice(at + 1)
  const visible = user.slice(0, user.length <= 2 ? 1 : 2)
  const dots = "•".repeat(Math.max(3, user.length - visible.length))
  return `${visible}${dots}@${domain}`
}
