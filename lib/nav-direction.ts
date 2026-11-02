/**
 * Hacia dónde se mueve el contenido al navegar entre pantallas del marco (WDC-170):
 * - entre pestañas: según su orden (`tabs`, el de la navegación): «down» a una más abajo/a la
 *   derecha, «up» a una más arriba/a la izquierda;
 * - dentro de una sección, o hacia/desde una ruta fuera de las pestañas: «forward» al entrar (más
 *   profundo) y «back» al volver.
 * null = misma ruta (cambia solo la query, p. ej. el mes o `?tx=`): no hay desplazamiento.
 * Escritorio dibuja up/down en vertical; móvil, todo en horizontal (globals.css, `data-nav-dir`).
 */
export type NavDirection = "up" | "down" | "forward" | "back"

export function navDirection(
  from: string,
  to: string,
  tabs: string[] // href de cada pestaña, en el orden de la navegación
): NavDirection | null {
  if (from === to) return null
  const tab = (p: string) =>
    tabs.findIndex((h) => p === h || p.startsWith(h + "/"))
  const a = tab(from)
  const b = tab(to)
  const depth = (p: string, t: number) =>
    p.split("/").filter(Boolean).length + (t < 0 ? 1 : 0) // fuera de las pestañas = más adentro
  const da = depth(from, a)
  const db = depth(to, b)
  if (a >= 0 && b >= 0 && a !== b && da === 1 && db === 1)
    return b > a ? "down" : "up"
  return db >= da ? "forward" : "back"
}

/** La vuelta de un movimiento: el atrás del navegador deshace el último en sentido contrario. */
export const reverseNav: Record<NavDirection, NavDirection> = {
  up: "down",
  down: "up",
  forward: "back",
  back: "forward",
}
