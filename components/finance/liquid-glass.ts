"use client"

import * as React from "react"
import type { GlassConfig, LiquidGlass } from "@ybouane/liquidglass"
import { GLASS_DEFAULT, GLASS_MAX, getGlass, subscribeGlass } from "@/lib/glass-level"

// Refracción de Liquid Glass (WDC-179) con @ybouane/liquidglass: un shader WebGL sobre una foto
// (html-to-image) de lo que hay detrás. El vidrio CSS (`liquid-glass`) es siempre el respaldo.
//
// La librería exige que cada vidrio sea hijo directo de su root y dibuja detrás solo a los otros
// hijos del root. Cada superficie es un root con su propia instancia (un contexto WebGL):
// - el marco de la app (wrapper del sidebar): la barra inferior, que ya es hija directa, y los
//   controles flotantes (cápsula del mes, «Hoy», círculo de búsqueda);
// - cada hoja abierta (vaul): los círculos de vidrio de su encabezado;
// - cada slider, desde el primer toque: la perilla mientras se arrastra, sobre su pista.
// Los controles que no son hijos directos no se mueven: se les pone detrás un «proxy», un div
// vacío hijo directo del root que copia su caja (posición, tamaño, transform, radio, opacidad) y
// lleva el vidrio; el control queda transparente encima (`data-lg-proxied`, globals.css). Antes de
// que la librería arranque, el proxy es vidrio CSS, igual al del control.
//
// ponytail: techo conocido. (1) La foto es el contenido entero a devicePixelRatio: una página
// larga pasa el tope de área de canvas de iOS (~16,7 MP) y ahí vuelve el vidrio CSS. (2) Cada
// cambio del contenido recaptura todo (html-to-image en el hilo principal, con debounce): en el
// iPhone puede costar cientos de ms y batería. (3) La librería no sigue el scroll ni los proxies:
// se le avisa por frame. (4) Toca dos privados de la 1.0.3, fijada exacta en package.json: el
// fondo blanco de su escena (se pinta con el del tema) y el contexto WebGL, que su destroy no
// libera. La mejora es capturar solo la franja detrás de cada vidrio (PR #6 de
// ybouane/liquidglass): al subir de versión, revisar (4) y quitar (1).

// Se apaga si cualquiera calza. Separadas por coma (OR) a propósito: un motor que no conoce
// prefers-reduced-transparency la evalúa falsa sola, sin anular las demás.
const OFF_QUERY =
  "(min-width: 768px), (prefers-reduced-transparency: reduce), (prefers-contrast: more), (prefers-reduced-motion: reduce)"
const INIT_TIMEOUT_MS = 3000 // init puede no resolver nunca en Chrome reciente (issue #3 upstream)
const RECAPTURE_DEBOUNCE_MS = 600
const RESTART_DEBOUNCE_MS = 400
const TRACK_MS = 700 // cuánto se siguen las cajas después del último evento que las mueve
const SHEET_DELAY_MS = 450 // la hoja termina de subir y sus acciones llegan por portal
const MAX_CANVAS_AREA = 16_000_000

// Nivel 0–3 de Apariencia → shader. El tinte no va aquí: lo pone el --glass-fill CSS del nivel;
// la sombra tampoco: queda la de --glass-shadow.
const BASE: Partial<GlassConfig> = {
  brightness: 0,
  tintStrength: 0,
  shadowOpacity: 0,
}
const LEVELS: Partial<GlassConfig>[] = [
  { blurAmount: 0.05, refraction: 0.69, saturation: 0.3 },
  { blurAmount: 0.12, refraction: 0.6, saturation: 0.4 },
  { blurAmount: 0.2, refraction: 0.5, saturation: 0.5 },
  { blurAmount: 0.3, refraction: 0.3, saturation: 0.6 },
]

// Los controles flotantes del marco: la fila superior móvil y lo marcado con data-lg-control.
const SHELL_CONTROLS =
  '.top-bar :is(.liquid-glass, [class~="max-md:liquid-glass"]), [data-lg-control]'
const SHEET_CONTROLS = '[data-slot="drawer-header"] .liquid-glass'

