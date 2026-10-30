"use client"

import { useState } from "react"
import { useForm, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useRouter } from "next/navigation"
import { ChevronRight, Eye, EyeOff } from "lucide-react"
import { toast } from "sonner"

import { authClient } from "@/lib/auth-client"
import { haptic } from "@/lib/haptics"
import {
  PROFILE_NAME_MAX,
  changePasswordSchema,
  profileNameSchema,
} from "@/lib/schemas/profile"
import {
  ModalActions,
  ModalSection,
  ResponsiveModal,
} from "@/components/ui/responsive-modal"
import { Input } from "@/components/ui/input"
import { FinanceField } from "./finance-form-field"

const NAME_FORM = "profile-name"
const PASSWORD_FORM = "profile-password"

/**
 * Hoja de la cuenta, como la tarjeta de Apple ID: identidad arriba, el nombre en un grupo y
 * «Cambiar contraseña» como fila que abre una hoja hija. La monta una vez el AppFrame; se abre desde
 * la fila de la cuenta en Ajustes (móvil) y desde el menú de la cuenta del sidebar (escritorio).
 */
export function ProfileSheet({
  open,
  onOpenChange,
  user,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  user: { name: string; email?: string; initial: string }
}) {
  const [passwordOpen, setPasswordOpen] = useState(false)

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={(o) => {
        if (!o) setPasswordOpen(false) // al reabrir parte en el perfil, no en la hija
        onOpenChange(o)
      }}
      title="Perfil"
      className="sm:max-w-md"
    >
      {/* La key reinicia el formulario cuando el nombre guardado cambia (tras router.refresh). */}
      <NameForm key={user.name} user={user}>
        <ModalSection>
          <button
            type="button"
            aria-haspopup="dialog"
            onClick={() => {
              haptic("light")
              setPasswordOpen(true)
            }}
            className="press flex min-h-11 w-full items-center gap-3 px-4 py-2.5 text-left text-body"
          >
            <span className="min-w-0 flex-1">Cambiar contraseña</span>
            <ChevronRight
              aria-hidden
              className="size-4 shrink-0 text-muted-foreground/60"
            />
          </button>
        </ModalSection>
      </NameForm>

      {/* Hija anidada: su formulario vive fuera del del nombre. */}
      <PasswordSheet open={passwordOpen} onOpenChange={setPasswordOpen} />
    </ResponsiveModal>
  )
}

// Todo el contenido de la hoja va dentro del formulario del nombre, para que su pie (escritorio)
// quede al final, después de la fila de la contraseña.
function NameForm({
  user,
  children,
}: {
  user: { name: string; email?: string; initial: string }
  children: React.ReactNode
}) {
  const initialName = user.name
  const router = useRouter()
  const form = useForm({
    resolver: zodResolver(profileNameSchema),
    defaultValues: { name: initialName },
  })
  const { errors, isSubmitting } = form.formState
  const name = useWatch({ control: form.control, name: "name" })
  const dirty = name.trim() !== initialName.trim()

  async function save({ name }: { name: string }) {
    const res = await authClient.updateUser({ name })
    if (res.error) {
      form.setError("root", {
        message: res.error.message ?? "No se pudo guardar el nombre.",
      })
      return
    }
    toast.success("Nombre actualizado.")
    router.refresh()
  }

  return (
    <form
      id={NAME_FORM}
      onSubmit={form.handleSubmit(save)}
      noValidate
      className="flex flex-col gap-8 px-5"
    >
      {/* Identidad: inicial grande, nombre y correo, centrados. El correo no se edita. */}
      <div className="flex flex-col items-center gap-1 text-center">
        <span
          aria-hidden
          className="mb-2 grid size-20 place-items-center rounded-full bg-primary text-large-title font-semibold text-primary-foreground"
        >
          {user.initial}
        </span>
        <p className="max-w-full truncate text-title-3 font-semibold">
          {user.name || "Sin nombre"}
        </p>
        {user.email && (
          <p className="max-w-full truncate text-subheadline text-muted-foreground">
            {user.email}
          </p>
        )}
      </div>

      {errors.root && (
        <p role="alert" className="text-subheadline text-destructive">
          {errors.root.message}
        </p>
      )}
      <ModalSection
        title={<label htmlFor="name">Nombre</label>}
        footer={
          errors.name && (
            <p id="name-error" role="alert" className="text-destructive">
              {errors.name.message}
            </p>
          )
        }
      >
        {/* El campo es la celda: sin relleno propio ni contorno hasta enfocarlo. */}
        <Input
          {...form.register("name")}
          id="name"
          autoComplete="name"
          inputMode="text"
          maxLength={PROFILE_NAME_MAX}
          placeholder="Tu nombre"
          aria-invalid={!!errors.name}
          aria-describedby={errors.name ? "name-error" : undefined}
          className="h-11 rounded-none border-0 bg-transparent px-4 text-body shadow-none focus-visible:ring-inset md:text-body"
        />
      </ModalSection>
      {children}
      <ModalActions
        primary={{
          label: isSubmitting ? "Guardando…" : "Guardar",
          form: NAME_FORM,
          disabled: !dirty || isSubmitting,
        }}
      />
    </form>
  )
}

