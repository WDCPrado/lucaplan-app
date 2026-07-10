import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google"
import type { Metadata } from "next"

import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { cn } from "@/lib/utils"

const fontSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-sans",
})

const fontMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
})

export const metadata: Metadata = {
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
        fontMono.variable
      )}
    >
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  )
}
