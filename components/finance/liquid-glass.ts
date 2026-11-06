"use client"

import * as React from "react"
import type { GlassConfig, LiquidGlass } from "@ybouane/liquidglass"
import {
  GLASS_DEFAULT,
  GLASS_MAX,
  getGlass,
  subscribeGlass,
} from "@/lib/glass-level"
import { untransformedOrigin } from "@/lib/liquid-glass-box"

// Refracción de Liquid Glass (WDC-179) con @ybouane/liquidglass: un shader WebGL sobre una foto
// (html-to-image) de lo que hay detrás. El vidrio CSS es siempre el respaldo.
//
// La librería exige que cada vidrio sea hijo directo de su root y dibuja detrás solo a los otros
// hijos del root. Cada superficie es un root con su propia instancia (un contexto WebGL):
// - el marco de la app (wrapper del sidebar): la barra inferior, que ya es hija directa, y todo
//   control de vidrio de las páginas (GLASS_CONTROLS);
// - cada hoja abierta (vaul): sus controles de vidrio;
// - los menús, selects y popovers abiertos, juntos, con <body> como root;
// - cada slider, desde el primer toque: la perilla mientras se arrastra, sobre su pista.
// Los controles no se mueven: detrás de cada uno va un «proxy», un div vacío hijo directo del root
// que copia su caja (posición, tamaño, transform, radio, opacidad) y lleva el vidrio; el control
// queda sin fondo encima (`data-lg-proxied`, globals.css). Antes de que la librería arranque, y
// mientras recaptura, el proxy es vidrio CSS.
//
// ponytail: techo conocido. (1) La foto es el contenido entero a devicePixelRatio: una página
// larga pasa el tope de área de canvas de iOS (~16,7 MP) y ahí vuelve el vidrio CSS. (2) Cada
// cambio del contenido recaptura todo (html-to-image en el hilo principal, con debounce y después
// de la entrada de la página): en el iPhone puede costar cientos de ms y batería. (3) La librería
// no sigue el scroll ni los proxies: se le avisa por frame. (4) Toca dos privados de la 1.0.3,
// fijada exacta en package.json: el fondo blanco de su escena (se pinta con el del tema) y el
// contexto WebGL, que su destroy no libera. (5) Un control dentro de un contexto de apilamiento
// sin z-index (transform, opacidad) no lleva proxy: el vidrio no puede quedar entre él y su fondo.
// (6) Un control dentro de un scroll interno (el cuerpo de una hoja, una fila que se desliza) no
// lleva proxy: no lo seguiría ni quedaría recortado. (7) Cada popup que se abre vuelve a capturar
// lo de atrás; las fuentes embebidas ya se comparten entre instancias (módulo de la librería), los
// estilos de la foto no se pueden cachear desde afuera. (8) Si init se cuelga, su contexto WebGL
// queda vivo (no hay instancia que destruir) y no se reintenta hasta recargar (`hung`).
// La mejora es capturar solo la franja detrás de cada vidrio (PR #6 de ybouane/liquidglass): al
// subir de versión, revisar (4) y quitar (1).

// Se apaga si cualquiera calza. Separadas por coma (OR) a propósito: un motor que no conoce
// prefers-reduced-transparency la evalúa falsa sola, sin anular las demás.
const OFF_QUERY =
  "(min-width: 768px), (prefers-reduced-transparency: reduce), (prefers-contrast: more), (prefers-reduced-motion: reduce)"
const INIT_TIMEOUT_MS = 3000 // init puede no resolver nunca en Chrome reciente (issue #3 upstream)
const REFRESH_DEBOUNCE_MS = 400
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
const POPUP_MIN_BLUR = 0.3 // texto encima: lo de atrás no puede competir con él

// Todo control de vidrio: las cápsulas y círculos `liquid-glass`, los botones redondos secundarios
// (steppers, íconos), la pestaña activa de Tabs y lo marcado con data-lg-control (la pastilla de
// Segmented, la búsqueda).
const GLASS_CONTROLS = [
  ".liquid-glass:not([data-lg-proxy])",
  '[class~="max-md:liquid-glass"]',
  "[data-lg-control]",
  '[data-slot="button"][data-variant="secondary"][data-size^="icon"]',
  '[data-slot="tabs-trigger"][data-state="active"]',
].join(",")
const POPUPS = [
  "dropdown-menu-content",
  "dropdown-menu-sub-content",
  "select-content",
  "popover-content",
]
  .map((slot) => `[data-slot="${slot}"][data-state="open"]`)
  .join(",")

