"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Landmark, Copy, Check, RefreshCw, Download } from "lucide-react";
import { toast } from "sonner";
import { ResponsiveModal } from "@/components/ui/responsive-modal";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Bancos conectables. Por ahora solo Banco de Chile; el resto queda "próximamente".
const BANKS: { id: string; name: string; available: boolean }[] = [
  { id: "bancochile", name: "Banco de Chile", available: true },
];

// Tile "Conectar banco" → modal responsive. La sincronización NO abre un navegador desde el servidor
// (eso lo marca el anti-bot): corre en TU navegador con un userscript que lee tu sesión real y postea
// a la app local. El modal entrega el token y los pasos; "Actualizar" recarga tras sincronizar.
export function SyncBancoChileButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState("bancochile");
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function openModal() {
    setOpen(true);
    if (token) return;
    try {
      const res = await fetch("/api/bancochile/token");
      const data = await res.json();
      if (res.ok && data.token) setToken(data.token as string);
    } catch {
      /* se muestra placeholder */
    }
  }

  async function copyToken() {
    if (!token) return;
    await navigator.clipboard.writeText(token);
    setCopied(true);
    toast.success("Token copiado");
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <>
      <button
        onClick={openModal}
        data-card
        className="flex min-h-40 w-72 shrink-0 snap-center snap-always flex-col items-center justify-center gap-2 rounded-2xl border-2 border-primary/40 bg-primary/5 text-primary transition-colors hover:bg-primary/10 lg:snap-start"
      >
        <Landmark className="size-6" />
        <span className="text-sm font-medium">Conectar banco</span>
        <span className="px-4 text-center text-xs text-muted-foreground">Trae cuentas y movimientos</span>
      </button>

      <ResponsiveModal open={open} onOpenChange={setOpen} title="Conectar banco" className="sm:max-w-lg">
        <div className="flex flex-col gap-5 px-4 pb-6">
          {/* Selección de banco */}
          <div className="flex flex-col gap-2">
            {BANKS.map((b) => (
              <button
                key={b.id}
                type="button"
                disabled={!b.available}
                onClick={() => setSelected(b.id)}
                className={cn(
                  "flex h-14 items-center gap-3 rounded-xl border px-4 text-left transition-colors",
                  selected === b.id ? "border-primary bg-primary/10 text-foreground" : "border-border text-foreground",
                  !b.available && "cursor-not-allowed opacity-50",
                )}
              >
                <Landmark className="size-5 shrink-0 text-primary" />
                <span className="font-medium">{b.name}</span>
                {!b.available && <span className="ml-auto text-xs text-muted-foreground">Próximamente</span>}
              </button>
            ))}
          </div>

          {/* Pasos: la sync corre en tu navegador (solo lectura, tu sesión real) */}
          <ol className="flex flex-col gap-3 text-sm">
            <li className="flex gap-3">
              <Step n={1} />
              <span>
                Instala <span className="font-medium">Tampermonkey</span> y luego{" "}
                <a href="/lucaplan-bancochile.user.js" className="inline-flex items-center gap-1 font-medium text-primary underline">
                  <Download className="size-3.5" /> el userscript de LucaPlan
                </a>
                .
              </span>
            </li>
            <li className="flex gap-3">
              <Step n={2} />
              <div className="min-w-0 flex-1">
                <span>Copia tu token y pégalo cuando el userscript lo pida (solo la 1ª vez):</span>
                <div className="mt-2 flex items-center gap-2">
                  <code className="tabular min-w-0 flex-1 truncate rounded-md bg-muted px-3 py-2 text-xs">{token ?? "…"}</code>
                  <Button size="sm" variant="outline" onClick={copyToken} disabled={!token} className="h-9 shrink-0">
                    {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                  </Button>
                </div>
              </div>
            </li>
            <li className="flex gap-3">
              <Step n={3} />
              <span>
                Inicia sesión en el portal de Banco de Chile y aprieta el botón flotante{" "}
                <span className="font-medium">“⬇ Sincronizar con LucaPlan”</span>.
              </span>
            </li>
          </ol>

          <p className="text-xs text-muted-foreground">
            Todo es de solo lectura y corre en tu navegador con tu propia sesión (sin automatizar el login ni evadir nada).
          </p>

          <Button onClick={() => { router.refresh(); toast.success("Actualizado"); }} className="h-12 w-full rounded-full text-base">
            <RefreshCw className="mr-2 size-4" />
            Ya sincronicé — actualizar
          </Button>
        </div>
      </ResponsiveModal>
    </>
  );
}

function Step({ n }: { n: number }) {
  return (
    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">{n}</span>
  );
}
