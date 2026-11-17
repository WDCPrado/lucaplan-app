"use client"

import { useForm, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { authClient } from "@/lib/auth-client"
import { PROFILE_NAME_MAX, profileNameSchema } from "@/lib/schemas/profile"
import { ModalActions, ResponsiveModal } from "@/components/ui/responsive-modal"
import { FinanceField } from "./finance-form-field"
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
    // Sin red, updateUser lanza: cae al mismo mensaje que un rechazo sin texto.
    const res = await authClient.updateUser({ name }).catch(() => null)
    if (!res || res.error) {
      form.setError("root", {
        message: res?.error?.message ?? "No se pudo guardar el nombre.",
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
      className="flex flex-col gap-6 px-4 md:px-6"
    >
      {/* Identidad: inicial, nombre y correo en una fila. El correo no se edita. */}
      <div className="flex items-center gap-3 rounded-lg bg-secondary p-3">
        <span
          aria-hidden
          className="grid size-12 shrink-0 place-items-center rounded-full bg-primary text-title font-semibold text-primary-foreground"
        >
          {user.initial}
        </span>
        <span className="grid min-w-0 flex-1">
          <span className="truncate font-semibold">
            {user.name || "Sin nombre"}
          </span>
          {user.email && (
            <span className="truncate text-callout text-ink-2">
              {user.email}
            </span>
          )}
        </span>
      </div>

      {errors.root && (
        <p
          role="alert"
          className="rounded-md bg-destructive-soft px-3 py-2.5 text-callout text-destructive"
        >
          {errors.root.message}
        </p>
      )}
      <FinanceField id="profile-name" label="Nombre" error={errors.name?.message}>
        <Input
          {...form.register("name")}
          id="profile-name"
          autoComplete="name"
          inputMode="text"
          maxLength={PROFILE_NAME_MAX}
          placeholder="Tu nombre"
          aria-invalid={!!errors.name}
          aria-describedby={errors.name ? "profile-name-error" : undefined}
        />
      </FinanceField>
      <ModalActions
        className="md:-mx-6 md:px-6"
        primary={{
          label: "Guardar",
          form: NAME_FORM,
          busy: isSubmitting,
          disabled: !dirty || isSubmitting,
        }}
      />
    </form>
  )
}
