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
    statusBarStyle: "black-translucent",
  },
}

// viewport-fit=cover extiende el lienzo bajo notch/home indicator (las safe areas se compensan
// solo en modo standalone; ver globals.css). theme-color sigue el tema del sistema.
// interactiveWidget=resizes-content: al abrir el teclado, el layout (y las unidades dvh) se
// encoge al alto visible, así el drawer/modal se dimensiona sobre el teclado y el input no queda
// tapado ni salta. Es el mecanismo estándar del navegador (Chrome/Android); en iOS Safari lo
// cubre vaul reposicionando el input (repositionInputs).
export const viewport: Viewport = {
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
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
      data-env={process.env.NODE_ENV === "production" ? undefined : "dev"}
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
        <ThemeProvider>
          {/* data-vaul-drawer-wrapper: vaul escala este contenedor (efecto iOS) al abrir un drawer */}
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