type Options = {
  root: HTMLElement
  glass?: HTMLElement[] // hijos directos del root que son vidrio ellos mismos
  controls: () => HTMLElement[] // controles en cualquier parte del root: van con proxy
  isOn?: (control: HTMLElement, pressed: boolean) => boolean // por defecto, siempre
  dynamic?: () => HTMLElement[] // se recapturan por frame mientras hay un dedo encima
  followScroll?: boolean // el root se desplaza con la ventana y hay vidrios fijos encima
  pressed?: boolean // se montó desde un pointerdown que sigue en curso
}

const allowed = (mql: MediaQueryList) => !mql.matches && getGlass() < GLASS_MAX

// Monta una superficie y la mantiene al día con la accesibilidad y el nivel de vidrio. Devuelve
// cómo desmontarla, que deja el DOM como estaba.
function mountSurface(o: Options): () => void {
  const mql = window.matchMedia(OFF_QUERY)
  let stop: (() => void) | null = null
  const update = () => {
    if (allowed(mql)) stop ??= startSession(o)
    else {
      stop?.()
      stop = null
    }
  }
  update()
  mql.addEventListener("change", update)
  const unsubscribe = subscribeGlass(update)
  return () => {
    mql.removeEventListener("change", update)
    unsubscribe()
    stop?.()
  }
}

