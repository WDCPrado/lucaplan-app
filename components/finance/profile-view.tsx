"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Check, Eye, EyeOff, Loader2 } from "lucide-react"
import { toast } from "sonner"

import { authClient } from "@/lib/auth-client"
import { haptic } from "@/lib/haptics"
import { AppShell } from "./app-shell"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type {
  AccountDTO,
  CategoryDTO,
} from "@/arch/v1/application/finance-use-cases/finance-read"

// Etiqueta en español para el rol; desconocido cae en el valor crudo.
const ROLE_LABEL: Record<string, string> = {
  ADMIN: "Administrador",
  PREMIUM: "Premium",
  USER: "Usuario",
}

export function ProfileView({
  user,
  accounts,
  categories,
}: {
  user: { name: string; email: string; role: string; initial: string }
  // Solo para el "+" de ingreso rápido del shell.
  accounts: AccountDTO[]
  categories: CategoryDTO[]
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
      quickAdd={{ accounts, categories }}
      title="Mi perfil"
    >
      {/* En móvil el contenido arranca pegado al header flotante: el aire de arriba existía para
          el enlace "Volver", que ya no está (la navegación vive en el shell). */}
      <div className="mx-auto w-full max-w-4xl px-4 pt-1 pb-6 lg:px-8 lg:py-6">
        {/* En escritorio el título ya está en la topbar; en móvil no hay, así que se muestra. */}
        <h1 className="mb-3 font-heading text-xl font-bold md:sr-only">
          Mi perfil
        </h1>

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
      {/* Texto, no un input deshabilitado: un campo gris con el valor apagado se lee como
          "editable pero roto" y hasta como vacío. Si no se puede cambiar, no es un campo. */}
      <p className="truncate text-base">{email}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        El correo no se puede cambiar por ahora.
      </p>
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
