import { Geist, Geist_Mono, Space_Grotesk } from "next/font/google"
import type { Metadata, Viewport } from "next"

import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { ServiceWorkerRegistration } from "@/components/pwa/service-worker-registration"
import { PwaRefresh } from "@/components/pwa/pwa-refresh"
import { Toaster } from "@/components/ui/sonner"
import { cn } from "@/lib/utils"

// Tipografía: Geist (UI, legible y moderna) + Space Grotesk (headings, identidad
// fintech) + Geist Mono (cifras tabulares). Ver docs/design/design-system.md.
const fontSans = Geist({
  subsets: ["latin"],
  variable: "--font-sans",
})

const fontHeading = Space_Grotesk({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-heading",
})

const fontMono = Geist_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
})

export const metadata: Metadata = {
  metadataBase: new URL(process.env.BETTER_AUTH_URL ?? "http://localhost:3000"),
  title: "Luca Plan | Presupuestos mensuales",
  description:
    "Planifica cada mes con presupuestos claros, pagos recurrentes y conexión bancaria por correo.",
  openGraph: {
    title: "Luca Plan | Presupuestos mensuales",
    description: "Tu plan, mes a mes.",
    images: ["/og-lucaplan.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Luca Plan | Presupuestos mensuales",
    description: "Tu plan, mes a mes.",
    images: ["/og-lucaplan.png"],
  },
  // PWA: iconos de instalación + comportamiento como web app en iOS (Agregar a inicio).
  icons: {
    icon: [{ url: "/icons/icon-32.png", sizes: "32x32", type: "image/png" }],
    apple: [
      {
        url: "/icons/apple-touch-icon.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  },
  appleWebApp: {
    capable: true,
    title: "Luca Plan",
    // "default" y no "black-translucent": translúcida, la página queda bajo la barra de estado e
    // iOS 26 difumina esa zona (y los botones del header) sin forma de apagarlo desde la web.
    statusBarStyle: "default",
  },
}

// viewport-fit=cover extiende el lienzo bajo notch/home indicator (las safe areas se compensan
// solo en modo standalone; ver globals.css). theme-color sigue el tema del sistema.
// El teclado se superpone: conserva el viewport y el tamaño de los modales donde el navegador
// admite interactive-widget. ResponsiveModal también desactiva el reposicionamiento de Vaul.
export const viewport: Viewport = {
  viewportFit: "cover",
  interactiveWidget: "overlays-content",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f9fafc" },
    { media: "(prefers-color-scheme: dark)", color: "#0f141d" },
  ],
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="es"
      suppressHydrationWarning
      // globals.css pone scroll-behavior: smooth; este atributo deja que Next lo
      // suspenda durante transiciones de ruta (evita el scroll animado al navegar).
      data-scroll-behavior="smooth"
      className={cn(
        "font-sans antialiased",
        fontSans.variable,
        fontHeading.variable,
        fontMono.variable
      )}
    >
      <body>
        {/* Señal de que no estás en prod: pestañita verde flotando sobre el navbar.
            Server component: en producción ni se renderiza. */}
        {process.env.NODE_ENV !== "production" && (
          <div
            aria-hidden
            className="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center pt-[env(safe-area-inset-top)]"
          >
            <span className="animate-pulse rounded-b-md bg-emerald-500 px-2 pb-0.5 text-[10px] font-bold tracking-widest text-white uppercase shadow-[0_0_10px_2px_rgb(52_211_153/0.9)]">
              local
            </span>
          </div>
        )}
        <ThemeProvider>
          {/* El atributo queda inerte a propósito: ningún drawer usa ya `shouldScaleBackground`
              (rompía la barra de navegación fija, ver responsive-modal.tsx). Está por si se vuelve
              a activar el efecto iOS; el `min-h-dvh` sí hace falta. */}
          <div data-vaul-drawer-wrapper className="min-h-dvh">
            {children}
          </div>
          <Toaster  richColors={true} position="bottom-center"/>
          <ServiceWorkerRegistration />
          <PwaRefresh />
        </ThemeProvider>
      </body>
    </html>
  )
}
