"use client"

import { useForm, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { authClient } from "@/lib/auth-client"
import { PROFILE_NAME_MAX, profileNameSchema } from "@/lib/schemas/profile"
import {
  ModalActions,
  ModalSection,
  ResponsiveModal,
} from "@/components/ui/responsive-modal"
import { Input } from "@/components/ui/input"

const NAME_FORM = "profile-name-form"

/** Identidad y nombre de la cuenta; el acceso se verifica por correo. */
export function ProfileSheet({
  open,
  onOpenChange,
  user,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  user: { name: string; email?: string; initial: string }
}) {
  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title="Perfil"
      className="sm:max-w-md"
    >
      <NameForm key={user.name} user={user} />
    </ResponsiveModal>
  )
}

function NameForm({
  user,
}: {
  user: { name: string; email?: string; initial: string }
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
        title={<label htmlFor="profile-name">Nombre</label>}
        footer={
          errors.name && (
            <p
              id="profile-name-error"
              role="alert"
              className="text-destructive"
            >
              {errors.name.message}
            </p>
          )
        }
      >
        {/* El campo es la celda: sin relleno propio ni contorno hasta enfocarlo. */}
        <Input
          {...form.register("name")}
          id="profile-name"
          autoComplete="name"
          inputMode="text"
          maxLength={PROFILE_NAME_MAX}
          placeholder="Tu nombre"
          aria-invalid={!!errors.name}
          aria-describedby={errors.name ? "profile-name-error" : undefined}
          className="h-11 rounded-none border-0 bg-transparent px-4 text-body shadow-none focus-visible:ring-inset md:text-body"
        />
      </ModalSection>
      <ModalActions
        primary={{
          label: isSubmitting ? "Guardando…" : "Guardar",
          form: NAME_FORM,
          busy: isSubmitting,
          disabled: !dirty || isSubmitting,
        }}
      />
    </form>
  )
}