function PasswordSheet({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const form = useForm({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: "", newPassword: "", confirmPassword: "" },
  })
  const { errors, isSubmitting } = form.formState
  const [show, setShow] = useState(false)
  const type = show ? "text" : "password"

  function close(o: boolean) {
    if (!o) {
      form.reset()
      setShow(false)
    }
    onOpenChange(o)
  }

  async function save(v: { currentPassword: string; newPassword: string }) {
    const res = await authClient.changePassword({
      currentPassword: v.currentPassword,
      newPassword: v.newPassword,
      revokeOtherSessions: true,
    })
    if (res.error) {
      form.setError("root", {
        message: res.error.message ?? "No se pudo cambiar la contraseña.",
      })
      return
    }
    haptic("light")
    toast.success("Contraseña actualizada.")
    close(false)
  }

  const field = (name: "currentPassword" | "newPassword" | "confirmPassword") => {
    const id = { currentPassword: "current", newPassword: "new", confirmPassword: "confirm" }[name]
    const error = errors[name]?.message
    return {
      id,
      error,
      input: {
        ...form.register(name),
        id,
        type,
        "aria-invalid": !!error,
        "aria-describedby":
          [error && `${id}-error`, name === "newPassword" && `${id}-hint`]
            .filter(Boolean)
            .join(" ") || undefined,
        className: "h-11 text-body md:text-body",
      },
    }
  }
  const current = field("currentPassword")
  const next = field("newPassword")
  const confirm = field("confirmPassword")

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={close}
      title="Cambiar contraseña"
      className="sm:max-w-md"
    >
      {/* Sin placeholder de puntos: tres campos con «••••••••» parecían contraseñas ya escritas. */}
      <form
        id={PASSWORD_FORM}
        onSubmit={form.handleSubmit(save)}
        noValidate
        className="flex flex-col gap-5 px-5"
      >
        {errors.root && (
          <p role="alert" className="text-subheadline text-destructive">
            {errors.root.message}
          </p>
        )}
        <FinanceField id={current.id} label="Contraseña actual" error={current.error}>
          <Input {...current.input} autoComplete="current-password" required />
        </FinanceField>
        <FinanceField
          id={next.id}
          label="Nueva contraseña"
          error={next.error}
          hint="Mínimo 8 caracteres."
        >
          <div className="relative">
            <Input
              {...next.input}
              autoComplete="new-password"
              required
              className={`${next.input.className} pr-11`}
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
        </FinanceField>
        <FinanceField
          id={confirm.id}
          label="Repite la nueva contraseña"
          error={confirm.error}
        >
          <Input {...confirm.input} autoComplete="new-password" required />
        </FinanceField>
        <ModalActions
          cancel={{
            label: "Cancelar",
            onClick: () => close(false),
            disabled: isSubmitting,
          }}
          primary={{
            label: isSubmitting ? "Guardando…" : "Guardar",
            form: PASSWORD_FORM,
            disabled: isSubmitting,
          }}
        />
      </form>
    </ResponsiveModal>
  )
}
