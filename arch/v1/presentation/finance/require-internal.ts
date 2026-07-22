// Guard de los endpoints `/api/cron/*`: solo tráfico de la red privada del proyecto.
//
// El aislamiento real lo da la red privada de Railway, que está namespaced por proyecto+entorno:
// solo los servicios de este proyecto se ven entre sí. NO se confía en el hostname
// (`*.railway.internal`) ni en una IP "local": son falsificables y no sirven como permiso.
// El criterio es el inverso: si la request trae las cabeceras que inyecta el proxy del edge
// público, vino de internet ⇒ se rechaza. Solo pasa lo que entró directo por la red privada.
//
// Defensa en profundidad: además exige `CRON_KEY` (env que solo vive dentro del proyecto). Sin la
// llave no ejecuta ni aunque el path quedara expuesto.
//
// Requisito de despliegue: la app debe escuchar en `::` (IPv6) para recibir el tráfico privado.

// Cabeceras que el edge de Railway (y cualquier proxy público) agrega al reenviar desde internet.
const EDGE_HEADERS = [
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-real-ip",
  "cf-connecting-ip",
] as const

export const CRON_KEY_HEADER = "x-cron-key"

/** ¿La request entró por el edge público? Cualquier cabecera de proxy la delata. */
export function cameFromPublicEdge(headers: Headers): boolean {
  return EDGE_HEADERS.some((h) => headers.has(h))
}

/**
 * `true` si la request puede ejecutar un endpoint de cron: llegó por la red privada Y trae el
 * secreto correcto. Sin `CRON_KEY` configurada nadie pasa (fail-closed).
 */
export function isInternalRequest(
  headers: Headers,
  cronKey = process.env.CRON_KEY
): boolean {
  if (!cronKey) return false
  if (cameFromPublicEdge(headers)) return false
  return headers.get(CRON_KEY_HEADER) === cronKey
}

/**
 * Guard listo para un Route Handler: devuelve 404 (no revela la existencia del endpoint) cuando la
 * request no es interna, o `null` cuando puede continuar.
 */
export function requireInternal(req: Request): Response | null {
  return isInternalRequest(req.headers)
    ? null
    : new Response("Not Found", { status: 404 })
}
