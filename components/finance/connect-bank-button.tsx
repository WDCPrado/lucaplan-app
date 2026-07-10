"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getFintoc } from "@fintoc/fintoc-js";
import { Landmark, Loader2 } from "lucide-react";
import { BankSyncOverlay } from "./bank-sync-overlay";

// La public key va al cliente (NEXT_PUBLIC, inlined). La secret key NUNCA llega aquí.
const PUBLIC_KEY = process.env.NEXT_PUBLIC_FINTOC_PUBLIC_KEY;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function accountCount(): Promise<number> {
  try {
    const res = await fetch("/api/accounts", { cache: "no-store" });
    const data = await res.json();
    return Array.isArray(data) ? data.length : 0;
  } catch {
    return 0;
  }
}

// El link_token llega por webhook (async) y la sync corre en background; sondeamos /api/accounts
// hasta que crezca respecto al baseline, o hasta el tope (~30s).
async function waitForNewAccounts(baseline: number): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await sleep(1500);
    if ((await accountCount()) > baseline) return;
  }
}

type State = "idle" | "opening" | "syncing" | "done";

// Tile "Conectar banco": abre el widget de Fintoc (product movements) con el `webhookUrl` (donde
// Fintoc entrega el link_token). Al conectar, muestra un overlay de carga y sondea hasta ver el
// banco. Si no hay public key configurada, no se muestra.
export function ConnectBankButton() {
  const router = useRouter();
  const [state, setState] = useState<State>("idle");
  if (!PUBLIC_KEY) return null;

  async function connect() {
    setState("opening");
    const [cfg, Fintoc] = await Promise.all([
      fetch("/api/fintoc/widget-config", { method: "POST" }).then((r) => (r.ok ? r.json() : null)),
      getFintoc(),
    ]);
    if (!cfg?.webhookUrl || !Fintoc) {
      setState("idle");
      return;
    }
    const baseline = await accountCount();
    const widget = Fintoc.create({
      holderType: "individual",
      product: "movements",
      publicKey: PUBLIC_KEY,
      webhookUrl: cfg.webhookUrl,
      onSuccess: async () => {
        // El widget puede exponer close/destroy según versión; toleramos que no existan.
        try {
          widget.close?.();
        } catch {}
        try {
          widget.destroy?.();
        } catch {}
        setState("syncing");
        await waitForNewAccounts(baseline);
        setState("done");
        await sleep(1300); // deja ver el estado "listo" antes de recargar
        setState("idle");
        router.refresh();
      },
      onExit: () => setState("idle"),
    });
    widget.open();
  }

  const busy = state !== "idle";
  return (
    <>
      <button
        onClick={connect}
        disabled={busy}
        className="flex min-h-40 w-72 shrink-0 snap-start flex-col items-center justify-center gap-2 rounded-2xl border-2 border-primary/40 bg-primary/5 text-primary transition-colors hover:bg-primary/10 disabled:opacity-70"
      >
        {busy ? <Loader2 className="size-6 animate-spin" /> : <Landmark className="size-6" />}
        <span className="text-sm font-medium">Conectar banco</span>
        <span className="px-4 text-center text-xs text-muted-foreground">Trae cuentas y movimientos con Fintoc</span>
      </button>

      {(state === "syncing" || state === "done") && <BankSyncOverlay finished={state === "done"} />}
    </>
  );
}
