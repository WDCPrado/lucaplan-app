import * as React from "react"

const MOBILE_BREAKPOINT = 768

// Media query como external store (evita setState-en-effect): SSR → desktop (false),
// en cliente refleja el ancho real y se re-suscribe a los cambios.
export function useIsMobile() {
  const subscribe = React.useCallback((onChange: () => void) => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    mql.addEventListener("change", onChange)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return React.useSyncExternalStore(
    subscribe,
    () => window.innerWidth < MOBILE_BREAKPOINT,
    () => false
  )
}
