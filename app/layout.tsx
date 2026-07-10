import { Geist, Geist_Mono, Space_Grotesk } from "next/font/google"
import type { Metadata } from "next"

import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
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
  title: "LucaPlan | Presupuestos mensuales",
  description:
    "Planifica cada mes con presupuestos claros, pagos recurrentes y conexión bancaria con Fintoc.",
  openGraph: {
    title: "LucaPlan | Presupuestos mensuales",
    description: "Tu plan, mes a mes.",
    images: ["/og-lucaplan.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "LucaPlan | Presupuestos mensuales",
    description: "Tu plan, mes a mes.",
    images: ["/og-lucaplan.png"],
  },
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
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  )
}
