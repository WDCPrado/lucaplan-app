import type { MetadataRoute } from "next"

// Web App Manifest (App Router lo sirve en /manifest.webmanifest). Identidad instalable de
// Luca Plan: arranca en /dashboard en ventana propia (standalone). Los colores calzan con el
// tema oscuro por defecto (fondo raíz) para que el splash/cold start no parpadee.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    scope: "/",
    name: "Luca Plan",
    short_name: "Luca Plan",
    description:
      "Planifica cada mes con presupuestos claros y tus movimientos bancarios en un solo lugar.",
    start_url: "/dashboard",
    display: "standalone",
    orientation: "natural",
    lang: "es-CL",
    background_color: "#000000",
    theme_color: "#000000",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  }
}
