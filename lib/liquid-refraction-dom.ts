// Refracción del Liquid Glass sobre un elemento, solo en Chromium (backdrop-filter: url(#filtro)).
// Se carga con import dinámico desde hooks/use-liquid-refraction.ts, que ya comprobó el motor y la
// gama del equipo: Safari y Firefox nunca descargan este código.
//
// Cada elemento tiene su <filter> (el mapa depende del tamaño) en un único <svg> oculto del body.
// El filtro entra al vidrio por `--glass-refraction`, que `liquid-glass` agrega al final de su
// backdrop-filter (globals.css); sin la variable, el vidrio CSS queda igual.
import { getGlass, subscribeGlass } from "./glass-level"
import { glassMaps } from "./liquid-refraction"

const NS = "http://www.w3.org/2000/svg"
// Intensidad por nivel de vidrio: 0 (transparente) refracta más; desde 3 (teñido) se apaga.
const LEVEL_STRENGTH = [1, 0.75, 0.5]
const PRESS_BOOST = 1.6
const MAX_SIDE = 512 // px del mapa por lado
const STEP = 4 // los mapas se cachean por tamaño redondeado a 4 px
const CACHE_MAX = 12

const media = (q: string) => window.matchMedia(q)
const reduceTransparency = media("(prefers-reduced-transparency: reduce)")
const moreContrast = media("(prefers-contrast: more)")
const reduceMotion = media("(prefers-reduced-motion: reduce)")

let host: SVGSVGElement | null = null
let seq = 0
type Urls = { displacement: string; specular: string; maxDisplacement: number }
const cache = new Map<string, Urls>()

function svgHost() {
  if (!host) {
    host = document.createElementNS(NS, "svg")
    host.setAttribute("aria-hidden", "true")
    host.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;pointer-events:none"
    document.body.append(host)
  }
  return host
}

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string>) {
  const node = document.createElementNS(NS, tag)
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v)
  return node
}

function toUrl(data: Uint8ClampedArray<ArrayBuffer>, w: number, h: number) {
  const canvas = document.createElement("canvas")
  canvas.width = w
  canvas.height = h
  canvas.getContext("2d")!.putImageData(new ImageData(data, w, h), 0, 0)
  const url = canvas.toDataURL()
  canvas.width = canvas.height = 0 // suelta el buffer del canvas
  return url
}

// Mapas de un tamaño (ya redondeado), en px CSS. Se generan a ≤ 2× y ≤ 512 px por lado.
function mapsFor(w: number, h: number, radius: number): Urls {
  const key = `${w}x${h}r${radius}`
  const hit = cache.get(key)
  if (hit) return hit
  const s = Math.min(window.devicePixelRatio || 1, 2, MAX_SIDE / w, MAX_SIDE / h)
  const pw = Math.max(1, Math.round(w * s))
  const ph = Math.max(1, Math.round(h * s))
  const bezel = Math.min(w, h) * 0.25 * s
  const maps = glassMaps(pw, ph, radius * s, bezel)
  const urls = {
    displacement: toUrl(maps.displacement, pw, ph),
    specular: toUrl(maps.specular, pw, ph),
    maxDisplacement: maps.maxDisplacement / s,
  }
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!)
  cache.set(key, urls)
  return urls
}

const idle = (fn: () => void): (() => void) => {
  if ("requestIdleCallback" in window) {
    const id = requestIdleCallback(fn, { timeout: 500 })
    return () => cancelIdleCallback(id)
  }
  const id = setTimeout(fn, 50)
  return () => clearTimeout(id)
}

