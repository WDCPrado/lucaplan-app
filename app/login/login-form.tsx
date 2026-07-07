"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { AlertCircle, Eye, EyeOff, Loader2, Moon, Sun, Wallet } from "lucide-react";

import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Cambiar tema"
      className="absolute right-4 top-4 size-11"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
    >
      <Sun className="size-5 dark:hidden" />
      <Moon className="hidden size-5 dark:block" />
    </Button>
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
    router.push("/");
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
            className="absolute right-1 top-1 grid size-9 place-items-center rounded-md text-muted-foreground hover:text-foreground"
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

      <Button type="submit" disabled={pending} className="h-11 w-full text-base">
        {pending && <Loader2 className="size-4 animate-spin" />}
        {mode === "signup" ? "Crear cuenta" : "Ingresar"}
      </Button>
    </form>
  );
}

export function LoginForm() {
  return (
    <main className="relative grid min-h-dvh place-items-center px-4 py-10">
      <ThemeToggle />

      <div className="glass w-full max-w-md rounded-3xl p-6 sm:p-8">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <span className="grid size-12 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
            <Wallet className="size-6" />
          </span>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">LucaPlan</h1>
            <p className="text-sm text-muted-foreground">Planifica tu dinero con claridad.</p>
          </div>
        </div>

        <Tabs defaultValue="signin">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="signin">Ingresar</TabsTrigger>
            <TabsTrigger value="signup">Crear cuenta</TabsTrigger>
          </TabsList>
          <TabsContent value="signin" className="mt-6">
            <AuthForm mode="signin" />
          </TabsContent>
          <TabsContent value="signup" className="mt-6">
            <AuthForm mode="signup" />
          </TabsContent>
        </Tabs>
      </div>
    </main>
  );
}
