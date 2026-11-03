// Nivel del Liquid Glass (Ajustes → Apariencia): 0 = más transparente … 2 = el de siempre … 4 = teñido.
// Es del usuario (en la base, ver lib/appearance.ts) y se aplica como `data-glass` en <html>, que en
// globals.css mueve el token oficial `--lg-glass`. En el nivel por defecto el atributo no va.
// Este módulo es solo el DOM y sus suscriptores; guardar lo hace AppearanceProvider.
export const GLASS_MAX = 4
export const GLASS_DEFAULT = 2

const listeners = new Set<() => void>()

export function subscribeGlass(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getGlass() {
  return Number(document.documentElement.dataset.glass ?? GLASS_DEFAULT)
}

export function setGlass(level: number) {
  const root = document.documentElement
  if (level !== GLASS_DEFAULT) root.dataset.glass = String(level)
  else delete root.dataset.glass
  listeners.forEach((l) => l())
}