/** Monta la refracción en `target` y devuelve cómo desmontarla. */
export function attachRefraction(target: HTMLElement) {
  const id = `liquid-refraction-${++seq}`
  const map = el("feImage", { result: "map", preserveAspectRatio: "none", x: "0", y: "0" })
  const shift = el("feDisplacementMap", {
    in: "SourceGraphic",
    in2: "map",
    xChannelSelector: "R",
    yChannelSelector: "G",
    scale: "0",
    result: "refracted",
  })
  const shine = el("feImage", { result: "shine", preserveAspectRatio: "none", x: "0", y: "0" })
  const filter = el("filter", { id, "color-interpolation-filters": "sRGB" })
  filter.append(map, shift, shine, el("feBlend", { in: "shine", in2: "refracted", mode: "screen" }))
  svgHost().append(filter)

  let peak = 0 // desplazamiento máximo del tamaño actual, en px
  let built = "" // tamaño redondeado del mapa puesto
  let pressed = false
  let cancelBuild: (() => void) | null = null
  let debounce = 0
  let frame = 0
  let scale = 0

  const active = () =>
    !document.hidden &&
    !reduceTransparency.matches &&
    !moreContrast.matches &&
    getGlass() < LEVEL_STRENGTH.length
  const restScale = () => 2 * peak * (LEVEL_STRENGTH[getGlass()] ?? 0)

  // feDisplacementMap mueve scale·(canal − 0.5): con el canal al tope (≈1) son peak px → scale = 2·peak.
  // El press solo anima este número; el mapa no se toca.
  function tweenScale(to: number, ms: number) {
    cancelAnimationFrame(frame)
    const from = scale
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min((now - start) / ms, 1)
      scale = from + (to - from) * (1 - (1 - t) ** 3)
      shift.setAttribute("scale", scale.toFixed(2))
      if (t < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
  }

  // Tamaño de layout (no cambia con el squish, que es transform) redondeado a 4 px: la clave del mapa.
  // null = oculto, o sin vidrio en este ancho (`max-md:liquid-glass` en escritorio).
  function measure() {
    const w = target.offsetWidth
    const h = target.offsetHeight
    const style = getComputedStyle(target)
    if (!w || !h || style.backdropFilter === "none") return null
    const rw = Math.max(STEP, Math.round(w / STEP) * STEP)
    const rh = Math.max(STEP, Math.round(h / STEP) * STEP)
    const radius = Math.min(parseFloat(style.borderTopLeftRadius) || 0, rw / 2, rh / 2)
    return { w, h, rw, rh, radius, key: `${rw}x${rh}r${radius}` }
  }

  // Estirar el mapa al tamaño exacto es barato y va al tiro: así no queda una franja sin mapa
  // mientras el elemento cambia de ancho (MonthNav cuando entra «Hoy»).
  function stretch(w: number, h: number) {
    for (const img of [map, shine]) {
      img.setAttribute("width", String(w))
      img.setAttribute("height", String(h))
    }
  }

  function build() {
    cancelBuild = null
    if (!active()) {
      built = "" // apagada: no genera mapas; sync() los pide al volver
      return
    }
    const size = measure()
    if (!size) return
    if (size.key !== built) {
      const urls = mapsFor(size.rw, size.rh, size.radius)
      map.setAttribute("href", urls.displacement)
      shine.setAttribute("href", urls.specular)
      peak = urls.maxDisplacement
      built = size.key
    }
    stretch(size.w, size.h)
    sync()
  }

  function onResize() {
    const size = measure()
    if (!size) return
    stretch(size.w, size.h)
    if (size.key !== built) schedule() // regenerar solo si cambió el tamaño redondeado
  }

  function schedule() {
    clearTimeout(debounce)
    debounce = window.setTimeout(() => {
      cancelBuild?.()
      cancelBuild = idle(build)
    }, 150)
  }

  // Prende o apaga según preferencias, nivel y visibilidad; el nivel solo cambia la intensidad.
  function sync() {
    if (!active()) {
      target.style.removeProperty("--glass-refraction")
      return
    }
    if (!built) return schedule()
    scale = restScale() * (pressed ? PRESS_BOOST : 1)
    shift.setAttribute("scale", scale.toFixed(2))
    target.style.setProperty("--glass-refraction", `url(#${id})`)
  }

  function press(e: PointerEvent) {
    if (reduceMotion.matches || !(e.target as Element).closest("[data-squish]:not(:disabled):not([aria-disabled=true])")) return
    pressed = true
    tweenScale(restScale() * PRESS_BOOST, 120)
  }
  function release() {
    if (!pressed) return
    pressed = false
    tweenScale(restScale(), 320)
  }

  const ro = new ResizeObserver(onResize)
  ro.observe(target)
  const unsubscribe = subscribeGlass(sync)
  const queries = [reduceTransparency, moreContrast]
  queries.forEach((q) => q.addEventListener("change", sync))
  document.addEventListener("visibilitychange", sync)
  target.addEventListener("pointerdown", press)
  for (const type of ["pointerup", "pointercancel", "pointerleave"] as const)
    target.addEventListener(type, release)

  return () => {
    ro.disconnect()
    unsubscribe()
    queries.forEach((q) => q.removeEventListener("change", sync))
    document.removeEventListener("visibilitychange", sync)
    target.removeEventListener("pointerdown", press)
    for (const type of ["pointerup", "pointercancel", "pointerleave"] as const)
      target.removeEventListener(type, release)
    clearTimeout(debounce)
    cancelBuild?.()
    cancelAnimationFrame(frame)
    target.style.removeProperty("--glass-refraction")
    filter.remove()
  }
}
