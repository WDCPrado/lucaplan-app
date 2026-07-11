"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getFintoc } from "@fintoc/fintoc-js";
import { Landmark, Loader2 } from "lucide-react";
import { BankSyncOverlay } from "./bank-sync-overlay";

// La public key va al cliente (NEXT_PUBLIC, inlined). La secret key NUNCA llega aquí.
const PUBLIC_KEY = process.env.NEXT_PUBLIC_FINTOC_PUBLIC_KEY;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type SyncStatus = { connected: boolean; accounts: number; movements: number; uncategorized: number; aiEnabled: boolean };

async function fetchStatus(): Promise<SyncStatus | null> {
  try {
    const res = await fetch("/api/fintoc/status", { cache: "no-store" });
    return res.ok ? ((await res.json()) as SyncStatus) : null;
  } catch {
    return null;
  }
}

// El link_token llega por webhook (async) y la sync corre en background. Esperamos hasta que el
// primer lote de ESTA conexión esté importado y categorizado, comparando contra el baseline previo:
//  - movimientos crecieron (se importó algo nuevo), y
//  - si hay IA, la cantidad sin categoría se estabiliza (la categorización terminó su pasada; si algo
//    quedó sin clasificar, igual se estabiliza y no colgamos).
// Tope ~120s como red de seguridad (no importa si demora un poco, pero nunca cuelga para siempre).
async function waitForFirstBatch(base: SyncStatus): Promise<void> {
  let lastUncat = -1;
  let stable = 0;
  for (let i = 0; i < 80; i++) {
    await sleep(1500);
    const s = await fetchStatus();
    if (!s || s.movements <= base.movements) continue; // aún no aparece nada nuevo
    if (!s.aiEnabled) return; // sin IA: basta con que aparezcan los movimientos
    if (s.uncategorized === lastUncat) {
      if (++stable >= 2) return; // sin cambios en 2 sondeos → categorización terminada
    } else {
      stable = 0;
      lastUncat = s.uncategorized;
    }
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
    const baseline = (await fetchStatus()) ?? { connected: false, accounts: 0, movements: 0, uncategorized: 0, aiEnabled: false };
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
        await waitForFirstBatch(baseline);
        // Refresca los datos ANTES de revelar el "listo": así el overlay tapa el dashboard mientras
        // se puebla, y al desvanecerse ya se ven los movimientos (no un "0 este mes" viejo).
        router.refresh();
        setState("done");
        await sleep(1300);
        setState("idle");
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
        data-card
        className="flex min-h-40 w-72 shrink-0 snap-center snap-always flex-col items-center justify-center gap-2 rounded-2xl border-2 border-primary/40 bg-primary/5 text-primary transition-colors hover:bg-primary/10 disabled:opacity-70 lg:snap-start"
      >
        {busy ? <Loader2 className="size-6 animate-spin" /> : <Landmark className="size-6" />}
        <span className="text-sm font-medium">Conectar banco</span>
        <span className="px-4 text-center text-xs text-muted-foreground">Trae cuentas y movimientos con Fintoc</span>
      </button>

      {(state === "syncing" || state === "done") && <BankSyncOverlay finished={state === "done"} />}
    </>
  );
}
