// Caja sin transform de un control a partir de su caja visible (WDC-179, components/finance/
// liquid-glass.ts). getBoundingClientRect ya incluye el transform; el proxy lo copia aparte, así
// que hay que deshacerlo o se aplica dos veces (la pastilla de Segmented corría el doble).
//
// Con M = [a c; b d] y traslación (e, f) alrededor del origen O (px desde la esquina de la caja):
// centroVisible = esquina + O + M·(centro − O) + (e, f). Se despeja la esquina. Vale para todo
// transform afín 2D (traslación, escala, rotación); de un matrix3d toma su proyección 2D.

export type Rect = { left: number; top: number; width: number; height: number }
export type Matrix = {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
}

export const IDENTITY: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }

export function untransformedOrigin(
  r: Rect,
  w: number,
  h: number,
  m: Matrix = IDENTITY,
  origin: { x: number; y: number } = { x: w / 2, y: h / 2 }
) {
  const vx = r.left + r.width / 2
  const vy = r.top + r.height / 2
  const dx = w / 2 - origin.x
  const dy = h / 2 - origin.y
  return {
    x: vx - origin.x - (m.a * dx + m.c * dy) - m.e,
    y: vy - origin.y - (m.b * dx + m.d * dy) - m.f,
  }
}
