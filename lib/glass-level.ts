// Nivel del Liquid Glass (Ajustes → Apariencia): 0 = más transparente … 2 = el de siempre … 4 = teñido.
// Es de este dispositivo: vive en localStorage y se aplica como `data-glass` en <html>, que en
// globals.css mueve `--glass-clear`/`--glass-tint`. En el nivel por defecto el atributo no va.
export const GLASS_MAX = 4
export const GLASS_DEFAULT = 2
const KEY = "glass-level"

// Corre en <head> antes del primer pintado (como el script de next-themes), así no parpadea.
export const GLASS_SCRIPT = `try{var g=localStorage.getItem("${KEY}");if(/^[0-${GLASS_MAX}]$/.test(g)&&g!=="${GLASS_DEFAULT}")document.documentElement.dataset.glass=g}catch(e){}`

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
  try {
    localStorage.setItem(KEY, String(level))
  } catch {
    // Sin almacenamiento (modo privado, bloqueado): vale para esta visita.
  }
  listeners.forEach((l) => l())
}
