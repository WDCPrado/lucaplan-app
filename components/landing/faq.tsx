import Link from "next/link"
import { ChevronRight } from "lucide-react"
import { cta } from "./landing-data"

const faqs = [
  {
    q: "¿Luca Plan necesita las claves de mi banco?",
    a: "No, nunca. Se conecta a tu correo, no a tu banco: lee los avisos que el banco ya te envía, con un permiso de solo lectura que puedes revocar cuando quieras.",
  },
  {
    q: "¿Qué bancos y correos funcionan?",
    a: "Hoy, Banco de Chile, Banco BICE y MACHBANK (solo débito), con los avisos llegando a un buzón de Outlook. Un mismo correo puede alimentar varios bancos. Gmail viene próximamente.",
  },
  {
    q: "¿Lee todo mi correo?",
    a: "No. Solo se procesan los mensajes de los remitentes oficiales del banco; el resto no se lee ni se guarda. De cada aviso se conserva únicamente el movimiento: monto, comercio y fecha.",
  },
  {
    q: "¿Qué pasa con las suscripciones y las compras en cuotas?",
    a: "Cada una tiene su pantalla. Lo que todavía no se cobra cuenta como comprometido y ya está descontado de lo que puedes gastar. En una compra en cuotas ves la cuota del mes y cuánto falta.",
  },
  {
    q: "¿Los saldos son exactos?",
    a: "Se proyectan desde el último saldo que confirmaste y cada aviso los actualiza. Si algo no generó correo, «Actualizar saldos» los cuadra en un paso, también con una captura de la app de tu banco.",
  },
  {
    q: "¿Puedo desconectarme cuando quiera?",
    a: "Sí. Un clic borra la conexión, los movimientos importados y el token de acceso. Además puedes revocar el permiso desde tu proveedor de correo.",
  },
  {
    q: "¿Puedo instalarlo en mi propio servidor?",
    a: "Sí. Es open source con licencia MIT y el repositorio trae la guía para correrlo con Docker Compose.",
  },
] as const

// Preguntas como lista agrupada de la app: cada fila se despliega con <details> (teclado y lector
// de pantalla nativos). Después, el cierre con los dos caminos: crear la cuenta o entrar.
export function Faq() {
  return (
    <>
      <section
        id="preguntas"
        className="mx-auto grid max-w-6xl scroll-mt-24 gap-10 px-5 py-20 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] lg:gap-16 lg:px-8 lg:py-28"
      >
        <h2
          data-reveal
          className="text-[clamp(2rem,4.5vw,3rem)] leading-[1.05] font-bold tracking-[-0.03em] text-balance"
        >
          Lo que siempre preguntan.
        </h2>
        <div data-reveal className="glass inset-list overflow-hidden rounded-xl">
          {faqs.map(({ q, a }) => (
            <details key={q} className="group">
              <summary className="press flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-body font-medium hover:bg-foreground/5 [&::-webkit-details-marker]:hidden">
                {q}
                <ChevronRight
                  aria-hidden
                  className="disclosure shrink-0 transition-transform duration-200 group-open:rotate-90 motion-reduce:transition-none"
                />
              </summary>
              <p className="px-4 pb-4 text-subheadline text-pretty text-muted-foreground">
                {a}
              </p>
            </details>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 pb-20 lg:px-8 lg:pb-28">
        <div
          data-reveal
          className="flex flex-col items-start gap-6 rounded-xl bg-card p-6 sm:p-10 lg:flex-row lg:items-center lg:justify-between"
        >
          <h2 className="max-w-xl text-[clamp(1.75rem,3.5vw,2.5rem)] leading-[1.1] font-bold tracking-[-0.03em] text-balance">
            Un plan más claro para el mes que viene.
          </h2>
          <div className="flex flex-wrap gap-3">
            <Link
              href={cta.create.href}
              className="press flex min-h-12 items-center rounded-full bg-primary px-6 text-body font-semibold text-primary-foreground hover:bg-primary/90"
            >
              {cta.create.label}
            </Link>
            <Link
              href={cta.enter.href}
              className="press flex min-h-12 items-center rounded-full bg-(--glass-control) px-6 text-body font-medium hover:bg-foreground/10"
            >
              {cta.enter.label}
            </Link>
          </div>
        </div>
      </section>
    </>
  )
}