type Options = {
  root: HTMLElement
  glass?: HTMLElement[] // hijos directos del root que son vidrio ellos mismos
  controls: () => HTMLElement[] // controles en cualquier parte del root: van con proxy
  isOn?: (control: HTMLElement, pressed: boolean) => boolean // por defecto, siempre
  dynamic?: () => HTMLElement[] // se recapturan por frame mientras hay un dedo encima
  pressed?: boolean // se montó desde un pointerdown que sigue en curso
  popup?: boolean // material de lectura: más relleno y más desenfoque
  positionRoot?: boolean // el root hace de bloque contenedor de los proxies (no en <body>)
}

const allowed = (mql: MediaQueryList) => !mql.matches && getGlass() < GLASS_MAX
// Hay una navegación en curso (useNavDirection marca <html> hasta que termina la entrada).
const navigating = () => document.documentElement.hasAttribute("data-nav-dir")

let proxySeq = 0
let hung = false // un init colgado: no se reintenta en esta carga (ponytail 8)

// La librería pone user-select: none en su root para arrastrar vidrios «floating», que aquí no
// hay; sin esto no se selecciona texto en la app, en una hoja ni con un menú abierto (root body).
const freeSelect = (root: HTMLElement) => {
  root.style.removeProperty("user-select")
  root.style.removeProperty("-webkit-user-select")
}

