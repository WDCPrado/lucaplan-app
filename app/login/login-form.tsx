"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { AlertCircle, Eye, EyeOff, Loader2, Moon, Sun } from "lucide-react";

import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ResponsiveModal } from "@/components/ui/responsive-modal";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LEGAL, type LegalKey } from "@/components/landing/legal-content";

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Cambiar tema"
      className="absolute top-4 right-4 z-10 size-11"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
    >
      <Sun className="size-5 dark:hidden" />
      <Moon className="hidden size-5 dark:block" />
    </Button>
  );
}

// Logo "G" multicolor oficial de Google (inline, sin dependencia).
function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4.5" aria-hidden="true">
      <path fill="#4285F4" d="M23.5 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.45a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.57-5.17 3.57-8.81Z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.94-2.91l-3.88-3.01c-1.07.72-2.45 1.15-4.06 1.15-3.12 0-5.77-2.11-6.71-4.95H1.28v3.11A12 12 0 0 0 12 24Z" />
      <path fill="#FBBC05" d="M5.29 14.28a7.2 7.2 0 0 1 0-4.56V6.61H1.28a12 12 0 0 0 0 10.78l4.01-3.11Z" />
      <path fill="#EA4335" d="M12 4.77c1.76 0 3.34.61 4.58 1.8l3.44-3.44A11.97 11.97 0 0 0 12 0 12 12 0 0 0 1.28 6.61l4.01 3.11C6.23 6.88 8.88 4.77 12 4.77Z" />
    </svg>
  );
}

