"use client"

import { useId, useRef, useState } from "react"
import { flushSync } from "react-dom"
import { Controller, useForm, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { Loader, Pencil, Plus, Sparkles, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { ResponsiveModal } from "@/components/ui/responsive-modal"
import { haptic } from "@/lib/haptics"
import { cn } from "@/lib/utils"
import {
  applyCategoriesInput,
  DESCRIPTION_MAX,
  onboardingCategory,
  proposeCategoriesInput,
  type OnboardingCategory,
  type ProposeCategoriesOutput,
} from "@/lib/onboarding-schemas"
import { CATEGORY_COLORS, CategoryIcon } from "../category-icons"
import { CategoryAppearancePicker } from "../category-appearance-picker"
import { FinanceField } from "../finance-form-field"
import { Segmented } from "../segmented"
import { DEFAULT_CATEGORIES } from "@/arch/v1/application/finance-use-cases/seed-default-categories-use-case"
import { ApiError, proposeCategories, saveCategories } from "./http"

// `id` es solo local (clave estable de la lista): el esquema del PUT lo descarta.
type Proposed = ProposeCategoriesOutput["categories"][number] & { id: string }

const withIds = (list: ProposeCategoriesOutput["categories"]): Proposed[] =>
  list.map((c) => ({ ...c, id: crypto.randomUUID() }))

const editorValues = (c: OnboardingCategory | null) => ({
  name: c?.name ?? "",
  type: c?.type ?? "expense",
  icon: c?.icon ?? "Tag",
  color: c?.color ?? CATEGORY_COLORS[0],
  description: c?.description ?? null,
})

function useEditorForm() {
  return useForm({
    resolver: zodResolver(onboardingCategory),
    defaultValues: editorValues(null),
  })
}

const EXAMPLES = [
  "Voy al súper en Líder",
  "Uso Uber y metro",
  "Pago Netflix y Spotify",
  "Tengo perro",
  "Arriendo departamento",
]

const CHANGE_LABEL: Record<Proposed["change"], string> = {
  kept: "Se queda",
  edited: "Ajustada",
  added: "Nueva",
}

// Paso «Tu día a día»: la persona cuenta cómo gasta, la IA propone categorías (o llega el set
// precreado si no hay OPENAI_API_KEY), se revisan y se guardan con un PUT.
export function CategoriesStep({
  aiAvailable,
  onSaved,
}: {
  aiAvailable: boolean
  onSaved: () => void
}) {
  const formId = `onb-describe-${useId()}`
  // Sin IA no se llama a propose: se parte del set precreado tal cual.
  const [proposal, setProposal] = useState<Proposed[] | null>(() =>
    aiAvailable
      ? null
      : withIds(
          DEFAULT_CATEGORIES.map((c) => ({ ...c, change: "kept", reason: null }))
        )
  )
  const [source, setSource] = useState<ProposeCategoriesOutput["source"]>(
    aiAvailable ? "ai" : "default"
  )
  const [saving, setSaving] = useState(false)
  // `editing` se conserva al cerrar: el contenido no cambia durante la animación de salida.
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<string | "new" | null>(null)
  const editorForm = useEditorForm()
  const listRef = useRef<HTMLUListElement>(null)
  const addRef = useRef<HTMLButtonElement>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  const form = useForm({
    resolver: zodResolver(proposeCategoriesInput),
    defaultValues: { description: "" },
  })
  const description = useWatch({ control: form.control, name: "description" })
  const { errors, isSubmitting } = form.formState

  async function propose(values: { description: string }) {
    form.clearErrors("root")
    try {
      const out = await proposeCategories(values.description)
      setSource(out.source)
      flushSync(() => setProposal(withIds(out.categories)))
      // Recién llegada la propuesta, el foco cae en la lista (no al montar con el set precreado).
      document.getElementById(`${formId}-list`)?.focus()
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "No se pudieron proponer categorías"
      form.setError(
        e instanceof ApiError && e.status === 422 ? "description" : "root",
        { message }
      )
    }
  }

  function openEditor(target: Proposed | "new") {
    editorForm.reset(editorValues(target === "new" ? null : target))
    setEditing(target === "new" ? "new" : target.id)
    setEditorOpen(true)
  }

  // Al quitar, el foco pasa al «Quitar» que queda en su lugar, o a «Agregar categoría» si era el último.
  function remove(id: string) {
    const index = proposal?.findIndex((c) => c.id === id) ?? -1
    flushSync(() =>
      setProposal((list) => list?.filter((c) => c.id !== id) ?? null)
    )
    const next =
      listRef.current?.querySelectorAll<HTMLButtonElement>("[data-remove]")[
        index
      ]
    ;(next ?? addRef.current)?.focus()
  }

  function addExample(text: string) {
    const current = description.trim()
    const next = current ? `${current.replace(/[.\s]*$/, "")}. ${text}` : text
    form.setValue("description", next.slice(0, DESCRIPTION_MAX), {
      shouldDirty: true,
      shouldValidate: form.formState.isSubmitted,
    })
  }

  async function save() {
    if (!proposal) return
    setSaveError(null)
    // El esquema descarta change/reason: al PUT va solo la categoría.
    const parsed = applyCategoriesInput.safeParse({ categories: proposal })
    if (!parsed.success) {
      setSaveError(parsed.error.issues[0]?.message ?? "Revisa las categorías")
      return
    }
    setSaving(true)
    try {
      await saveCategories(parsed.data.categories)
      haptic("success")
      onSaved()
    } catch (e) {
      haptic("error")
      setSaveError(
        e instanceof Error ? e.message : "No se pudieron guardar las categorías"
      )
    } finally {
      setSaving(false)
    }
  }

  const editingValue =
    editing === null || editing === "new"
      ? null
      : (proposal?.find((c) => c.id === editing) ?? null)

  if (!proposal)
    return (
      <form
        id={formId}
        onSubmit={form.handleSubmit(propose)}
        noValidate
        className="flex flex-col gap-4"
      >
        {errors.root && (
          <p role="alert" className="text-subheadline text-destructive">
            {errors.root.message}
          </p>
        )}
        <FinanceField
          id={`${formId}-description`}
          label="Cuéntanos de tu día a día"
          error={errors.description?.message}
        >
          <Controller
            control={form.control}
            name="description"
            render={({ field }) => (
              <Textarea
                {...field}
                id={`${formId}-description`}
                rows={5}
                maxLength={DESCRIPTION_MAX}
                placeholder="Dónde compras, cómo te mueves, qué pagas cada mes…"
                aria-invalid={!!errors.description}
                aria-describedby={cn(
                  `${formId}-count`,
                  errors.description && `${formId}-description-error`
                )}
                className="min-h-32 resize-none"
              />
            )}
          />
        </FinanceField>
        <div className="-mt-2 flex items-start justify-between gap-3">
          <span className="sr-only">Ejemplos para agregar</span>
          <div className="-mx-1 flex min-w-0 flex-1 gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
            {EXAMPLES.map((text) => (
              <button
                key={text}
                type="button"
                onClick={() => addExample(text)}
                className="press inline-flex min-h-11 shrink-0 items-center gap-1 rounded-lg bg-secondary px-3 text-subheadline whitespace-nowrap"
              >
                <Plus aria-hidden className="size-3.5 text-muted-foreground" />
                {text}
              </button>
            ))}
          </div>
          <span
            id={`${formId}-count`}
            className="tabular shrink-0 pt-3 text-footnote text-muted-foreground"
          >
            {description.length}/{DESCRIPTION_MAX}
          </span>
        </div>
        <Button
          type="submit"
          form={formId}
          disabled={isSubmitting}
          aria-busy={isSubmitting || undefined}
          className="h-12 w-full text-body"
        >
          {isSubmitting ? (
            <Loader
              aria-hidden
              className="size-4 animate-spin motion-reduce:animate-none"
            />
          ) : (
            <Sparkles aria-hidden className="size-4" />
          )}
          {isSubmitting ? "Ordenando tus categorías…" : "Proponer categorías"}
        </Button>
        {isSubmitting && <ProposalSkeleton />}
      </form>
    )

  return (
    <div className="flex flex-col gap-4">
      {source === "default" && (
        <p className="text-footnote text-pretty text-muted-foreground">
          Este es el set precreado. Con{" "}
          <code className="text-footnote">OPENAI_API_KEY</code> la IA lo ajusta
          a tu vida.
        </p>
      )}
      <ul
        ref={listRef}
        id={`${formId}-list`}
        tabIndex={-1}
        aria-label="Categorías propuestas"
        className="sheet-group inset-list overflow-hidden rounded-xl outline-none"
      >
        {proposal.map((c, i) => (
          <li
            key={c.id}
            style={{ animationDelay: `${Math.min(i, 12) * 60}ms` }}
            className="flex animate-in items-start gap-3 px-4 py-3 duration-300 fill-mode-both fade-in-0 slide-in-from-bottom-2 motion-reduce:animate-none"
          >
            <span
              aria-hidden
              className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-full"
              style={{ backgroundColor: c.color + "26" }}
            >
              <CategoryIcon icon={c.icon} size={18} color={c.color} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-body font-medium">{c.name}</span>
                {c.type === "income" && (
                  <span className="text-footnote text-muted-foreground">
                    Ingreso
                  </span>
                )}
                {c.change !== "kept" && (
                  <span
                    className={cn(
                      "rounded-md px-1.5 py-0.5 text-caption font-semibold",
                      c.change === "added"
                        ? "bg-success/15 text-success"
                        : "bg-primary/10 text-primary"
                    )}
                  >
                    {CHANGE_LABEL[c.change]}
                  </span>
                )}
              </div>
              {c.reason && (
                <p className="mt-0.5 text-footnote text-pretty text-foreground">
                  {c.reason}
                </p>
              )}
              {c.description && (
                <p className="mt-0.5 line-clamp-2 text-footnote text-pretty text-muted-foreground">
                  {c.description}
                </p>
              )}
            </div>
            <div className="-my-1 -mr-2 flex shrink-0">
              <button
                type="button"
                onClick={() => openEditor(c)}
                className="press grid size-11 place-items-center rounded-full text-muted-foreground hover:text-foreground"
              >
                <Pencil aria-hidden className="size-4" />
                <span className="sr-only">Editar {c.name}</span>
              </button>
              <button
                type="button"
                data-remove
                onClick={() => remove(c.id)}
                className="press grid size-11 place-items-center rounded-full text-muted-foreground hover:text-destructive"
              >
                <X aria-hidden className="size-4" />
                <span className="sr-only">Quitar {c.name}</span>
              </button>
            </div>
          </li>
        ))}
      </ul>
      <button
        ref={addRef}
        type="button"
        onClick={() => openEditor("new")}
        className="press inline-flex min-h-11 items-center gap-1.5 self-start px-1 text-body text-primary"
      >
        <Plus aria-hidden className="size-4" />
        Agregar categoría
      </button>
      {saveError && (
        <p role="alert" className="text-subheadline text-destructive">
          {saveError}
        </p>
      )}
      <Button
        type="button"
        onClick={save}
        disabled={saving || proposal.length === 0}
        aria-busy={saving || undefined}
        className="h-12 w-full text-body"
      >
        {saving && (
          <Loader
            aria-hidden
            className="size-4 animate-spin motion-reduce:animate-none"
          />
        )}
        Guardar categorías
      </Button>

      <CategoryEditor
        form={editorForm}
        open={editorOpen}
        category={editingValue}
        onOpenChange={setEditorOpen}
        onSubmit={(value) => {
          setProposal((list) => {
            if (!list) return list
            if (editing === "new")
              return [
                ...list,
                {
                  ...value,
                  id: crypto.randomUUID(),
                  change: "added",
                  reason: null,
                },
              ]
            return list.map((c) =>
              c.id === editing
                ? {
                    ...value,
                    id: c.id,
                    change: c.change === "added" ? "added" : "edited",
                    reason: c.reason,
                  }
                : c
            )
          })
          setEditorOpen(false)
        }}
      />
    </div>
  )
}

// Lo que se ve mientras la IA piensa: filas fantasma que laten, en el mismo lugar donde caerán.
function ProposalSkeleton() {
  return (
    <div
      role="status"
      className="sheet-group inset-list overflow-hidden rounded-xl"
    >
      <span className="sr-only">Proponiendo categorías</span>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3">
          <span className="size-9 shrink-0 animate-pulse rounded-full bg-muted motion-reduce:animate-none" />
          <div className="flex-1 space-y-2">
            <span
              className="block h-3 animate-pulse rounded-md bg-muted motion-reduce:animate-none"
              style={{ width: `${40 + ((i * 17) % 35)}%` }}
            />
            <span className="block h-2.5 w-4/5 animate-pulse rounded-md bg-muted/70 motion-reduce:animate-none" />
          </div>
        </div>
      ))}
    </div>
  )
}

