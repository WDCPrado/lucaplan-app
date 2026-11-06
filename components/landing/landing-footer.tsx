"use client"

import Link from "next/link"
import { useState } from "react"
import { ResponsiveModal } from "@/components/ui/responsive-modal"
import { ScrollArea } from "@/components/ui/scroll-area"
import { LEGAL, type LegalKey } from "./legal-content"
import { GitHubIcon, LinkedInIcon } from "./brand-icons"
import { LogoMark } from "./landing-nav"
import { cta, GITHUB_URL, LINKEDIN_URL } from "./landing-data"

const product = [
  ["#empieza", "Cómo empiezas"],
  ["#plan", "El plan del mes"],
  ["#tarjetas", "Cuentas y tarjetas"],
  ["#ia", "Categorización con IA"],
  ["#conecta", "Conexión por correo"],
  ["#open-source", "Open source"],
  ["#preguntas", "Preguntas frecuentes"],
] as const

const linkClass =
  "inline-flex min-h-11 items-center transition-colors duration-150 hover:text-foreground"

export function LandingFooter() {
  const [legal, setLegal] = useState<LegalKey | null>(null)
  return (
    <footer className="border-t border-border">
      <div className="mx-auto max-w-6xl px-5 py-14 lg:px-8">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div className="max-w-xs">
            <p className="flex items-center gap-2.5 text-headline font-semibold">
              <LogoMark />
              Luca Plan
            </p>
            <p className="mt-4 text-subheadline text-muted-foreground">
              Finanzas personales, un mes a la vez. Hecho en Chile, con licencia
              MIT.
            </p>
          </div>

          <nav aria-label="Producto" className="text-subheadline">
            <p className="font-semibold">Producto</p>
            <ul className="mt-3 text-muted-foreground">
              {product.map(([href, label]) => (
                <li key={href}>
                  <a href={href} className={linkClass}>
                    {label}
                  </a>
                </li>
              ))}
              <li>
                <Link href={cta.enter.href} className={linkClass}>
                  {cta.enter.label}
                </Link>
              </li>
            </ul>
          </nav>

          <nav aria-label="Legal" className="text-subheadline">
            <p className="font-semibold">Legal</p>
            <ul className="mt-3 text-muted-foreground">
              <li>
                <button
                  type="button"
                  onClick={() => setLegal("terminos")}
                  className={linkClass}
                >
                  Términos y Condiciones
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => setLegal("privacidad")}
                  className={linkClass}
                >
                  Política de Privacidad
                </button>
              </li>
            </ul>
          </nav>

          <div className="text-subheadline">
            <p className="font-semibold">Seguridad</p>
            <p className="mt-3 max-w-xs text-muted-foreground">
              Luca Plan nunca conoce tus claves bancarias: lee solo los avisos
              de tu correo con permiso de solo lectura, revocable, y no puede
              mover tu dinero.
            </p>
          </div>
        </div>

        <p className="mt-12 max-w-2xl text-footnote text-muted-foreground">
          Luca Plan es un servicio independiente. No está afiliado, patrocinado
          ni respaldado por las instituciones financieras ni los proveedores de
          correo mencionados; todas las marcas pertenecen a sus respectivos
          titulares.
        </p>

        <div className="mt-6 flex flex-col gap-3 border-t border-border pt-6 text-footnote text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>
            © 2026 Luca Plan. Open source, hecho por{" "}
            <a
              href={LINKEDIN_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 transition-colors hover:text-foreground"
            >
              Welliton da Costa Prado
            </a>
            .
          </p>
          <div className="flex items-center gap-4">
            <p>
              Privacidad conforme a la Ley 19.628 y preparada para la Ley
              21.719 (Chile).
            </p>
            <div className="flex items-center">
              <a
                href={GITHUB_URL}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Luca Plan en GitHub"
                className="grid size-11 place-items-center rounded-full transition-colors hover:bg-foreground/5 hover:text-foreground"
              >
                <GitHubIcon />
              </a>
              <a
                href={LINKEDIN_URL}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Welliton da Costa Prado en LinkedIn"
                className="grid size-11 place-items-center rounded-full transition-colors hover:bg-foreground/5 hover:text-foreground"
              >
                <LinkedInIcon />
              </a>
            </div>
          </div>
        </div>
      </div>

      {legal && (
        <ResponsiveModal
          open
          onOpenChange={(o) => !o && setLegal(null)}
          title={LEGAL[legal].title}
        >
          <ScrollArea className="max-h-[62dvh] px-6">
            <div className="pb-8">{LEGAL[legal].body}</div>
          </ScrollArea>
        </ResponsiveModal>
      )}
    </footer>
  )
}