function AuthForm({ mode }: { mode: "signin" | "signup" }) {
  const router = useRouter();
  const [showPw, setShowPw] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email"));
    const password = String(form.get("password"));

    const res =
      mode === "signup"
        ? await authClient.signUp.email({ email, password, name: String(form.get("name")) })
        : await authClient.signIn.email({ email, password });

    setPending(false);
    if (res.error) {
      setError(res.error.message ?? "Algo salió mal. Inténtalo de nuevo.");
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {mode === "signup" && (
        <div className="space-y-2">
          <Label htmlFor="name">Nombre</Label>
          <Input id="name" name="name" autoComplete="name" required placeholder="Tu nombre" className="h-11 text-base" />
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor={`${mode}-email`}>Email</Label>
        <Input
          id={`${mode}-email`}
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          placeholder="tu@email.com"
          className="h-11 text-base"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor={`${mode}-password`}>Contraseña</Label>
        <div className="relative">
          <Input
            id={`${mode}-password`}
            name="password"
            type={showPw ? "text" : "password"}
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            required
            minLength={8}
            placeholder="••••••••"
            className="h-11 pr-11 text-base"
          />
          <button
            type="button"
            onClick={() => setShowPw((v) => !v)}
            aria-label={showPw ? "Ocultar contraseña" : "Mostrar contraseña"}
            className="absolute top-1 right-1 grid size-9 place-items-center rounded-md text-muted-foreground hover:text-foreground"
          >
            {showPw ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
          </button>
        </div>
        {mode === "signup" && (
          <p className="text-xs text-muted-foreground">Mínimo 8 caracteres.</p>
        )}
      </div>

      {error && (
        <p role="alert" className="flex items-center gap-2 text-sm text-destructive">
          <AlertCircle className="size-4 shrink-0" />
          {error}
        </p>
      )}

      <Button
        type="submit"
        disabled={pending}
        className="h-11 w-full rounded-full text-base shadow-lg shadow-primary/25 transition-[transform,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-xl hover:shadow-primary/30 active:translate-y-0 active:scale-[0.98]"
      >
        {pending && <Loader2 className="size-4 animate-spin" />}
        {mode === "signup" ? "Crear cuenta" : "Ingresar"}
      </Button>
    </form>
  );
}

export function LoginForm() {
  const [legal, setLegal] = useState<LegalKey | null>(null);

  return (
    <main className="relative grid min-h-dvh lg:grid-cols-2">
      <ThemeToggle />

      {/* Panel de marca (solo escritorio): gradiente azul profundo FIJO (el mismo de las
          tarjetas débito en lib/bank-cards) — branding constante en dark y light. */}
      <aside
        className="relative hidden overflow-hidden p-12 text-white lg:flex lg:flex-col lg:justify-between"
        style={{ background: "linear-gradient(135deg, #0a2a6b 0%, #0b3f9e 55%, #0850c0 100%)" }}
      >
        <div className="absolute -top-32 -right-24 size-96 rounded-full border-36 border-white/10" />
        <div className="absolute -bottom-44 -left-20 size-80 rounded-full bg-white/5" />

        <div className="relative flex animate-in items-center gap-2.5 text-lg font-semibold tracking-[-0.04em] duration-700 fade-in">
          <span className="grid size-8 place-items-center rounded-lg bg-white text-sm font-bold text-[#0b3f9e]">
            L
          </span>
          LucaPlan
        </div>

        <div className="relative animate-in duration-700 fade-in slide-in-from-bottom-4">
          <h1 className="max-w-[12ch] text-5xl leading-[0.95] font-semibold tracking-tighter xl:text-6xl">
            Este mes sí tiene un plan.
          </h1>
          <p className="mt-5 max-w-sm text-lg leading-8 text-white/75">
            Presupuestos que reinician contigo, pagos visibles y tus
            movimientos en un solo lugar.
          </p>
        </div>

        <div
          className="relative max-w-sm animate-in duration-700 fade-in slide-in-from-bottom-4"
          style={{ animationDelay: "250ms", animationFillMode: "backwards" }}
        >
          <div className="landing-float-a rounded-2xl border border-white/15 bg-white/10 p-5 backdrop-blur-sm">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="text-white/75">Presupuesto del mes</span>
              <span className="rounded-full bg-white/15 px-2.5 py-0.5 text-xs font-semibold">
                Vas bien
              </span>
            </div>
            <p className="tabular mt-2 text-3xl font-semibold">
              $429.500{" "}
              <span className="text-base font-normal text-white/70">
                disponibles
              </span>
            </p>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/20">
              <div
                className="h-full animate-[bar-fill_1.4s_cubic-bezier(0.22,1,0.36,1)_0.6s_backwards] rounded-full bg-white"
                style={{ width: "57%" }}
              />
            </div>
          </div>
        </div>
      </aside>

      {/* Formulario: entrada escalonada (cada bloque con su delay, backwards para no parpadear) */}
      <section className="flex items-center justify-center px-4 py-10 lg:px-12">
        <div className="w-full max-w-md">
          {/* Branding compacto en móvil (en escritorio vive en el panel izquierdo) */}
          <div className="mb-8 flex animate-in flex-col items-center gap-3 text-center duration-500 fade-in slide-in-from-bottom-2 lg:hidden">
            <span className="grid size-12 place-items-center rounded-2xl bg-primary text-lg font-bold text-primary-foreground shadow-sm">
              L
            </span>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">LucaPlan</h1>
              <p className="text-sm text-muted-foreground">Planifica tu dinero con claridad.</p>
            </div>
          </div>

          <div className="hidden animate-in duration-500 fade-in slide-in-from-bottom-2 lg:block">
            <h2 className="text-3xl font-semibold tracking-[-0.03em]">Entra a tu plan</h2>
            <p className="mt-2 text-muted-foreground">
              Tu mes te está esperando.
            </p>
          </div>

          <div className="mt-0 lg:mt-8">
            {/* ponytail: Google OAuth aún sin backend → botón visible pero bloqueado */}
            <div
              className="animate-in duration-500 fade-in slide-in-from-bottom-2"
              style={{ animationDelay: "100ms", animationFillMode: "backwards" }}
            >
              <Button
                variant="outline"
                disabled
                title="Disponible pronto"
                className="h-11 w-full rounded-full text-base"
              >
                <GoogleIcon />
                Continuar con Google
                <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                  Pronto
                </span>
              </Button>

              <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground">
                <span className="h-px flex-1 bg-border" />
                o con tu correo
                <span className="h-px flex-1 bg-border" />
              </div>
            </div>

            <div
              className="animate-in duration-500 fade-in slide-in-from-bottom-2"
              style={{ animationDelay: "200ms", animationFillMode: "backwards" }}
            >
              <Tabs defaultValue="signin">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="signin">Ingresar</TabsTrigger>
                  {/* LANZAMIENTO: quitar `disabled` y el badge para abrir el registro */}
                  <TabsTrigger value="signup" disabled title="Disponible pronto">
                    Crear cuenta
                    <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                      Pronto
                    </span>
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="signin" className="mt-6">
                  <AuthForm mode="signin" />
                </TabsContent>
                <TabsContent value="signup" className="mt-6">
                  <AuthForm mode="signup" />
                </TabsContent>
              </Tabs>
            </div>

            <p
              className="mt-8 animate-in text-center text-xs leading-5 text-muted-foreground duration-500 fade-in"
              style={{ animationDelay: "350ms", animationFillMode: "backwards" }}
            >
              Al continuar aceptas los{" "}
              <button
                type="button"
                onClick={() => setLegal("terminos")}
                className="underline underline-offset-2 transition-colors hover:text-foreground"
              >
                Términos y Condiciones
              </button>{" "}
              y la{" "}
              <button
                type="button"
                onClick={() => setLegal("privacidad")}
                className="underline underline-offset-2 transition-colors hover:text-foreground"
              >
                Política de Privacidad
              </button>
              .
            </p>
          </div>
        </div>
      </section>

      {/* Legales: mismo contenido que la landing; aquí respetan el tema del usuario */}
      {legal && (
        <ResponsiveModal
          open
          onOpenChange={(o) => !o && setLegal(null)}
          title={LEGAL[legal].title}
          className="sm:max-w-2xl"
        >
          <ScrollArea className="max-h-[62dvh] px-6">
            <div className="pb-8">{LEGAL[legal].body}</div>
          </ScrollArea>
        </ResponsiveModal>
      )}
    </main>
  );
}
