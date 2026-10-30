"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Eye, EyeOff, Loader2 } from "lucide-react"
import { toast } from "sonner"

import { authClient } from "@/lib/auth-client"
import { haptic } from "@/lib/haptics"
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
}: {
  user: { name: string; email: string; role: string; initial: string }
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
      title="Perfil"
    >
      {/* En móvil el contenido arranca pegado al header flotante: el aire de arriba existía para
          el enlace "Volver", que ya no está (la navegación vive en el shell). */}
      <div className="mx-auto w-full max-w-4xl px-4 pt-1 pb-6 md:pt-6 lg:px-8">
        {/* Móvil: título grande de iOS bajo la barra; en escritorio el título vive en el topbar. */}
        <h1 className="mb-3 text-large-title font-bold md:hidden">Perfil</h1>

        {/* Cabecera: identidad (ancho completo) */}
        <div className="glass flex items-center gap-4 rounded-xl p-4">
          <Avatar className="size-14 rounded-full bg-primary">
            <AvatarFallback className="rounded-full bg-primary text-title-3 font-semibold text-primary-foreground">
              {user.initial}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="truncate text-headline">
              {user.name || "Sin nombre"}
            </div>
            <div className="truncate text-subheadline text-muted-foreground">
              {user.email}
            </div>
            {/* «Usuario» no informa nada: el chip solo aparece cuando el rol dice algo. */}
            {user.role !== "USER" && (
              <Badge variant="secondary" className="mt-1.5">
                {ROLE_LABEL[user.role] ?? user.role}
              </Badge>
            )}
          </div>
        </div>

        {/* Móvil: una columna; escritorio: 2 columnas (nombre | contraseña). El correo no tiene
            sección: ya está en la cabecera y no se puede cambiar. */}
        <div className="mt-8 grid gap-8 lg:grid-cols-2 lg:items-start">
          <NameForm initialName={user.name} />
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
    // Lista agrupada: el título va fuera de la tarjeta; los campos, dentro.
    <section className="min-w-0">
      <h2 className="mb-3 text-title-3 font-bold">{title}</h2>
      <div className="glass rounded-xl p-4">{children}</div>
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
          {/* El título de la sección ya dice "Nombre": el label se mantiene para el lector de
              pantalla, sin repetirlo a la vista. */}
          <Label htmlFor="name" className="sr-only">
            Nombre para mostrar
          </Label>
          <Input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
            maxLength={80}
            placeholder="Tu nombre"
            className="h-11 text-body md:text-body"
          />
        </div>
        <Button
          type="submit"
          disabled={!dirty || pending}
          className="h-11"
        >
          {pending && <Loader2 className="size-4 animate-spin" />}
          Guardar
        </Button>
      </form>
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

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
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
    toast.success("Contraseña actualizada.")
  }

  return (
    <Section title="Contraseña">
      {/* Sin placeholder de puntos: tres campos con "••••••••" parecían contraseñas ya escritas. */}
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
            className="h-11 text-body md:text-body"
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
              className="h-11 pr-11 text-body md:text-body"
            />
            <button
              type="button"
              onClick={() => setShow((v) => !v)}
              aria-label={show ? "Ocultar contraseña" : "Mostrar contraseña"}
              className="absolute top-0 right-0 grid size-11 place-items-center rounded-lg text-muted-foreground hover:text-foreground"
            >
              {show ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
            </button>
          </div>
          <p className="text-footnote text-muted-foreground">Mínimo 8 caracteres.</p>
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
            className="h-11 text-body md:text-body"
          />
        </div>

        {error && (
          <p role="alert" className="text-subheadline text-destructive">
            {error}
          </p>
        )}

        <Button
          type="submit"
          disabled={pending}
          className="h-11"
        >
          {pending && <Loader2 className="size-4 animate-spin" />}
          Cambiar contraseña
        </Button>
      </form>
    </Section>
  )
}
