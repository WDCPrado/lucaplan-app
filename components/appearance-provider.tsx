"use client"

import * as React from "react"
import { useTheme } from "next-themes"
import { toast } from "sonner"

import { ThemeHotkey } from "@/components/theme-provider"
import { legacyPatch, markMigrated } from "@/lib/appearance"
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

export function useAppearance() {
  const ctx = React.useContext(AppearanceContext)
  if (!ctx) throw new Error("useAppearance va dentro de AppearanceProvider")
  return ctx
}

// Preferencias de apariencia del usuario dentro de app/(app). `initial` viene de la base (layout);
// cada cambio se aplica al instante y se guarda con PATCH; si falla, vuelve a lo último guardado.
export function AppearanceProvider({
  initial,
  children,
}: {
  initial: UserSettings
  children: React.ReactNode
}) {
  const { resolvedTheme, setTheme } = useTheme()
  // Lo último que la base confirmó: a eso se vuelve si un PATCH falla.
  const saved = React.useRef(initial)
  // Solo el último PATCH revierte: si uno viejo falla después de que otro más nuevo salió, la
  // pantalla ya muestra lo nuevo.
  const seq = React.useRef(0)

  const apply = React.useCallback(
    (s: Partial<UserSettings>) => {
      if (s.theme) setTheme(s.theme)
      if (s.glassLevel !== undefined) setGlass(s.glassLevel)
    },
    [setTheme]
  )

  const save = React.useCallback(
    async (patch: UserSettingsPatch) => {
      const n = ++seq.current
      let message: string | undefined
      try {
        const res = await fetch("/api/user-settings", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        })
        const body = await res.json().catch(() => null)
        if (!res.ok) {
          // Solo el 422 trae un mensaje para la persona (el de zod); el resto, el genérico.
          if (res.status === 422) message = body?.error
          throw new Error(String(res.status))
        }
        saved.current = userSettingsSchema.parse(body)
        return true
      } catch {
        if (n === seq.current) {
          const revert: Partial<UserSettings> = {}
          if (patch.theme) revert.theme = saved.current.theme
          if (patch.glassLevel !== undefined)
            revert.glassLevel = saved.current.glassLevel
          apply(revert)
        }
        // 401, 422, 5xx o red caída: todo revierte igual.
        toast.error(message ?? "No se pudo guardar la apariencia.")
        return false
      }
    },
    [apply]
  )

  // Solo una vez por montaje: setTheme de next-themes cambia de identidad con cada tema, así que el
  // efecto se volvería a disparar (y en StrictMode corre dos veces).
  const started = React.useRef(false)

  // Al montar: aplica lo de la base (en una navegación desde /login el script del layout no corre)
  // y, una sola vez por dispositivo, sube lo que había en localStorage (ver legacyPatch).
  React.useEffect(() => {
    if (started.current) return
    started.current = true
    const server = saved.current
    const patch = legacyPatch(server)
    apply({ ...server, ...patch })
    if (!patch) return markMigrated()
    void save(patch).then((ok) => ok && markMigrated())
  }, [apply, save])

  const value = React.useMemo<Appearance>(
    () => ({
      toggleTheme: () => {
        const next = resolvedTheme === "dark" ? "light" : "dark"
        setTheme(next)
        void save({ theme: next })
      },
      saveGlass: (level) => {
        if (level === saved.current.glassLevel) return
        void save({ glassLevel: level })
      },
    }),
    [resolvedTheme, setTheme, save]
  )

  return (
    <AppearanceContext.Provider value={value}>
      {/* La tecla D, guardando. Escucha en captura y marca el evento, así la de ThemeProvider
          (la de las rutas públicas, solo local) lo ignora. */}
      <ThemeHotkey onToggle={value.toggleTheme} />
      {children}
    </AppearanceContext.Provider>
  )
}
