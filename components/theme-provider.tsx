"use client"

import * as React from "react"
import { usePathname } from "next/navigation"
import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes"

function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  // La landing es marketing: siempre light, sin importar la preferencia guardada.
  const forcedTheme = usePathname() === "/" ? "light" : undefined

  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem
      disableTransitionOnChange
      forcedTheme={forcedTheme}
      {...props}
    >
      <ThemeColor />
      {!forcedTheme && <ThemeHotkey />}
      {children}
    </NextThemesProvider>
  )
}

// Barra de estado de la PWA en iOS (`theme-color`): sigue el tema de la APP, no solo el del sistema.
// Un solo lugar para todos los que alternan el tema (Ajustes, menú del sidebar, login, la tecla D),
// la landing forzada en claro y la carga inicial con un tema guardado distinto del sistema. Es un
// efecto porque sincroniza el DOM fuera de React; los colores son el --background de cada tema.
function ThemeColor() {
  const { resolvedTheme, forcedTheme } = useTheme()
  const theme = forcedTheme ?? resolvedTheme

  React.useEffect(() => {
    if (!theme) return
    const color = theme === "dark" ? "#000000" : "#f2f2f7"
    // Las dos metas de layout.tsx (una por prefers-color-scheme) pasan a decir el mismo color.
    document
      .querySelectorAll('meta[name="theme-color"]')
      .forEach((meta) => meta.setAttribute("content", color))
  }, [theme])

  return null
}

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  )
}

// La tecla D alterna el tema. Sin `onToggle` (rutas públicas) solo cambia el tema local; dentro de
// la app AppearanceProvider le pasa el suyo, que además lo guarda en la base. Ese escucha en captura
// y marca el evento, así este (en burbuja) lo ignora y el tema no se alterna dos veces.
function ThemeHotkey({ onToggle }: { onToggle?: () => void }) {
  const { resolvedTheme, setTheme } = useTheme()

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.repeat) {
        return
      }

      if (event.metaKey || event.ctrlKey || event.altKey) {
        return
      }

      if (event.key?.toLowerCase() !== "d") {
        return
      }

      if (isTypingTarget(event.target)) {
        return
      }

      if (onToggle) {
        event.preventDefault()
        onToggle()
      } else {
        setTheme(resolvedTheme === "dark" ? "light" : "dark")
      }
    }

    const capture = Boolean(onToggle)
    window.addEventListener("keydown", onKeyDown, capture)

    return () => {
      window.removeEventListener("keydown", onKeyDown, capture)
    }
  }, [resolvedTheme, setTheme, onToggle])

  return null
}

export { ThemeProvider, ThemeHotkey }
