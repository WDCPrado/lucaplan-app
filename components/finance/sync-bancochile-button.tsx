"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Landmark, Loader2, RefreshCw, Lock, Check, X, CircleAlert, Unplug } from "lucide-react";
import { toast } from "sonner";
import { ResponsiveModal } from "@/components/ui/responsive-modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

const BANKS: { id: string; name: string; available: boolean }[] = [
  { id: "bancochile", name: "Banco de Chile", available: true },
];

// Otros bancos aún no soportados (se muestran como "Próximamente" abajo).
const COMING_SOON = ["Santander", "BCI", "Banco Estado", "Itaú", "Banco Falabella", "Scotiabank", "BICE"];

type Phase = "idle" | "syncing" | "done" | "error";
type Result = { accounts?: number; cartolaMovements?: number; unbilledMovements?: number } | null;

// Lee el stream SSE del sync y reporta cada paso / resultado / error.
async function runSyncStream(h: {
  onStep: (label: string) => void;
  onDone: (r: Result) => void;
  onError: (msg: string) => void;
  onBusy: () => void;
}) {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 180_000); // corta a los 3 min (no cuelga para siempre)
  try {
    const res = await fetch("/api/bancochile/sync", { method: "POST", signal: ctrl.signal });
    if (!res.body) return h.onError("Sin respuesta del servidor");
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split("\n\n");
      buf = parts.pop() ?? "";
      for (const part of parts) {
        const line = part.split("\n").find((l) => l.startsWith("data: "));
        if (!line) continue;
        let evt: { type: string; label?: string; error?: string; result?: Result };
        try {
          evt = JSON.parse(line.slice(6));
        } catch {
          continue;
        }
        if (evt.type === "progress") h.onStep(evt.label ?? "");
        else if (evt.type === "done") h.onDone(evt.result ?? null);
        else if (evt.type === "busy") h.onError("Ya hay una sincronización en curso");
        else if (evt.type === "error") h.onError(evt.error ?? "Error desconocido");
      }
    }
  } catch (e) {
    h.onError((e as Error).name === "AbortError" ? "Tardó demasiado; revisa el navegador o el terminal." : "Error de red");
  } finally {
    clearTimeout(timeout);
  }
}

