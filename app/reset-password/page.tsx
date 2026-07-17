"use client"

import { Suspense, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { AlertCircle, Check, Eye, EyeOff, Loader2 } from "lucide-react"

import { authClient } from "@/lib/auth-client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

function ResetForm() {
  const router = useRouter()
  const token = useSearchParams().get("token")
  const [showPw, setShowPw] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    if (!token) {
      setError("Enlace inválido o expirado. Pide uno nuevo desde el login.")
      return
    }
    const form = new FormData(e.currentTarget)
    const newPassword = String(form.get("password"))
    if (newPassword.length < 8) {
      setError("La contraseña debe tener al menos 8 caracteres.")
      return
    }
    if (newPassword !== String(form.get("confirm"))) {
      setError("Las contraseñas no coinciden.")
      return
    }
    setPending(true)
    const res = await authClient.resetPassword({ newPassword, token })
    setPending(false)
    if (res.error) {
      setError(res.error.message ?? "No se pudo restablecer la contraseña.")
      return
    }
    setDone(true)
  }

  if (done) {
    return (
      <div className="space-y-4 text-center">
        <p className="flex items-center justify-center gap-2 text-sm text-success">
          <Check className="size-4" />
          Contraseña actualizada.
        </p>
        <Button
          onClick={() => router.push("/login")}
          className="h-11 w-full rounded-full text-base"
        >
          Ir a ingresar
        </Button>
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="password">Nueva contraseña</Label>
        <div className="relative">
          <Input
            id="password"
            name="password"
            type={showPw ? "text" : "password"}
            autoComplete="new-password"
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
        <p className="text-xs text-muted-foreground">Mínimo 8 caracteres.</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="confirm">Repite la contraseña</Label>
        <Input
          id="confirm"
          name="confirm"
          type={showPw ? "text" : "password"}
          autoComplete="new-password"
          required
          minLength={8}
          placeholder="••••••••"
          className="h-11 text-base"
        />
      </div>

      {error && (
        <p
          role="alert"
          className="flex items-center gap-2 text-sm text-destructive"
        >
          <AlertCircle className="size-4 shrink-0" />
          {error}
        </p>
      )}

      <Button
        type="submit"
        disabled={pending}
        className="h-11 w-full rounded-full text-base"
      >
        {pending && <Loader2 className="size-4 animate-spin" />}
        Restablecer contraseña
      </Button>
    </form>
  )
}

export default function ResetPasswordPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <h1 className="text-2xl font-semibold tracking-tight">
          Nueva contraseña
        </h1>
        <p className="mt-2 mb-8 text-sm text-muted-foreground">
          Elige una contraseña para tu cuenta de Luca Plan.
        </p>
        <Suspense>
          <ResetForm />
        </Suspense>
      </div>
    </main>
  )
}
