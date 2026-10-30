"use client"

import * as React from "react"
import { useTheme } from "next-themes"
import { toast } from "sonner"

import { ThemeHotkey, useOwnThemeHotkey } from "@/components/theme-provider"
import {
  beginSave,
  createSaveTracker,
  endSave,
  legacyPatch,
  markMigrated,
} from "@/lib/appearance"
import { setGlass } from "@/lib/glass-level"
import {
  userSettingsSchema,
  type UserSettings,
  type UserSettingsPatch,
} from "@/lib/schemas/user-settings"

type Appearance = {
  toggleTheme: () => void
  // Al soltar el slider: el nivel ya se ve (setGlass al arrastrar); esto lo guarda.
  saveGlass: (level: number) => void
}

const AppearanceContext = React.createContext<Appearance | null>(null)

// Fuera de AppearanceProvider (p. ej. las vistas de /design) alterna el tema solo en local, sin
// guardar.
export function useAppearance(): Appearance {
  const ctx = React.useContext(AppearanceContext)
  const { resolvedTheme, setTheme } = useTheme()
  return (
    ctx ?? {
      toggleTheme: () => setTheme(resolvedTheme === "dark" ? "light" : "dark"),
      saveGlass: () => {},
    }
  )
}

// Preferencias de apariencia del usuario dentro de app/(app). `initial` viene de la base (layout);
// cada cambio se aplica al instante y se guarda con PATCH; si falla, vuelve a lo último guardado
// (la lógica de qué revertir vive en lib/appearance.ts: beginSave/endSave).
export function AppearanceProvider({
  initial,
  stored,
  children,
}: {
  initial: UserSettings
  // Si el usuario guardó algo alguna vez: sin eso se migra lo que el dispositivo tenía.
  stored: boolean
  children: React.ReactNode
}) {
  const { resolvedTheme, setTheme } = useTheme()
  const tracker = React.useRef(createSaveTracker(initial))
  useOwnThemeHotkey()

  const apply = React.useCallback(
    (s: Partial<UserSettings>) => {
      if (s.theme) setTheme(s.theme)
      if (s.glassLevel !== undefined) setGlass(s.glassLevel)
    },
    [setTheme]
  )

  const save = React.useCallback(
    async (patch: UserSettingsPatch) => {
      const begun = beginSave(tracker.current, patch)
      tracker.current = begun.tracker
      let confirmed: UserSettings | null = null
      let message: string | undefined
      try {
        const res = await fetch("/api/user-settings", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        })
        const body = await res.json().catch(() => null)
        // Solo el 422 trae un mensaje para la persona (el de zod); el resto, el genérico.
        if (res.ok) confirmed = userSettingsSchema.parse(body)
        else if (res.status === 422) message = body?.error
      } catch {
        // Red caída o respuesta ilegible: cuenta como fallo.
      }
      const ended = endSave(tracker.current, begun.ticket, confirmed)
      tracker.current = ended.tracker
      if (confirmed) return true
      apply(ended.revert)
      toast.error(message ?? "No se pudo guardar la apariencia.")
      return false
    },
    [apply]
  )

  // Solo una vez por montaje: setTheme de next-themes cambia de identidad con cada tema, así que el
  // efecto se volvería a disparar (y en StrictMode corre dos veces).
  const started = React.useRef(false)

  // Al montar y antes de pintar: aplica lo de la base (si se llegó por navegación del cliente, el
  // script del layout no corrió) y, una sola vez por dispositivo, sube lo que había en localStorage
  // (ver legacyPatch).
  React.useLayoutEffect(() => {
    if (started.current) return
    started.current = true
    const server = tracker.current.saved
    const patch = legacyPatch(server, stored)
    apply({ ...server, ...patch })
    if (!patch) return markMigrated()
    void save(patch).then((ok) => ok && markMigrated())
  }, [apply, save, stored])

  const value = React.useMemo<Appearance>(
    () => ({
      toggleTheme: () => {
        const next = resolvedTheme === "dark" ? "light" : "dark"
        setTheme(next)
        void save({ theme: next })
      },
      saveGlass: (level) => {
        // Contra lo último pedido, no lo confirmado: 2→4→2 rápido tiene que mandar el último 2.
        if (level === tracker.current.requested.glassLevel) return
        void save({ glassLevel: level })
      },
    }),
    [resolvedTheme, setTheme, save]
  )

  return (
    <AppearanceContext.Provider value={value}>
      {/* La tecla D dentro de la app: guarda. La de ThemeProvider se apaga mientras esta vive. */}
      <ThemeHotkey onToggle={value.toggleTheme} />
      {children}
    </AppearanceContext.Provider>
  )
}