export function SyncBancoChileButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState("bancochile");
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [savedRut, setSavedRut] = useState<string | null>(null);
  const [rut, setRut] = useState("");
  const [pass, setPass] = useState("");
  const [editing, setEditing] = useState(false);

  const [phase, setPhase] = useState<Phase>("idle");
  const [steps, setSteps] = useState<string[]>([]);
  const [result, setResult] = useState<Result>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function openModal() {
    setOpen(true);
    try {
      const res = await fetch("/api/bancochile/credentials");
      const data = await res.json();
      setConfigured(!!data.configured);
      setSavedRut(data.rut ?? null);
      setRut(data.rut ?? "");
    } catch {
      setConfigured(false);
    }
  }

  function resetSync() {
    setPhase("idle");
    setSteps([]);
    setResult(null);
    setErrorMsg(null);
  }

  async function startSync() {
    setPhase("syncing");
    setSteps([]);
    setResult(null);
    setErrorMsg(null);
    await runSyncStream({
      onStep: (label) => setSteps((s) => (s[s.length - 1] === label ? s : [...s, label])),
      onDone: (r) => {
        setResult(r);
        setPhase("done");
        router.refresh();
      },
      onError: (msg) => {
        setErrorMsg(msg);
        setPhase("error");
      },
      onBusy: () => {},
    });
  }

  async function connectAndSync() {
    if (!rut.trim() || !pass) {
      toast.error("Ingresa RUT y clave");
      return;
    }
    const save = await fetch("/api/bancochile/credentials", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rut: rut.trim(), pass }),
    });
    const sd = await save.json().catch(() => ({}));
    if (!save.ok || sd.ok === false) {
      toast.error(sd.error ?? "No se pudo guardar la clave");
      return;
    }
    setPass("");
    setConfigured(true);
    setSavedRut(rut.trim());
    setEditing(false);
    await startSync();
  }

  async function disconnect() {
    try {
      const res = await fetch("/api/bancochile/disconnect", { method: "POST" });
      if (res.ok) {
        setConfigured(false);
        setSavedRut(null);
        setEditing(false);
        setRut("");
        toast.success("Banco desconectado. Se borraron datos, clave y sesión.");
        router.refresh();
      } else {
        toast.error("No se pudo desconectar");
      }
    } catch {
      toast.error("Error de red");
    }
  }

  const syncing = phase === "syncing";
  const showForm = phase === "idle" && (configured === false || editing);
  const showConnected = phase === "idle" && configured === true && !editing;

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

      <ResponsiveModal
        open={open}
        // No permitir cerrar mientras sincroniza.
        onOpenChange={(o) => {
          if (syncing) return;
          setOpen(o);
          if (!o) resetSync();
        }}
        title="Conectar banco"
        className="sm:max-w-md"
      >
        <div className="flex flex-col gap-5 px-4 pb-6">
          {/* Selección de banco */}
          <div className="flex flex-col gap-2">
            {BANKS.map((b) => (
              <button
                key={b.id}
                type="button"
                disabled={!b.available || syncing}
                onClick={() => setSelected(b.id)}
                className={cn(
                  "flex h-14 items-center gap-3 rounded-xl border px-4 text-left transition-colors",
                  selected === b.id ? "border-primary bg-primary/10 text-foreground" : "border-border text-foreground",
                  (!b.available || syncing) && "opacity-60",
                )}
              >
                <Landmark className="size-5 shrink-0 text-primary" />
                <span className="font-medium">{b.name}</span>
                {!b.available && <span className="ml-auto text-xs text-muted-foreground">Próximamente</span>}
              </button>
            ))}
          </div>

          {/* Progreso / resultado */}
          {(phase === "syncing" || phase === "done" || phase === "error") && (
            <div className="flex flex-col gap-2 rounded-xl border border-border bg-muted/30 p-4">
              {steps.map((s, i) => {
                const isLast = i === steps.length - 1;
                const active = syncing && isLast;
                return (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    {active ? (
                      <Loader2 className="size-4 shrink-0 animate-spin text-primary" />
                    ) : (
                      <Check className="size-4 shrink-0 text-success" />
                    )}
                    <span className={active ? "text-foreground" : "text-muted-foreground"}>{s}</span>
                  </div>
                );
              })}
              {phase === "done" && (
                <div className="mt-1 flex items-center gap-2 text-sm font-medium text-success">
                  <Check className="size-4" /> Listo: {result?.accounts ?? 0} cuentas, {result?.cartolaMovements ?? 0} movimientos
                </div>
              )}
              {phase === "error" && (
                <div className="mt-1 flex items-start gap-2 text-sm text-destructive">
                  <CircleAlert className="mt-0.5 size-4 shrink-0" /> <span>{errorMsg}</span>
                </div>
              )}
              {syncing && <p className="mt-1 text-xs text-muted-foreground">No cierres esto — puede tardar hasta 1 minuto.</p>}
            </div>
          )}

          {/* Form de credenciales */}
          {showForm && (
            <div className="flex flex-col gap-3">
              <div>
                <Label className="mb-1 block text-xs">RUT</Label>
                <Input value={rut} onChange={(e) => setRut(e.target.value)} placeholder="12345678-9" className="h-11" autoComplete="off" />
              </div>
              <div>
                <Label className="mb-1 block text-xs">Clave de internet</Label>
                <Input type="password" value={pass} onChange={(e) => setPass(e.target.value)} placeholder="••••••••" className="h-11" autoComplete="off" />
              </div>
              <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <Lock className="mt-0.5 size-3.5 shrink-0" />
                Tu clave se guarda <span className="font-medium">cifrada en tu equipo</span> y solo se usa para iniciar sesión de solo lectura. No se pide 2FA para consultar.
              </p>
              <Button onClick={connectAndSync} className="mt-1 h-12 w-full rounded-full text-base">
                Conectar y sincronizar
              </Button>
              {editing && (
                <button type="button" onClick={() => setEditing(false)} className="text-center text-xs text-muted-foreground underline">
                  Cancelar
                </button>
              )}
            </div>
          )}

          {/* Estado conectado */}
          {showConnected && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2 rounded-xl border border-success/40 bg-success/5 px-4 py-3 text-sm">
                <Check className="size-4 text-success" />
                <span>Conectado{savedRut ? ` · ${savedRut}` : ""}</span>
                <button type="button" onClick={() => setEditing(true)} className="ml-auto text-xs text-muted-foreground underline">
                  Cambiar
                </button>
              </div>
              <Button onClick={startSync} className="h-12 w-full rounded-full text-base">
                <RefreshCw className="mr-2 size-4" />
                Sincronizar ahora
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" className="h-10 w-full rounded-full text-sm text-destructive hover:text-destructive">
                    <Unplug className="mr-2 size-4" />
                    Desconectar banco
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>¿Desconectar Banco de Chile?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Se borran las cuentas, tarjetas y movimientos importados, tu clave guardada y la sesión del navegador. Esta acción no se puede deshacer.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction onClick={disconnect} className="bg-destructive text-white hover:bg-destructive/90">
                      Desconectar
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          )}

          {/* Cerrar tras terminar */}
          {(phase === "done" || phase === "error") && (
            <div className="flex gap-2">
              {phase === "error" && (
                <Button variant="outline" onClick={startSync} className="h-11 flex-1 rounded-full">
                  Reintentar
                </Button>
              )}
              <Button onClick={() => { setOpen(false); resetSync(); }} className="h-11 flex-1 rounded-full">
                <X className="mr-2 size-4" /> Cerrar
              </Button>
            </div>
          )}

          {/* Otros bancos, aún no soportados */}
          {phase === "idle" && (
            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium text-muted-foreground">Próximamente</span>
              {COMING_SOON.map((name) => (
                <div
                  key={name}
                  className="flex h-12 cursor-not-allowed items-center gap-3 rounded-xl border border-border px-4 text-left opacity-50"
                >
                  <Landmark className="size-5 shrink-0 text-muted-foreground" />
                  <span className="font-medium">{name}</span>
                  <span className="ml-auto text-xs text-muted-foreground">Próximamente</span>
                </div>
              ))}
            </div>
          )}

          {phase === "idle" && (
            <p className="text-xs text-muted-foreground">
              También se sincroniza solo en segundo plano (cada hora) si programas la tarea. Todo corre local, de solo lectura.
            </p>
          )}
        </div>
      </ResponsiveModal>
    </>
  );
}