function startSession(o: Options): () => void {
  const { root } = o
  const glassEls = o.glass ?? []
  const proxies: HTMLElement[] = []
  const assigned = new Map<HTMLElement, HTMLElement>() // proxy → control
  let inst: LiquidGlass | null = null
  let alive = true
  let starting = false
  let failed = false // timeout, sin WebGL o error: queda el CSS original hasta desmontar
  let pressed = !!o.pressed
  let raf = 0
  let trackUntil = 0
  let markNext = false
  let recaptureTimer = 0
  let restartTimer = 0
  let bg = "#ffffff"
  const rootPosition = root.style.position
  if (getComputedStyle(root).position === "static") root.style.position = "relative"

  const all = () => [...glassEls, ...proxies]
  const fits = () => {
    const dpr = window.devicePixelRatio || 1
    return root.offsetWidth * root.offsetHeight * dpr * dpr < MAX_CANVAS_AREA
  }
  const configFor = (el: HTMLElement) => {
    const radius = Math.min(
      parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0,
      el.offsetHeight / 2
    )
    return JSON.stringify({
      ...BASE,
      ...(LEVELS[getGlass()] ?? LEVELS[GLASS_DEFAULT]),
      cornerRadius: radius,
      zRadius: Math.min(24, radius),
    })
  }
  const setConfig = (glass: HTMLElement, from: HTMLElement) => {
    const config = configFor(from)
    if (glass.dataset.config !== config) glass.dataset.config = config
  }
  const setDynamic = (on: boolean) => {
    for (const el of o.dynamic?.() ?? []) el.toggleAttribute("data-dynamic", on)
  }
  // Fondo de la escena: el primero no transparente desde el root hacia arriba (sigue al tema).
  const readBg = () => {
    for (let e: HTMLElement | null = root; e; e = e.parentElement) {
      const c = getComputedStyle(e).backgroundColor
      if (c && c !== "transparent" && !/,\s*0\)$/.test(c) && !/\/\s*0\)$/.test(c)) {
        bg = c
        return
      }
    }
  }

  // El hijo directo del root que contiene al control, y la capa en que se pinta.
  const topChild = (el: HTMLElement) => {
    let e: HTMLElement | null = el
    while (e && e.parentElement !== root) e = e.parentElement
    return e
  }
  const layer = (el: HTMLElement) => {
    let pinned = false
    let z = "auto"
    for (let e: HTMLElement | null = el; e && e !== root; e = e.parentElement) {
      const s = getComputedStyle(e)
      if (s.position === "fixed" || s.position === "sticky") pinned = true
      if (z === "auto" && s.position !== "static" && s.zIndex !== "auto") z = s.zIndex
    }
    return { pinned, z }
  }

  const makeProxy = () => {
    const p = document.createElement("div")
    p.className = "liquid-glass"
    p.setAttribute("aria-hidden", "true")
    p.setAttribute("data-nuevo", "")
    p.dataset.lgProxy = ""
    p.style.cssText =
      "left:0;top:0;width:0;height:0;margin:0;pointer-events:none;isolation:isolate;visibility:hidden"
    return p
  }
  const hide = (p: HTMLElement) => {
    if (p.dataset.lgKey === "hidden") return false
    p.dataset.lgKey = "hidden"
    p.style.visibility = "hidden"
    p.style.width = p.style.height = "0px"
    return true
  }

  // Copia la caja del control al proxy. Devuelve si algo cambió.
  const place = (p: HTMLElement, c: HTMLElement | undefined) => {
    if (!c) return hide(p)
    const s = getComputedStyle(c)
    let opacity = 1
    for (let e: HTMLElement | null = c; e && e !== root; e = e.parentElement)
      opacity *= Number(getComputedStyle(e).opacity)
    const w = c.offsetWidth
    const h = c.offsetHeight
    const on =
      (o.isOn?.(c, pressed) ?? true) &&
      s.visibility === "visible" &&
      w > 0 &&
      h > 0 &&
      opacity > 0.01
    c.toggleAttribute("data-lg-proxied", on)
    if (!on) return hide(p)
    const r = c.getBoundingClientRect()
    const { pinned, z } = layer(c)
    // Centro de la caja visible menos media caja sin transform: el transform se copia aparte.
    let x = r.left + r.width / 2 - w / 2
    let y = r.top + r.height / 2 - h / 2
    if (!pinned) {
      const rr = root.getBoundingClientRect()
      x -= rr.left + root.clientLeft
      y -= rr.top + root.clientTop
    }
    const key = [pinned, x, y, w, h, s.transform, s.borderRadius, z, opacity].join("|")
    if (p.dataset.lgKey === key) return false
    p.dataset.lgKey = key
    p.toggleAttribute("data-lg-pinned", pinned)
    Object.assign(p.style, {
      left: `${x}px`,
      top: `${y}px`,
      width: `${w}px`,
      height: `${h}px`,
      transform: s.transform,
      borderRadius: s.borderRadius,
      zIndex: z,
      opacity: String(opacity),
      visibility: "visible",
    })
    // Justo antes del hijo que lo contiene: en la misma capa se pinta debajo del control.
    const child = topChild(c)
    if (child && p.nextElementSibling !== child) root.insertBefore(p, child)
    setConfig(p, c)
    return true
  }

  const sync = () => {
    const controls = o.controls().filter((c) => c.isConnected)
    if (controls.length > proxies.length && proxies.length) scheduleRestart()
    let changed = false
    proxies.forEach((p, i) => {
      const c = controls[i]
      const prev = assigned.get(p)
      if (prev && prev !== c) prev.removeAttribute("data-lg-proxied")
      if (c) assigned.set(p, c)
      else assigned.delete(p)
      changed = place(p, c) || changed
    })
    for (const g of glassEls) setConfig(g, g)
    return changed
  }

  const tick = () => {
    raf = 0
    if (!alive) return
    if (sync() || markNext) inst?.markChanged()
    markNext = false
    if (pressed || performance.now() < trackUntil) raf = requestAnimationFrame(tick)
  }
  const kick = () => {
    trackUntil = performance.now() + TRACK_MS
    if (!raf && alive) raf = requestAnimationFrame(tick)
  }

  const release = (i: LiquidGlass) => {
    i.destroy()
    // Su destroy no libera el contexto WebGL, y iOS admite pocos a la vez.
    const canvas = i.renderer.canvas
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl")
    gl?.getExtension("WEBGL_lose_context")?.loseContext()
    // destroy también quita estilos en línea de los vidrios: los proxies se vuelven a ubicar. Su
    // position vive en globals.css ([data-lg-proxy]) para que nunca caigan al flujo del flex.
    for (const p of proxies) delete p.dataset.lgKey
    kick()
  }
  const stopInst = () => {
    if (!inst) return
    release(inst)
    inst = null
    for (const g of all()) delete g.dataset.lgActive
  }
  // La escena de la librería arranca en blanco: se pinta con el fondo del tema.
  const patchScene = (i: LiquidGlass) => {
    const ctx = (i as unknown as { _sceneCtx?: CanvasRenderingContext2D })._sceneCtx
    if (!ctx) return
    const fill = ctx.fillRect.bind(ctx)
    ctx.fillRect = (x, y, w, h) => {
      if (ctx.fillStyle === "#ffffff") ctx.fillStyle = bg
      fill(x, y, w, h)
    }
  }
  const removeProxies = () => {
    for (const c of assigned.values()) c.removeAttribute("data-lg-proxied")
    assigned.clear()
    for (const p of proxies) p.remove()
    proxies.length = 0
  }

  const start = () => {
    if (inst || starting || failed || !alive || !fits()) return
    starting = true
    const need = o.controls().length + 1 // uno de holgura: «Hoy» aparece y desaparece
    while (proxies.length < need) proxies.push(makeProxy())
    for (const p of proxies) if (!p.isConnected) root.prepend(p)
    sync()
    readBg()
    setDynamic(true) // la librería decide al iniciar si hay contenido dinámico
    let timedOut = false
    const fail = () => {
      starting = false
      failed = true
      setDynamic(false)
      removeProxies()
    }
    const timer = window.setTimeout(() => {
      timedOut = true
      fail()
    }, INIT_TIMEOUT_MS)
    import("@ybouane/liquidglass")
      .then(({ LiquidGlass }) =>
        LiquidGlass.init({ root, glassElements: all(), defaults: BASE })
      )
      .then(
        (i) => {
          window.clearTimeout(timer)
          starting = false
          // Llegó tarde, se desmontó o el contenido creció mientras arrancaba.
          if (timedOut || !alive || !fits()) return release(i)
          inst = i
          patchScene(i)
          setDynamic(pressed)
          for (const g of all()) g.dataset.lgActive = ""
          markNext = true
          kick()
        },
        () => {
          window.clearTimeout(timer)
          if (!timedOut) fail()
        }
      )
  }
  function scheduleRestart() {
    window.clearTimeout(restartTimer)
    restartTimer = window.setTimeout(() => {
      if (starting || !alive || failed) return
      stopInst()
      start()
    }, RESTART_DEBOUNCE_MS)
  }

  // Contenido o tema distintos: la librería no recaptura si el tamaño no cambia. `force` conserva
  // la foto anterior hasta que llega la nueva (sin parpadeo en blanco).
  const recapture = () => {
    window.clearTimeout(recaptureTimer)
    recaptureTimer = window.setTimeout(() => {
      readBg()
      if (!inst) return
      const glass = all()
      for (const child of root.children)
        if (!glass.includes(child as HTMLElement))
          void inst.capture.captureElement(child as HTMLElement, true)
    }, RECAPTURE_DEBOUNCE_MS)
  }
  const ownMutation = (m: MutationRecord) =>
    all().some((g) => g.contains(m.target)) ||
    (m.target === root &&
      [...m.addedNodes, ...m.removedNodes].every((n) =>
        proxies.includes(n as HTMLElement)
      ))
  const contentObserver = new MutationObserver((records) => {
    if (records.every(ownMutation)) return
    kick()
    recapture()
  })
  contentObserver.observe(root, { childList: true, subtree: true, characterData: true })
  const themeObserver = new MutationObserver(recapture)
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  })
  // Con otro tamaño la librería estira la foto vieja hasta que llega la nueva: el contenido
  // aparecería corrido (más con más scroll). Mejor la escena lisa del fondo mientras tanto.
  const sizeObserver = new ResizeObserver(() => {
    if (!fits()) stopInst()
    else if (inst) {
      const glass = all()
      for (const child of root.children)
        if (!glass.includes(child as HTMLElement)) inst.capture.invalidateCache(child as HTMLElement)
      markNext = true
    } else start()
    kick()
  })
  sizeObserver.observe(root)

  const onScroll = () => {
    markNext = true
    kick()
  }
  const onDown = () => {
    pressed = true
    if (inst) setDynamic(true)
    kick()
  }
  const onUp = () => {
    if (!pressed) return
    pressed = false
    setDynamic(false)
    kick()
  }
  root.addEventListener("transitionrun", kick)
  root.addEventListener("animationstart", kick)
  root.addEventListener("pointerdown", onDown)
  window.addEventListener("pointerup", onUp)
  window.addEventListener("pointercancel", onUp)
  window.addEventListener("resize", onScroll, { passive: true })
  if (o.followScroll) window.addEventListener("scroll", onScroll, { passive: true })
  start()

  return () => {
    alive = false
    cancelAnimationFrame(raf)
    window.clearTimeout(recaptureTimer)
    window.clearTimeout(restartTimer)
    contentObserver.disconnect()
    themeObserver.disconnect()
    sizeObserver.disconnect()
    root.removeEventListener("transitionrun", kick)
    root.removeEventListener("animationstart", kick)
    root.removeEventListener("pointerdown", onDown)
    window.removeEventListener("pointerup", onUp)
    window.removeEventListener("pointercancel", onUp)
    window.removeEventListener("resize", onScroll)
    window.removeEventListener("scroll", onScroll)
    stopInst()
    setDynamic(false)
    removeProxies()
    for (const g of glassEls) delete g.dataset.config
    root.style.position = rootPosition
  }
}