// Crea un contexto de apilamiento (resumen de la regla de CSS).
function stacks(s: CSSStyleDeclaration) {
  return (
    (s.position !== "static" && s.zIndex !== "auto") ||
    s.position === "fixed" ||
    s.position === "sticky" ||
    s.transform !== "none" ||
    Number(s.opacity) < 1 ||
    s.filter !== "none" ||
    s.isolation === "isolate" ||
    /transform|opacity/.test(s.willChange) ||
    /paint|strict|content/.test(s.contain) ||
    s.containerType !== "normal" ||
    s.mixBlendMode !== "normal" ||
    s.clipPath !== "none" ||
    s.backdropFilter !== "none" ||
    (s.getPropertyValue("-webkit-backdrop-filter") || "none") !== "none" ||
    s.maskImage !== "none" ||
    (s.getPropertyValue("-webkit-mask-image") || "none") !== "none"
  )
}

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
  let refreshTimer = 0
  let restartTimer = 0
  let bg = "#ffffff"
  const rootPosition = root.style.position
  if (o.positionRoot !== false && getComputedStyle(root).position === "static")
    root.style.position = "relative"

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
    const level = LEVELS[getGlass()] ?? LEVELS[GLASS_DEFAULT]
    return JSON.stringify({
      ...BASE,
      ...level,
      ...(o.popup && {
        blurAmount: Math.max(level.blurAmount ?? 0, POPUP_MIN_BLUR),
      }),
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
  const setActive = (on: boolean) => {
    for (const g of all()) g.toggleAttribute("data-lg-active", on && !!inst)
  }
  // Fondo de la escena: el primero no transparente desde el root hacia arriba (sigue al tema).
  const readBg = () => {
    for (let e: HTMLElement | null = root; e; e = e.parentElement) {
      const c = getComputedStyle(e).backgroundColor
      if (
        c &&
        c !== "transparent" &&
        !/,\s*0\)$/.test(c) &&
        !/\/\s*0\)$/.test(c)
      ) {
        bg = c
        return
      }
    }
  }

  // El hijo directo del root que contiene al control.
  const topChild = (el: HTMLElement) => {
    let e: HTMLElement | null = el
    while (e && e.parentElement !== root) e = e.parentElement
    return e
  }
  // Dónde se pinta el proxy para quedar entre el control y lo de atrás:
  // - sin contexto de apilamiento entre el control y el root: z 1, y el control sube a z 2;
  // - con uno, el más externo (la fila superior, el contenedor de la búsqueda, el de un menú, la
  //   perilla): su mismo z, justo antes en el árbol. Sirve si es hijo del root o si tiene z propio;
  //   si no, no hay lugar (null) y queda el vidrio CSS.
  // - dentro de un scroll interno, o recortado por un overflow hidden, tampoco (ponytail 6).
  const layer = (c: HTMLElement) => {
    let pinned = getComputedStyle(c).position === "fixed"
    let outer: HTMLElement | null = null
    let box: DOMRect | null = null
    for (let e = c.parentElement; e && e !== root; e = e.parentElement) {
      const s = getComputedStyle(e)
      const overflow = `${s.overflowX} ${s.overflowY}`
      if (/auto|scroll/.test(overflow)) return null
      if (/hidden|clip/.test(overflow)) {
        box ??= c.getBoundingClientRect()
        const r = e.getBoundingClientRect()
        if (
          box.left < r.left - 0.5 ||
          box.top < r.top - 0.5 ||
          box.right > r.right + 0.5 ||
          box.bottom > r.bottom + 0.5
        )
          return null
      }
      if (s.position === "fixed" || s.position === "sticky") pinned = true
      if (stacks(s)) outer = e
    }
    if (!outer) return { pinned, z: "1", lift: true }
    const z = getComputedStyle(outer).zIndex
    if (topChild(c) !== outer && z === "auto") return null
    return { pinned, z, lift: false }
  }

  const makeProxy = () => {
    const p = document.createElement("div")
    p.className = "liquid-glass"
    p.setAttribute("aria-hidden", "true")
    p.dataset.lgProxy = String(++proxySeq)
    if (o.popup) p.dataset.lgPopup = ""
    p.style.cssText =
      "left:0;top:0;width:0;height:0;margin:0;pointer-events:none;isolation:isolate;visibility:hidden"
    return p
  }
  const hide = (p: HTMLElement) => {
    if (p.dataset.lgKey === "hidden") return false
    p.dataset.lgKey = "hidden"
    p.style.visibility = "hidden"
    p.style.width = p.style.height = "0px"
    p.style.viewTransitionName = ""
    return true
  }
  const release = (c: HTMLElement) => {
    c.removeAttribute("data-lg-proxied")
    c.removeAttribute("data-lg-lift")
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
    const where =
      (o.isOn?.(c, pressed) ?? true) &&
      s.visibility === "visible" &&
      w > 0 &&
      h > 0 &&
      opacity > 0.01
        ? layer(c)
        : null
    // Al cambiar de página el contenido se desliza (view transition) y un proxy que no está fijo
    // quedaría quieto: mientras dura, ese control lleva su propio vidrio CSS.
    if (!where || (!where.pinned && navigating())) {
      release(c)
      return hide(p)
    }
    c.setAttribute("data-lg-proxied", "")
    if (where.lift && !c.hasAttribute("data-lg-lift"))
      c.setAttribute("data-lg-lift", s.position === "static" ? "static" : "")
    // La caja sin transform: el transform se copia aparte (lib/liquid-glass-box.ts).
    const [ox, oy] = s.transformOrigin.split(" ").map(parseFloat)
    let { x, y } = untransformedOrigin(
      c.getBoundingClientRect(),
      w,
      h,
      s.transform === "none" ? undefined : new DOMMatrix(s.transform),
      { x: ox, y: oy }
    )
    if (!where.pinned) {
      const rr = root.getBoundingClientRect()
      x -= rr.left + root.clientLeft
      y -= rr.top + root.clientTop
    }
    const key = [
      where.pinned,
      x,
      y,
      w,
      h,
      s.transform,
      s.transformOrigin,
      s.borderRadius,
      where.z,
      opacity,
    ].join("|")
    if (p.dataset.lgKey === key) return false
    p.dataset.lgKey = key
    p.toggleAttribute("data-lg-pinned", where.pinned)
    Object.assign(p.style, {
      left: `${x}px`,
      top: `${y}px`,
      width: `${w}px`,
      height: `${h}px`,
      transform: s.transform,
      transformOrigin: s.transformOrigin, // los menús escalan desde su disparador
      borderRadius: s.borderRadius,
      zIndex: where.z,
      opacity: String(opacity),
      visibility: "visible",
      // Fijo, queda quieto con el marco en el cambio de página (globals.css, `lg-proxy`).
      viewTransitionName: where.pinned ? `lg-proxy-${p.dataset.lgProxy}` : "",
    })
    p.style.setProperty("view-transition-class", where.pinned ? "lg-proxy" : "")
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
    // Primero se sueltan todos, después se ubican: soltar después podría quitarle el proxied a un
    // control que otro proxy acaba de tomar (queda su vidrio CSS encima del proxy).
    proxies.forEach((p, i) => {
      const prev = assigned.get(p)
      if (prev && prev !== controls[i]) release(prev)
    })
    proxies.forEach((p, i) => {
      const c = controls[i]
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
    if (pressed || performance.now() < trackUntil)
      raf = requestAnimationFrame(tick)
  }
  const kick = () => {
    trackUntil = performance.now() + TRACK_MS
    if (!raf && alive) raf = requestAnimationFrame(tick)
  }

  const destroy = (i: LiquidGlass) => {
    i.destroy()
    // Su destroy no libera el contexto WebGL, y iOS admite pocos a la vez.
    const canvas = i.renderer.canvas
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl")
    gl?.getExtension("WEBGL_lose_context")?.loseContext()
    // destroy también quita estilos en línea de los vidrios: los proxies se vuelven a ubicar. Su
    // position vive en globals.css ([data-lg-proxy]) para que nunca caigan al flujo.
    for (const p of proxies) delete p.dataset.lgKey
    kick()
  }
  const stopInst = () => {
    if (!inst) return
    setActive(false)
    destroy(inst)
    inst = null
  }
  // La escena de la librería arranca en blanco: se pinta con el fondo del tema.
  const patchScene = (i: LiquidGlass) => {
    const ctx = (i as unknown as { _sceneCtx?: CanvasRenderingContext2D })
      ._sceneCtx
    if (!ctx) return
    const fill = ctx.fillRect.bind(ctx)
    ctx.fillRect = (x, y, w, h) => {
      if (ctx.fillStyle === "#ffffff") ctx.fillStyle = bg
      fill(x, y, w, h)
    }
  }
  const removeProxies = () => {
    for (const c of assigned.values()) release(c)
    assigned.clear()
    for (const p of proxies) p.remove()
    proxies.length = 0
  }

  const start = () => {
    if (inst || starting || failed || hung || !alive || !fits()) return
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
      hung = true
      freeSelect(root)
      fail()
    }, INIT_TIMEOUT_MS)
    import("@ybouane/liquidglass")
      .then(({ LiquidGlass }) => {
        // init pone el user-select antes de su primer await: se quita al tiro.
        const ready = LiquidGlass.init({ root, glassElements: all(), defaults: BASE })
        freeSelect(root)
        return ready
      })
      .then(
        (i) => {
          window.clearTimeout(timer)
          starting = false
          // Llegó tarde, se desmontó o el contenido creció mientras arrancaba.
          if (timedOut || !alive || !fits()) return destroy(i)
          inst = i
          patchScene(i)
          setDynamic(pressed)
          setActive(true)
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
    restartTimer = window.setTimeout(function restart() {
      if (!alive || failed) return
      if (starting || navigating())
        return void (restartTimer = window.setTimeout(restart, 100))
      stopInst()
      start()
    }, RESTART_DEBOUNCE_MS)
  }

  // Recaptura lo de atrás: la librería no lo hace si el tamaño no cambia, y si cambia estira la
  // foto vieja (el contenido se vería corrido). `drop` muestra el vidrio CSS, que ve el contenido
  // vivo, hasta que llega la foto nueva. Espera a que termine la entrada de la página.
  const refresh = async () => {
    if (navigating())
      return void (refreshTimer = window.setTimeout(refresh, 100))
    readBg()
    const i = inst
    if (!i) return
    const glass = all()
    await Promise.all(
      [...root.children]
        .filter((child) => !glass.includes(child as HTMLElement))
        .map((child) => i.capture.captureElement(child as HTMLElement, true))
    )
    if (inst !== i || !alive) return
    markNext = true
    kick()
    // Dos frames: el shader ya pintó con la foto nueva cuando el vidrio CSS se va.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => inst === i && setActive(true))
    )
  }
  const scheduleRefresh = (drop: boolean) => {
    if (drop) setActive(false)
    window.clearTimeout(refreshTimer)
    refreshTimer = window.setTimeout(refresh, REFRESH_DEBOUNCE_MS)
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
    scheduleRefresh(false)
  })
  contentObserver.observe(root, {
    childList: true,
    subtree: true,
    characterData: true,
  })
  // Tema (clase de <html>): colores distintos, misma caja. Navegación (data-nav-dir): los
  // proxies que no están fijos se apartan mientras se desliza el contenido.
  const htmlObserver = new MutationObserver((records) => {
    kick()
    if (records.some((r) => r.attributeName === "class")) scheduleRefresh(true)
  })
  htmlObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class", "data-nav-dir"],
  })
  const sizeObserver = new ResizeObserver(() => {
    if (!fits()) stopInst()
    else if (inst) scheduleRefresh(true)
    else start()
    kick()
  })
  sizeObserver.observe(root)

  // Con scroll, lo de atrás se mueve solo bajo los vidrios fijos; los demás se mueven con él.
  const onScroll = () => {
    if (!inst) return
    for (const g of glassEls) inst.markChanged(g)
    for (const p of proxies)
      if (p.hasAttribute("data-lg-pinned")) inst.markChanged(p)
  }
  const onResize = () => {
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
  window.addEventListener("resize", onResize, { passive: true })
  window.addEventListener("scroll", onScroll, { passive: true })
  start()

  return () => {
    alive = false
    cancelAnimationFrame(raf)
    window.clearTimeout(refreshTimer)
    window.clearTimeout(restartTimer)
    contentObserver.disconnect()
    htmlObserver.disconnect()
    sizeObserver.disconnect()
    root.removeEventListener("transitionrun", kick)
    root.removeEventListener("animationstart", kick)
    root.removeEventListener("pointerdown", onDown)
    window.removeEventListener("pointerup", onUp)
    window.removeEventListener("pointercancel", onUp)
    window.removeEventListener("resize", onResize)
    window.removeEventListener("scroll", onScroll)
    stopInst()
    setDynamic(false)
    removeProxies()
    for (const g of glassEls) delete g.dataset.config
    root.style.position = rootPosition
  }
}

