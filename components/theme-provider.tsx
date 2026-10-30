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

function ThemeHotkey() {
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

      setTheme(resolvedTheme === "dark" ? "light" : "dark")
    }

    window.addEventListener("keydown", onKeyDown)

    return () => {
      window.removeEventListener("keydown", onKeyDown)
    }
  }, [resolvedTheme, setTheme])

  return null
}

export { ThemeProvider }
