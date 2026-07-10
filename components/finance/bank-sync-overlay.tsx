"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Landmark, Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const STEPS = [
  { label: "Vinculando con Fintoc", desc: "Conexión segura establecida" },
  { label: "Trayendo tus cuentas", desc: "Saldos, tarjetas y cupos" },
  { label: "Importando movimientos", desc: "Descargando tu historial" },
  { label: "Categorizando con IA", desc: "Ordenando tus gastos por categoría" },
];

// Overlay full-screen mientras se sincroniza un banco recién conectado. Bloquea la app. Los pasos
// avanzan por tiempo (la sync real corre en el webhook); al terminar (`finished`) se marca todo
// listo. Se monta solo cuando hay conexión en curso (el padre lo renderiza condicional).
export function BankSyncOverlay({ finished }: { finished: boolean }) {
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (finished) return;
    const id = setInterval(() => setActive((s) => Math.min(s + 1, STEPS.length - 1)), 1900);
    return () => clearInterval(id);
  }, [finished]);

  const progress = finished ? 100 : ((active + 1) / STEPS.length) * 100;

  // Portal a document.body: el overlay `fixed` debe cubrir el viewport, pero se monta dentro del
  // carrusel de cuentas (overflow-x-auto + mask), que lo confinaría/recortaría. El portal lo saca.
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      role="alertdialog"
      aria-busy={!finished}
      aria-label="Conectando tu banco"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-background/70 p-4 backdrop-blur-md"
    >
      <div className="glass-strong w-full max-w-md rounded-3xl border border-border/60 p-8 shadow-2xl">
        <div className="mx-auto mb-6 grid size-20 place-items-center">
          <div className="relative grid size-20 place-items-center">
            {!finished && (
              <span className="absolute inset-0 animate-spin rounded-full border-2 border-primary/20 border-t-primary [animation-duration:1.1s]" />
            )}
            <div
              className={cn(
                "grid size-14 place-items-center rounded-2xl transition-colors duration-500",
                finished ? "bg-success/15 text-success" : "bg-primary/10 text-primary",
              )}
            >
              {finished ? <Check className="size-7" /> : <Landmark className="size-7" />}
            </div>
          </div>
        </div>

        <h2 className="text-center font-heading text-xl font-bold">
          {finished ? "¡Banco conectado!" : "Conectando tu banco"}
        </h2>
        <p className="mt-1 mb-6 text-center text-sm text-muted-foreground">
          {finished ? "Tus cuentas y movimientos ya están aquí" : "Esto puede tardar unos segundos, no cierres la ventana"}
        </p>

        <ul className="flex flex-col gap-2.5">
          {STEPS.map((step, i) => {
            const done = finished || i < active;
            const current = !finished && i === active;
            return (
              <li
                key={step.label}
                className={cn(
                  "flex items-center gap-3 rounded-2xl border p-3 transition-all duration-300",
                  current ? "border-primary/40 bg-primary/5" : done ? "border-transparent bg-secondary/50" : "border-transparent opacity-45",
                )}
              >
                <span
                  className={cn(
                    "grid size-8 shrink-0 place-items-center rounded-full transition-colors duration-300",
                    done ? "bg-success/15 text-success" : current ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
                  )}
                >
                  {done ? <Check className="size-4" /> : current ? <Loader2 className="size-4 animate-spin" /> : <span className="size-1.5 rounded-full bg-current" />}
                </span>
                <div className="min-w-0">
                  <div className="text-sm font-medium">{step.label}</div>
                  <div className="truncate text-xs text-muted-foreground">{step.desc}</div>
                </div>
              </li>
            );
          })}
        </ul>

        <div className="mt-6 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
          <div className="h-full rounded-full bg-primary transition-all duration-700 ease-out" style={{ width: `${progress}%` }} />
        </div>
      </div>
    </div>,
    document.body,
  );
}