// Monta la superficie del marco (la barra `navRef` y los controles flotantes) y vigila las hojas
// que se abren y los sliders que se tocan. Una vez por app, en el marco.
export function useLiquidGlass(navRef: React.RefObject<HTMLElement | null>) {
  React.useEffect(() => {
    const nav = navRef.current
    const root = nav?.parentElement
    if (!nav || !root) return

    const mounted = new Map<HTMLElement, () => void>()
    const pending = new Map<HTMLElement, number>()
    mounted.set(
      root,
      mountSurface({
        root,
        glass: [nav],
        controls: () => [...root.querySelectorAll<HTMLElement>(SHELL_CONTROLS)],
        followScroll: true,
      })
    )

    const mountSheet = (sheet: HTMLElement) => {
      pending.delete(sheet)
      if (!sheet.isConnected || sheet.dataset.state !== "open" || mounted.has(sheet)) return
      mounted.set(
        sheet,
        mountSurface({
          root: sheet,
          controls: () => [...sheet.querySelectorAll<HTMLElement>(SHEET_CONTROLS)],
        })
      )
    }
    let queued = false
    const scan = () => {
      queued = false
      for (const sheet of document.querySelectorAll<HTMLElement>(
        '[data-slot="drawer-content"][data-state="open"]'
      ))
        if (!mounted.has(sheet) && !pending.has(sheet))
          pending.set(sheet, window.setTimeout(() => mountSheet(sheet), SHEET_DELAY_MS))
      for (const [el, unmount] of mounted)
        if (el !== root && (!el.isConnected || el.dataset.state === "closed")) {
          unmount()
          mounted.delete(el)
        }
    }
    const bodyObserver = new MutationObserver(() => {
      if (queued) return
      queued = true
      requestAnimationFrame(scan)
    })
    bodyObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-state"],
    })

    // Slider: su propio root (la pista es lo de atrás), montado con el primer toque.
    const onSliderDown = (e: PointerEvent) => {
      const slider = (e.target as Element | null)?.closest<HTMLElement>('[data-slot="slider"]')
      if (!slider || mounted.has(slider) || slider.hasAttribute("data-disabled")) return
      const thumbs = () => [
        ...slider.querySelectorAll<HTMLElement>('[data-slot="slider-thumb"]'),
      ]
      mounted.set(
        slider,
        mountSurface({
          root: slider,
          controls: thumbs,
          // Como el CSS: en el simple, mientras hay dedo; en el rango, la perilla tomada (foco).
          isOn: (thumb, pressed) =>
            pressed && (thumbs().length === 1 || thumb === document.activeElement),
          dynamic: () => [
            ...slider.querySelectorAll<HTMLElement>('[data-slot="slider-track"]'),
          ],
          pressed: true,
        })
      )
    }
    document.addEventListener("pointerdown", onSliderDown, true)

    return () => {
      document.removeEventListener("pointerdown", onSliderDown, true)
      bodyObserver.disconnect()
      for (const t of pending.values()) window.clearTimeout(t)
      for (const unmount of mounted.values()) unmount()
    }
  }, [navRef])
}
