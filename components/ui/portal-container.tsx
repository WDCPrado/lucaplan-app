"use client"

import { createContext, useContext } from "react"

// Los portales permanecen fuera de la fuente filtrada, pero dentro de la escena
// para que Glisse encuentre el contenido de fondo sin cambiar su motor.
export const PortalContainerContext = createContext<HTMLElement | null>(null)

export function usePortalContainer() {
  return useContext(PortalContainerContext)
}
