// Mapas de la refracción del Liquid Glass (técnica de kube.io/blog/liquid-glass-css-svg). Lógica pura,
// sin DOM: la usa lib/liquid-refraction-dom.ts y la prueba node --test.
//
// La cápsula es un vidrio con canto «convex squircle» (y = ⁴√(1 − (1 − x)⁴), el perfil suave de
// Apple) de ancho `bezel`. Un rayo vertical que entra por el canto se desvía según Snell (aire 1 →
// vidrio 1.5) y recorre el espesor que queda: ese corrimiento, hacia el centro, es el desplazamiento.
// El interior plano no desplaza nada.
//
// Salida en RGBA para feDisplacementMap: R = x, G = y, 128 = neutro, normalizado al desplazamiento
// máximo (`maxDisplacement`, en píxeles del mapa), que vuelve como `scale` del filtro. Más una capa de
// brillo especular de canto (blanco con alfa), con la luz fija arriba a la izquierda.

const IOR = 1.5
const SAMPLES = 128
const LIGHT = { x: -Math.SQRT1_2, y: -Math.SQRT1_2 } // hacia arriba-izquierda

const height = (x: number) => Math.pow(1 - Math.pow(1 - x, 4), 1 / 4)

// Desplazamiento a lo largo del canto, de 0 (borde) a 1 (comienzo del interior plano), en unidades
// del ancho del canto (el espesor del vidrio es igual al ancho del canto).
function bezelProfile() {
  const out = new Float64Array(SAMPLES)
  const dx = 1e-3
  for (let i = 0; i < SAMPLES; i++) {
    const x = i / (SAMPLES - 1)
    const slope =
      (height(Math.min(x + dx, 1)) - height(Math.max(x - dx, 0))) /
      (Math.min(x + dx, 1) - Math.max(x - dx, 0))
    const incidence = Math.atan(Math.abs(slope))
    const refracted = Math.asin(Math.sin(incidence) / IOR)
    out[i] = Math.sign(slope) * Math.tan(incidence - refracted) * height(x)
  }
  return out
}
const PROFILE = bezelProfile()
const PROFILE_MAX = PROFILE.reduce((m, v) => Math.max(m, Math.abs(v)), 0)

export type GlassMaps = {
  displacement: Uint8ClampedArray<ArrayBuffer>
  specular: Uint8ClampedArray<ArrayBuffer>
  maxDisplacement: number // píxeles del mapa con el canal al tope (127)
}

/** Mapas de un rectángulo redondeado de `width`×`height` px con radio `radius` y canto `bezel`. */
export function glassMaps(
  width: number,
  height: number,
  radius: number,
  bezel: number
): GlassMaps {
  const r = Math.min(radius, width / 2, height / 2)
  const hw = width / 2
  const hh = height / 2
  const rim = bezel * 0.6
  const displacement = new Uint8ClampedArray(width * height * 4)
  const specular = new Uint8ClampedArray(width * height * 4)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const px = x + 0.5 - hw
      const py = y + 0.5 - hh
      // Distancia al borde (d) y normal hacia afuera (nx, ny) del rectángulo redondeado.
      const qx = Math.abs(px) - (hw - r)
      const qy = Math.abs(py) - (hh - r)
      let d: number
      let nx = 0
      let ny = 0
      if (qx > 0 && qy > 0) {
        const len = Math.hypot(qx, qy)
        d = r - len
        nx = (qx / len) * Math.sign(px)
        ny = (qy / len) * Math.sign(py)
      } else if (qx > qy) {
        d = hw - Math.abs(px)
        nx = Math.sign(px)
      } else {
        d = hh - Math.abs(py)
        ny = Math.sign(py)
      }

      let vx = 0
      let vy = 0
      if (d >= 0 && d < bezel) {
        const t = (d / bezel) * (SAMPLES - 1)
        const k = Math.floor(t)
        const v =
          (PROFILE[k] + (PROFILE[Math.min(k + 1, SAMPLES - 1)] - PROFILE[k]) * (t - k)) /
          PROFILE_MAX
        // Convexo: se muestrea hacia el centro, contra la normal.
        vx = -nx * v
        vy = -ny * v
      }
      displacement[i] = Math.round(128 + vx * 127)
      displacement[i + 1] = Math.round(128 + vy * 127)
      displacement[i + 2] = 128
      displacement[i + 3] = 255

      if (d >= 0 && d < rim) {
        const falloff = (1 - d / rim) ** 2
        const facing = nx * LIGHT.x + ny * LIGHT.y
        // Luz directa arriba-izquierda; el canto opuesto devuelve un reflejo más débil.
        const light = Math.max(facing, 0) ** 2 + 0.4 * Math.max(-facing, 0) ** 2
        specular[i] = specular[i + 1] = specular[i + 2] = 255
        specular[i + 3] = Math.round(falloff * light * 0.55 * 255)
      }
    }
  }
  return { displacement, specular, maxDisplacement: PROFILE_MAX * bezel }
}