const query = (root: ParentNode, selector: string) => [
  ...root.querySelectorAll<HTMLElement>(selector),
]

// Monta la superficie del marco (la barra `navRef` y los controles de las páginas) y vigila las
// hojas que se abren, los menús y popovers, y los sliders que se tocan. Una vez, en el marco.
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
        controls: () =>
          query(root, GLASS_CONTROLS).filter((c) => !nav.contains(c)),
      })
    )

    const mountSheet = (sheet: HTMLElement) => {
      pending.delete(sheet)
      if (
        !sheet.isConnected ||
        sheet.dataset.state !== "open" ||
        mounted.has(sheet)
      )
        return
      mounted.set(
        sheet,
        mountSurface({
          root: sheet,
          controls: () => query(sheet, GLASS_CONTROLS),
        })
      )
    }
    const body = document.body
    let queued = false
    const scan = () => {
      queued = false
      for (const sheet of query(
        document,
        '[data-slot="drawer-content"][data-state="open"]'
      ))
        if (!mounted.has(sheet) && !pending.has(sheet))
          pending.set(
            sheet,
            window.setTimeout(() => mountSheet(sheet), SHEET_DELAY_MS)
          )
      // Menús y popovers: una instancia mientras haya alguno abierto, con lo de atrás capturado
      // al abrir; al cerrarse el último, se destruye.
      const popupsOpen = document.querySelector(POPUPS) !== null
      if (popupsOpen && !mounted.has(body))
        mounted.set(
          body,
          mountSurface({
            root: body,
            controls: () => query(body, POPUPS),
            popup: true,
            positionRoot: false,
          })
        )
      for (const [el, unmount] of mounted) {
        const gone =
          el === body
            ? !popupsOpen
            : el !== root && (!el.isConnected || el.dataset.state === "closed")
        if (gone) {
          unmount()
          mounted.delete(el)
        }
      }
    }
    const bodyObserver = new MutationObserver(() => {
      if (queued) return
      queued = true
      requestAnimationFrame(scan)
    })
    bodyObserver.observe(body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-state"],
    })

    // Slider: su propio root (la pista es lo de atrás), montado con el primer toque.
    const onSliderDown = (e: PointerEvent) => {
      const slider = (e.target as Element | null)?.closest<HTMLElement>(
        '[data-slot="slider"]'
      )
      if (
        !slider ||
        mounted.has(slider) ||
        slider.hasAttribute("data-disabled")
      )
        return
      const thumbs = () => query(slider, '[data-slot="slider-thumb"]')
      // Al soltar se desmonta (contexto WebGL y captura fuera); el próximo toque la vuelve a montar.
      const end = () => {
        window.removeEventListener("pointerup", end)
        window.removeEventListener("pointercancel", end)
        mounted.get(slider)?.()
        mounted.delete(slider)
      }
      window.addEventListener("pointerup", end)
      window.addEventListener("pointercancel", end)
      mounted.set(
        slider,
        mountSurface({
          root: slider,
          controls: thumbs,
          // Como el CSS: en el simple, mientras hay dedo; en el rango, la perilla tomada (foco).
          isOn: (thumb, pressed) =>
            pressed &&
            (thumbs().length === 1 || thumb === document.activeElement),
          dynamic: () => query(slider, '[data-slot="slider-track"]'),
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
      mounted.clear()
    }
  }, [navRef])
}