// Editor local de una categoría propuesta: no escribe en la API (eso pasa al «Guardar categorías»).
// CategoryModal no calza: crea en /api/categories y fija topes del mes.
function CategoryEditor({
  form,
  open,
  category,
  onOpenChange,
  onSubmit,
}: {
  form: ReturnType<typeof useEditorForm>
  open: boolean
  category: OnboardingCategory | null
  onOpenChange: (open: boolean) => void
  onSubmit: (value: OnboardingCategory) => void
}) {
  const formId = `onb-category-${useId()}`
  const [type, icon, color] = useWatch({
    control: form.control,
    name: ["type", "icon", "color"],
  })
  const { errors, isDirty } = form.formState

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title={category ? "Editar categoría" : "Nueva categoría"}
      primary={{
        label: category ? "Listo" : "Agregar",
        form: formId,
        disabled: !!category && !isDirty,
      }}
      cancel={{ label: "Cancelar", onClick: () => onOpenChange(false) }}
    >
      <form
        id={formId}
        noValidate
        onSubmit={form.handleSubmit((v) =>
          onSubmit({ ...v, description: v.description?.trim() || null })
        )}
        className="flex flex-col gap-6"
      >
        <FinanceField
          id={`${formId}-name`}
          label="Nombre"
          error={errors.name?.message}
        >
          <Input
            id={`${formId}-name`}
            maxLength={40}
            autoComplete="off"
            aria-invalid={!!errors.name}
            aria-describedby={errors.name ? `${formId}-name-error` : undefined}
            {...form.register("name")}
          />
        </FinanceField>
        <Segmented
          label="Tipo"
          value={type}
          options={[
            { value: "expense", label: "Gasto" },
            { value: "income", label: "Ingreso" },
          ]}
          onChange={(v) => form.setValue("type", v, { shouldDirty: true })}
        />
        <CategoryAppearancePicker
          icon={icon}
          color={color}
          onIconChange={(name) =>
            form.setValue("icon", name, { shouldDirty: true })
          }
          onColorChange={(value) =>
            form.setValue("color", value, { shouldDirty: true })
          }
        />
        <FinanceField
          id={`${formId}-description`}
          label="Descripción para la IA"
          error={errors.description?.message}
          hint="Comercios que aparecen en tu banco: ayuda a clasificar."
        >
          <Controller
            control={form.control}
            name="description"
            render={({ field }) => (
              <Textarea
                id={`${formId}-description`}
                rows={3}
                maxLength={400}
                value={field.value ?? ""}
                onChange={(e) => field.onChange(e.target.value)}
                onBlur={field.onBlur}
                aria-invalid={!!errors.description}
                aria-describedby={cn(
                  `${formId}-description-hint`,
                  errors.description && `${formId}-description-error`
                )}
              />
            )}
          />
        </FinanceField>
      </form>
    </ResponsiveModal>
  )
}
