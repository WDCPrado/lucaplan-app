import {
  USER_SETTINGS_DEFAULTS,
  type UserSettings,
  type UserSettingsPatch,
} from "./schemas/user-settings.ts"

// Apariencia por usuario (tema y nivel del vidrio): la fuente es la base (`user_setting`); el
// layout de app/(app) la lee en el servidor y este módulo la lleva al <html> antes del primer
// pintado. `theme` en localStorage queda solo como el almacén de next-themes (el script lo pisa
// con el valor de la base en cada carga); `glass-level` es la clave vieja, por dispositivo.

const LEGACY_GLASS = "glass-level"
const THEME = "theme" // storageKey por defecto de next-themes
// Marca de este dispositivo: sus valores viejos ya se subieron (o no había nada que subir). Sin
// ella, la clave `theme` que next-themes reescribe se confundiría con un valor viejo cada vez que
// el usuario vuelve a los defaults en otro dispositivo.
const MIGRATED = "appearance-migrated"

export function isDefaultSettings(s: UserSettings) {
  return (
    s.glassLevel === USER_SETTINGS_DEFAULTS.glassLevel &&
    s.theme === USER_SETTINGS_DEFAULTS.theme
  )
}

// Migración única desde localStorage. Criterio: solo si este dispositivo no migró aún y la base
// está en los defaults (= el usuario nunca guardó nada); sube lo local que difiera de la base.
// Devuelve el patch a subir, o null si no hay nada.
export function legacyPatch(server: UserSettings): UserSettingsPatch | null {
  try {
    if (!isDefaultSettings(server) || localStorage.getItem(MIGRATED))
      return null
    const patch: UserSettingsPatch = {}
    const theme = localStorage.getItem(THEME)
    if (
      (theme === "light" || theme === "dark" || theme === "system") &&
      theme !== server.theme
    )
      patch.theme = theme
    const glass = localStorage.getItem(LEGACY_GLASS)
    if (glass && /^[0-4]$/.test(glass) && Number(glass) !== server.glassLevel)
      patch.glassLevel = Number(glass)
    return Object.keys(patch).length ? patch : null
  } catch {
    return null // sin almacenamiento: no hay nada que migrar
  }
}

// La clave vieja del vidrio se borra; `theme` no, porque es el almacén vivo de next-themes.
export function markMigrated() {
  try {
    localStorage.setItem(MIGRATED, "1")
    localStorage.removeItem(LEGACY_GLASS)
  } catch {
    // Sin almacenamiento: no hay clave vieja que borrar.
  }
}

// Script en línea que corre al parsear el HTML, antes de pintar el contenido de la app. Aplica la
// misma lógica que `legacyPatch` (en la carga que migra se ve el valor local, sin salto) y deja el
// tema en localStorage para que next-themes hidrate con el valor de la base.
export function appearanceScript(server: UserSettings) {
  const s = JSON.stringify(server)
  return `(function(s){var t=s.theme,g=s.glassLevel,r=document.documentElement;try{var l=localStorage;if(${isDefaultSettings(server)}&&!l.getItem("${MIGRATED}")){var lt=l.getItem("${THEME}"),lg=l.getItem("${LEGACY_GLASS}");if(lt==="light"||lt==="dark"||lt==="system")t=lt;if(/^[0-4]$/.test(lg))g=+lg}l.setItem("${THEME}",t)}catch(e){}var m=t==="system"?(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"):t;r.classList.remove("light","dark");r.classList.add(m);r.style.colorScheme=m;if(g!==${USER_SETTINGS_DEFAULTS.glassLevel})r.dataset.glass=String(g);else delete r.dataset.glass})(${s})`
}
