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

// Migración única desde localStorage. Criterio: solo si el usuario nunca guardó nada en la base
// (`stored`: no tiene filas; guardar los defaults sí cuenta como elección) y este dispositivo no
// migró aún; sube lo local que difiera de la base. Devuelve el patch a subir, o null si no hay nada.
export function legacyPatch(
  server: UserSettings,
  stored: boolean
): UserSettingsPatch | null {
  try {
    if (stored || localStorage.getItem(MIGRATED)) return null
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
export function appearanceScript(server: UserSettings, stored: boolean) {
  // Va dentro de <script>: sin «<» (no puede cerrar la etiqueta) ni U+2028/2029.
  const s = JSON.stringify(server)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029")
  return `(function(s){var t=s.theme,g=s.glassLevel,r=document.documentElement;try{var l=localStorage;if(${!stored}&&!l.getItem("${MIGRATED}")){var lt=l.getItem("${THEME}"),lg=l.getItem("${LEGACY_GLASS}");if(lt==="light"||lt==="dark"||lt==="system")t=lt;if(/^[0-4]$/.test(lg))g=+lg}l.setItem("${THEME}",t)}catch(e){}var m=t==="system"?(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"):t;r.classList.remove("light","dark");r.classList.add(m);r.dataset.theme=m;r.style.colorScheme=m;if(g!==${USER_SETTINGS_DEFAULTS.glassLevel})r.dataset.glass=String(g);else delete r.dataset.glass})(${s})`
}

// Guardado optimista: la pantalla cambia al instante y cada PATCH puede fallar o llegar en
// desorden. Por campo se lleva lo último que la base confirmó (`saved`), lo último que se pidió
// (`requested`, contra eso se compara para no mandar repetidos) y un contador: un PATCH que falla
// solo revierte los campos de los que sigue siendo el último pedido.
type Field = keyof UserSettings
export type SaveTracker = {
  saved: UserSettings
  requested: UserSettings
  seq: Record<Field, number>
  confirmedSeq: Record<Field, number>
  failedSeq: Record<Field, number>
}
export type SaveTicket = Partial<Record<Field, number>>

export function createSaveTracker(initial: UserSettings): SaveTracker {
  return {
    saved: { ...initial },
    requested: { ...initial },
    seq: { glassLevel: 0, theme: 0 },
    confirmedSeq: { glassLevel: 0, theme: 0 },
    failedSeq: { glassLevel: 0, theme: 0 },
  }
}

const fieldsOf = (patch: UserSettingsPatch | SaveTicket) =>
  (Object.keys(patch) as Field[]).filter((f) => patch[f] !== undefined)

export function beginSave(
  t: SaveTracker,
  patch: UserSettingsPatch
): { tracker: SaveTracker; ticket: SaveTicket } {
  const tracker = {
    ...t,
    requested: { ...t.requested, ...patch },
    seq: { ...t.seq },
  }
  const ticket: SaveTicket = {}
  for (const f of fieldsOf(patch)) ticket[f] = ++tracker.seq[f]
  return { tracker, ticket }
}

// `confirmed`: el estado completo que devolvió la base, o null si el PATCH falló. Devuelve el
// tracker nuevo y lo que hay que volver a pintar (vacío si nada).
export function endSave(
  t: SaveTracker,
  ticket: SaveTicket,
  confirmed: UserSettings | null
): { tracker: SaveTracker; revert: Partial<UserSettings> } {
  const tracker = {
    ...t,
    saved: { ...t.saved },
    requested: { ...t.requested },
    confirmedSeq: { ...t.confirmedSeq },
    failedSeq: { ...t.failedSeq },
  }
  const revert: Partial<UserSettings> = {}
  for (const f of fieldsOf(ticket)) {
    const n = ticket[f]!
    if (confirmed) {
      // Una respuesta vieja que llega después de una más nueva no pisa lo confirmado.
      if (n > tracker.confirmedSeq[f]) {
        Object.assign(tracker.saved, { [f]: confirmed[f] })
        tracker.confirmedSeq[f] = n
        // El último pedido ya falló y se revirtió a un `saved` viejo: lo que quedó en la base es
        // esto, así que la pantalla y `requested` lo siguen.
        if (tracker.failedSeq[f] === tracker.seq[f]) {
          Object.assign(revert, { [f]: confirmed[f] })
          Object.assign(tracker.requested, { [f]: confirmed[f] })
        }
      }
    } else if (n === tracker.seq[f]) {
      tracker.failedSeq[f] = n
      Object.assign(revert, { [f]: tracker.saved[f] })
      Object.assign(tracker.requested, { [f]: tracker.saved[f] })
    }
  }
  return { tracker, revert }
}
