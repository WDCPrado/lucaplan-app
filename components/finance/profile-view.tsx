"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { ArrowLeft, Check, Eye, EyeOff, Loader2 } from "lucide-react"
import { toast } from "sonner"

import { authClient } from "@/lib/auth-client"
import { haptic } from "@/lib/haptics"
import { PushToggle } from "@/components/pwa/push-toggle"
import { AppShell } from "./app-shell"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

// Etiqueta en español para el rol; desconocido cae en el valor crudo.
const ROLE_LABEL: Record<string, string> = {
  ADMIN: "Administrador",
  PREMIUM: "Premium",
  USER: "Usuario",
}

export function ProfileView({
  user,
  vapidPublicKey,
}: {
  user: { name: string; email: string; role: string; initial: string }
  vapidPublicKey: string
}) {
  const router = useRouter()

  async function signOut() {
    await authClient.signOut()
    router.push("/login")
  }

  return (
    <AppShell
      user={{ name: user.name || user.email, initial: user.initial, email: user.email }}
      active="perfil"
      onSignOut={signOut}
      title="Mi perfil"
    >
      <div className="mx-auto w-full max-w-4xl px-4 py-6 lg:px-8">
        <Link
          href="/dashboard"
          className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Volver
        </Link>

        {/* Cabecera: identidad (ancho completo) */}
        <div className="glass flex items-center gap-4 rounded-2xl p-5">
          <Avatar className="size-14 rounded-2xl bg-primary">
            <AvatarFallback className="rounded-2xl bg-primary text-xl font-semibold text-primary-foreground">
              {user.initial}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="truncate text-lg font-semibold">
              {user.name || "Sin nombre"}
            </div>
            <div className="truncate text-sm text-muted-foreground">
              {user.email}
            </div>
            <Badge variant="secondary" className="mt-1.5">
              {ROLE_LABEL[user.role] ?? user.role}
            </Badge>
          </div>
        </div>

        {/* Móvil: una columna; escritorio: 2 columnas (nombre+correo | contraseña) */}
        <div className="mt-4 grid gap-4 lg:grid-cols-2 lg:items-start">
          <div className="grid gap-4">
            <NameForm initialName={user.name} />
            <EmailField email={user.email} />
            {vapidPublicKey && (
              <Section title="Notificaciones">
                <PushToggle vapidPublicKey={vapidPublicKey} />
              </Section>
            )}
          </div>
          <PasswordForm />
        </div>
      </div>
    </AppShell>
  )
}

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="glass rounded-2xl p-5">
      <h2 className="mb-4 font-heading text-base font-bold">{title}</h2>
      {children}
    </section>
  )
}

function NameForm({ initialName }: { initialName: string }) {
  const router = useRouter()
  const [name, setName] = useState(initialName)
  const [pending, setPending] = useState(false)
  const dirty = name.trim() !== initialName.trim() && name.trim().length > 0

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!dirty) return
    setPending(true)
    const res = await authClient.updateUser({ name: name.trim() })
    setPending(false)
    if (res.error) {
      toast.error(res.error.message ?? "No se pudo guardar el nombre.")
      return
    }
    toast.success("Nombre actualizado.")
    router.refresh()
  }

  return (
    <Section title="Nombre">
      <form onSubmit={save} className="space-y-3">
        <div className="space-y-2">
          <Label htmlFor="name">Nombre para mostrar</Label>
          <Input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
            maxLength={80}
            placeholder="Tu nombre"
            className="h-11 text-base"
          />
        </div>
        <Button
          type="submit"
          disabled={!dirty || pending}
          className="h-11 rounded-full"
        >
          {pending && <Loader2 className="size-4 animate-spin" />}
          Guardar
        </Button>
      </form>
    </Section>
  )
}

function EmailField({ email }: { email: string }) {
  return (
    <Section title="Correo">
      <div className="space-y-2">
        <Label htmlFor="email">Correo</Label>
        <Input
          id="email"
          value={email}
          readOnly
          disabled
          className="h-11 text-base"
        />
        <p className="text-xs text-muted-foreground">
          El correo no se puede cambiar por ahora.
        </p>
      </div>
    </Section>
  )
}

function PasswordForm() {
  const [current, setCurrent] = useState("")
  const [next, setNext] = useState("")
  const [confirm, setConfirm] = useState("")
  const [show, setShow] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setDone(false)
    if (next.length < 8) {
      setError("La nueva contraseña debe tener al menos 8 caracteres.")
      return
    }
    if (next !== confirm) {
      setError("Las contraseñas no coinciden.")
      return
    }
    setPending(true)
    const res = await authClient.changePassword({
      currentPassword: current,
      newPassword: next,
      revokeOtherSessions: true,
    })
    setPending(false)
    if (res.error) {
      setError(res.error.message ?? "No se pudo cambiar la contraseña.")
      return
    }
    haptic("light")
    setCurrent("")
    setNext("")
    setConfirm("")
    setDone(true)
    toast.success("Contraseña actualizada.")
  }

  return (
    <Section title="Contraseña">
      <form onSubmit={save} className="space-y-3">
        <div className="space-y-2">
          <Label htmlFor="current">Contraseña actual</Label>
          <Input
            id="current"
            type={show ? "text" : "password"}
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
            required
            placeholder="••••••••"
            className="h-11 text-base"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="new">Nueva contraseña</Label>
          <div className="relative">
            <Input
              id="new"
              type={show ? "text" : "password"}
              value={next}
              onChange={(e) => setNext(e.target.value)}
              autoComplete="new-password"
              required
              minLength={8}
              placeholder="••••••••"
              className="h-11 pr-11 text-base"
            />
            <button
              type="button"
              onClick={() => setShow((v) => !v)}
              aria-label={show ? "Ocultar contraseña" : "Mostrar contraseña"}
              className="absolute top-1 right-1 grid size-9 place-items-center rounded-md text-muted-foreground hover:text-foreground"
            >
              {show ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
            </button>
          </div>
          <p className="text-xs text-muted-foreground">Mínimo 8 caracteres.</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirm">Repite la nueva contraseña</Label>
          <Input
            id="confirm"
            type={show ? "text" : "password"}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            required
            minLength={8}
            placeholder="••••••••"
            className="h-11 text-base"
          />
        </div>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {done && (
          <p className="flex items-center gap-2 text-sm text-success">
            <Check className="size-4" />
            Contraseña actualizada.
          </p>
        )}

        <Button
          type="submit"
          disabled={pending}
          className="h-11 rounded-full"
        >
          {pending && <Loader2 className="size-4 animate-spin" />}
          Cambiar contraseña
        </Button>
      </form>
    </Section>
  )
}
