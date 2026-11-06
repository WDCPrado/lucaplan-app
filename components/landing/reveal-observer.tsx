"use client"

import { useEffect } from "react"

// Revela al entrar en pantalla todo lo marcado con [data-reveal] (globals.css: `.is-visible`).
// Sin movimiento reducido el CSS ya lo deja visible y quieto. Se monta una vez en la landing.
export function RevealObserver() {
  // ponytail: useEffect legítimo, sincroniza con IntersectionObserver del DOM
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          entry.target.classList.add("is-visible")
          io.unobserve(entry.target)
        }
      },
      { threshold: 0.2, rootMargin: "0px 0px -8% 0px" }
    )
    document.querySelectorAll("[data-reveal]").forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [])
  return null
}
