"use client"

import { z } from "zod"
import { useId, useState } from "react"
import { useForm, Controller, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useRouter } from "next/navigation"
import { Trash2 } from "lucide-react"
import { toast } from "sonner"
import { haptic } from "@/lib/haptics"
import { categorySchema, categoryLimitSchema } from "@/lib/finance-form-schemas"
import { ModalFooter, ResponsiveModal } from "@/components/ui/responsive-modal"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { formatCLP, monthName } from "@/lib/finance-format"
import { CATEGORY_COLORS, CATEGORY_ICONS } from "./category-icons"
import {
  FinanceField,
  MoneyFormInput,
  financeResponseError,
} from "./finance-form-field"
import type { CategoryDTO } from "@/arch/v1/application/finance-use-cases/finance-read"

const formSchema = categorySchema.extend({
  limit: categoryLimitSchema.shape.limit,
})
export function CategoryModal({
  open,
  onOpenChange,
  onDeleted,
  period,
  category,
  lockedType,
  remainingToAllocate,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onDeleted?: (id: string) => void
  period: { year: number; month: number }
  category?: CategoryDTO | null
  lockedType?: "income" | "expense" | null
  remainingToAllocate?: number | null
}) {
  const router = useRouter()
  const formId = `category-${useId()}`
  const [deleting, setDeleting] = useState(false)
  const [createdId, setCreatedId] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const form = useForm({
    resolver: zodResolver(formSchema),
    values: {
      id: category?.id,
      name: category?.name ?? "",
      type: (category?.type ?? lockedType ?? "expense") as "income" | "expense",
      description: category?.description ?? null,
      limit: category?.limit ?? 0,
      paceEnabled: category?.paceEnabled ?? true,
      icon: category?.icon ?? null,
      color: category?.color ?? CATEGORY_COLORS[0],
    },
  })
  const type = useWatch({ control: form.control, name: "type" })
  const limit = useWatch({ control: form.control, name: "limit" })
  const color = useWatch({ control: form.control, name: "color" })
  const icon = useWatch({ control: form.control, name: "icon" })
  const { errors, isSubmitting, isDirty } = form.formState
  const busy = isSubmitting || deleting
  const palette =
    color && !CATEGORY_COLORS.includes(color)
      ? [...CATEGORY_COLORS, color]
      : CATEGORY_COLORS
  const left =
    remainingToAllocate == null || type !== "expense"
      ? null
      : remainingToAllocate + (category?.limit ?? 0) - limit
  async function save(values: z.infer<typeof formSchema>) {
    form.clearErrors("root")
    try {
      const { limit: nextLimit, ...identity } = values
      // Limit-only edits do not rewrite the global category identity.
      const identityChanged =
        !category ||
        Object.keys(form.formState.dirtyFields).some((key) => key !== "limit")
      let categoryId = category?.id ?? createdId
      if (identityChanged) {
        const res = await fetch("/api/categories", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...identity,
            id: category?.id ?? createdId ?? undefined,
            name: identity.name.trim(),
            description: identity.description?.trim() || null,
          }),
        })
        if (!res.ok)
          throw new Error(
            await financeResponseError(res, "No se pudo guardar la categoría.")
          )
        categoryId = category?.id ?? (await res.json()).id
        if (!category && categoryId) setCreatedId(categoryId)
      }
      if (
        values.type === "expense" &&
        (!category || form.formState.dirtyFields.limit)
      ) {
        const res = await fetch("/api/category-limits", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ categoryId, ...period, limit: nextLimit }),
        })
        if (!res.ok)
          throw new Error(
            await financeResponseError(
              res,
              identityChanged
                ? "La categoría se guardó, pero el tope no. Vuelve a intentarlo."
                : "No se pudo guardar el tope."
            )
          )
      }
      haptic("success")
      setCreatedId(null)
      form.reset()
      onOpenChange(false)
      router.refresh()
    } catch (error) {
      haptic("error")
      form.setError("root", {
        message:
          error instanceof Error
            ? error.message
            : "No se pudo guardar la categoría.",
      })
    }
  }
  async function remove() {
    if (!category || busy) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/categories/${category.id}`, {
        method: "DELETE",
      })
      if (!res.ok)
        throw new Error(
          await financeResponseError(res, "No se pudo eliminar la categoría.")
        )
      toast.success(
        "Categoría eliminada; sus movimientos quedaron sin categoría"
      )
      setCreatedId(null)
      form.reset()
      onOpenChange(false)
      onDeleted?.(category.id)
      router.refresh()
    } catch (error) {
      form.setError("root", {
        message:
          error instanceof Error
            ? error.message
            : "No se pudo eliminar la categoría.",
      })
    } finally {
      setDeleting(false)
    }
  }
  return (
    <ResponsiveModal
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          form.reset()
          setCreatedId(null)
        }
        onOpenChange(next)
      }}
      title={
        category
          ? "Editar categoría"
          : lockedType === "income"
            ? "Nueva categoría de ingreso"
            : "Nueva categoría"
      }
    >
      <form
        id={formId}
        onSubmit={form.handleSubmit(save)}
        className="flex flex-col gap-7 px-5"
      >
        <fieldset disabled={busy} className="contents">
          {errors.root && (
            <p role="alert" className="text-subheadline text-destructive">
              {errors.root.message}
            </p>
          )}
          <FinanceField
            id={`${formId}-name`}
            label="Nombre"
            required
            error={errors.name?.message}
          >
            <Input
              {...form.register("name")}
              id={`${formId}-name`}
              required
              inputMode="text"
              className="h-12 text-body"
              placeholder="Ej. Supermercado"
              aria-invalid={!!errors.name}
              aria-describedby={
                errors.name ? `${formId}-name-error` : undefined
              }
            />
          </FinanceField>
          {!category && !lockedType && (
            <FinanceField
              id={`${formId}-type`}
              label="Tipo"
              required
              error={errors.type?.message}
            >
              <Controller
                control={form.control}
                name="type"
                render={({ field }) => (
                  <Select
                    value={field.value}
                    onValueChange={field.onChange}
                    required
                  >
                    <SelectTrigger
                      id={`${formId}-type`}
                      className="h-12! w-full text-body"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="expense">Gasto</SelectItem>
                      <SelectItem value="income">Ingreso</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </FinanceField>
          )}
          {type === "expense" && (
            <section className="space-y-5">
              <FinanceField
                id={`${formId}-limit`}
                label={`Tope de ${monthName(period.month)} (CLP)`}
                error={errors.limit?.message}
                hint={
                  left === null
                    ? "Este tope se hereda hasta que lo cambies."
                    : left < 0
                      ? `Sobreasignado por ${formatCLP(-left)}. Puedes guardar y ajustar después.`
                      : `Por repartir: ${formatCLP(left)}. No necesitas asignarlo todo.`
                }
              >
                <Controller
                  control={form.control}
                  name="limit"
                  render={({ field }) => (
                    <MoneyFormInput
                      allowNegative
                      id={`${formId}-limit`}
                      name={field.name}
                      ref={field.ref}
                      value={field.value}
                      onValueChange={field.onChange}
                      onBlur={field.onBlur}
                      aria-invalid={!!errors.limit}
                      aria-describedby={`${formId}-limit-${errors.limit ? "error" : "hint"}`}
                      placeholder="70.000"
                    />
                  )}
                />
              </FinanceField>
              <FinanceField
                id={`${formId}-pace`}
                label="Ritmo de gasto"
                hint="Compara tu gasto con el tope para hoy o esta semana. Apágalo si pagas esta categoría una vez al mes."
              >
                <Controller
                  control={form.control}
                  name="paceEnabled"
                  render={({ field }) => (
                    <Switch
                      id={`${formId}-pace`}
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      aria-describedby={`${formId}-pace-hint`}
                    />
                  )}
                />
              </FinanceField>
            </section>
          )}
          <fieldset className="space-y-3">
            <legend className="text-subheadline font-medium">Icono</legend>
            <div className="grid grid-cols-5 gap-2 sm:grid-cols-6">
              {CATEGORY_ICONS.map(({ name, Icon }) => (
                <Button
                  key={name}
                  type="button"
                  variant="outline"
                  className={cn(
                    "size-11",
                    icon === name && "border-primary bg-primary/10 text-primary"
                  )}
                  aria-label={name}
                  aria-pressed={icon === name}
                  onClick={() =>
                    form.setValue("icon", name, { shouldDirty: true })
                  }
                >
                  <Icon size={18} />
                </Button>
              ))}
            </div>
          </fieldset>
          <fieldset className="space-y-3">
            <legend className="text-subheadline font-medium">Color</legend>
            <div className="flex flex-wrap gap-2">
              {palette.map((value) => (
                <button
                  type="button"
                  key={value}
                  aria-label={`Color ${value}`}
                  aria-pressed={color === value}
                  onClick={() =>
                    form.setValue("color", value, { shouldDirty: true })
                  }
                  className={cn(
                    "grid size-11 place-items-center rounded-lg border",
                    color === value && "border-foreground"
                  )}
                >
                  <span
                    className="size-6 rounded-full"
                    style={{ backgroundColor: value }}
                  />
                </button>
              ))}
            </div>
          </fieldset>
          <FinanceField
            id={`${formId}-description`}
            label="Descripción para la IA (opcional)"
            error={errors.description?.message}
            hint="Ayuda a clasificar los movimientos de tu banco."
          >
            <Controller
              control={form.control}
              name="description"
              render={({ field }) => (
                <Textarea
                  id={`${formId}-description`}
                  name={field.name}
                  ref={field.ref}
                  inputMode="text"
                  value={field.value ?? ""}
                  onChange={(event) =>
                    field.onChange(event.target.value || null)
                  }
                  onBlur={field.onBlur}
                  rows={2}
                  className="text-body"
                  placeholder="Ej. Comida y mercadería para la casa"
                  aria-invalid={!!errors.description}
                  aria-describedby={`${formId}-description-${errors.description ? "error" : "hint"}`}
                />
              )}
            />
          </FinanceField>
        </fieldset>
      </form>
      <ModalFooter className="px-5">
        <Button
          type="button"
          variant="outline"
          className="h-12"
          disabled={busy}
          onClick={() => {
            form.reset()
            setCreatedId(null)
            onOpenChange(false)
          }}
        >
          Cancelar
        </Button>
        {category && (
          <Button
            type="button"
            variant="outline"
            className="size-12 text-destructive"
            disabled={busy}
            onClick={() => setConfirmDelete(true)}
            aria-label="Eliminar categoría"
          >
            <Trash2 className="size-4" />
          </Button>
        )}
        <Button
          type="submit"
          form={formId}
          disabled={busy || (!!category && !isDirty)}
          className="h-12 flex-1 text-body"
        >
          {isSubmitting ? "Guardando…" : "Guardar categoría"}
        </Button>
      </ModalFooter>
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar la categoría?</AlertDialogTitle>
            <AlertDialogDescription>
              Sus movimientos quedarán sin categoría (no se borran).
              {type === "income" &&
                " Los ingresos asignados a ella sí se eliminan."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={remove} variant="destructive">
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ResponsiveModal>
  )
}
