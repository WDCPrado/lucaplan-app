/**
 * Zona horaria del negocio. Las fechas de movimiento son días CIVILES (`@db.Date`, medianoche UTC):
 * el 30 de julio es el 30 de julio, no un instante. Pero "hoy" sí depende de un reloj, y el reloj
 * que importa es el del usuario, no el de Greenwich: a las 21:00 en Chile ya es el día siguiente en
 * UTC, y sin esto un movimiento de hoy se rotulaba "Ayer" y el mes en curso saltaba antes de tiempo.
 * Fija (Luca Plan es una app chilena, CLP y es-CL) para que cliente y servidor coincidan siempre.
 * Vive en `arch/shared` para que el backend la use sin importar de `lib/` (la UI la reexporta).
 */
export const APP_TZ = "America/Santiago"

// en-CA formatea como YYYY-MM-DD, que es justo la clave de día civil que usa la app.
const dayKeyFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: APP_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
})

/** Día civil del usuario en formato YYYY-MM-DD. */
export function todayKey(now: Date = new Date()): string {
  return dayKeyFmt.format(now)
}
