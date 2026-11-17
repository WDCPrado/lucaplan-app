"use client"

import { useEffect, useId, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Controller, useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { ChevronRight, Plus } from "lucide-react"
import { toast } from "sonner"

import { ResponsiveModal } from "@/components/ui/responsive-modal"
import { SearchInput } from "@/components/ui/search-input"
import { haptic } from "@/lib/haptics"
import { formatCLP } from "@/lib/finance-format"
import type { TransactionDTO } from "@/arch/v1/application/finance-use-cases/finance-read"
import { linkReimbursementSchema } from "@/lib/schemas/reimbursement"
import { FinanceField, MoneyFormInput } from "../finance-form-field"
import {
  linkReimbursement,
  listReimbursementCandidates,
  listReimbursements,
  unlinkReimbursement,
  type ReimbursementCandidate,
  type ReimbursementLink,
} from "./http"

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString("es-CL", {
    day: "numeric",
    month: "short",
    timeZone: "UTC", // @db.Date es medianoche UTC
  })

const errorText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback)

/**
 * Reembolsos de un movimiento (WDC-184). En un abono CLP confirmado y no interno: «Es reembolso»
 * elige el gasto que devuelve y cuánto. En abono y gasto: cada vínculo con su «Deshacer».
 * Los vínculos se leen aquí y no del DTO: el `tx` del modal es una foto que el refresh no actualiza.
 */
export function ReimbursementSection({
  tx,
  onOpenRelated,
}: {
  tx: TransactionDTO
  onOpenRelated: (tx: TransactionDTO) => void
}) {
  const router = useRouter()
  const [links, setLinks] = useState<ReimbursementLink[]>([])
  // Sube con cada vínculo creado o deshecho: vuelve a leer aunque el DTO diga 0 vínculos.
  const [version, setVersion] = useState(0)
  const [picking, setPicking] = useState(false)
  const [undoing, setUndoing] = useState<string | null>(null)

  const isCredit = tx.direction === "credit"
  const canLink =
    isCredit && tx.currency === "CLP" && tx.status === "confirmed" && !tx.isInternal &&
    tx.creditKind !== "reversal"
  const linked = links.reduce((sum, l) => sum + l.amount, 0)

  // Efecto genuino: leer de la API al abrir el movimiento (no hay render del servidor aquí).
  useEffect(() => {
    if (!tx.reimbursementCount && version === 0) return
    const controller = new AbortController()
    listReimbursements(tx.id, controller.signal)
      .then((l) => setLinks(l))
      .catch(() => {
        /* El modal sigue utilizable aunque falle la consulta de vínculos. */
      })
    return () => controller.abort()
  }, [tx.id, tx.reimbursementCount, version])

  async function undo(link: ReimbursementLink) {
    if (undoing) return
    setUndoing(link.id)
    try {
      await unlinkReimbursement(tx.id, link.id)
      haptic("success")
      toast.success("Vínculo deshecho")
      setLinks((ls) => ls.filter((l) => l.id !== link.id))
      setVersion((v) => v + 1)
      router.refresh()
    } catch (e) {
      haptic("error")
      toast.error(errorText(e, "No se pudo deshacer el vínculo."))
    } finally {
      setUndoing(null)
    }
  }

  if (!links.length && !canLink) return null

  return (
    <section className="flex min-w-0 flex-col gap-2">
      <h3 className="text-callout font-semibold text-ink-2">Reembolso</h3>
      <div className="-mx-3 flex flex-col gap-1">
        {links.map((link) => (
          <div key={link.id} className="flex min-h-12 items-center gap-1">
            <button
              type="button"
              onClick={() => onOpenRelated(link.transaction)}
              className="press flex min-h-12 min-w-0 flex-1 items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-secondary"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-body">
                  {isCredit ? "Devuelve " : "Te devolvieron "}
                  <span className="font-semibold whitespace-nowrap">{formatCLP(link.amount)}</span>
                  {isCredit ? " de " : " con "}
                  <span className="break-words">{link.transaction.description}</span>
                </span>
                <span className="block text-caption text-ink-3">
                  {shortDate(link.transaction.date)}
                </span>
              </span>
              <ChevronRight aria-hidden className="size-4 shrink-0 text-ink-3" />
            </button>
            <button
              type="button"
              onClick={() => undo(link)}
              disabled={undoing !== null}
              aria-busy={undoing === link.id || undefined}
              aria-label={`Deshacer vínculo con ${link.transaction.description}`}
              className="press flex min-h-11 shrink-0 items-center rounded-md px-3 text-callout font-semibold text-primary hover:bg-primary-soft disabled:opacity-45"
            >
              {undoing === link.id ? "Deshaciendo…" : "Deshacer"}
            </button>
          </div>
        ))}
        {canLink && linked < tx.amount && (
          <button
            type="button"
            onClick={() => setPicking(true)}
            className="press flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-left hover:bg-secondary"
          >
            <Plus aria-hidden className="size-5 shrink-0 text-ink-2" />
            <span className="min-w-0 flex-1 text-body">
              {links.length ? "Vincular otro gasto" : "Es reembolso"}
            </span>
            <ChevronRight aria-hidden className="size-4 shrink-0 text-ink-3" />
          </button>
        )}
      </div>
      {canLink && !links.length && (
        <p className="text-caption text-ink-3">
          Si este abono te devuelve un gasto, vincúlalo: deja de contar como ingreso y el gasto baja.
        </p>
      )}
      {canLink && (
        <ReimbursementPicker
          key={`${tx.id}-${version}`}
          creditId={tx.id}
          open={picking}
          onOpenChange={setPicking}
          onLinked={() => {
            setPicking(false)
            setVersion((v) => v + 1)
            router.refresh()
          }}
        />
      )}
    </section>
  )
}

/** Paso «¿Qué gasto devuelve?»: lista con búsqueda y, al elegir uno, el monto a vincular. */
function ReimbursementPicker({
  creditId,
  open,
  onOpenChange,
  onLinked,
}: {
  creditId: string
  open: boolean
  onOpenChange: (o: boolean) => void
  onLinked: () => void
}) {
  const [data, setData] = useState<{ creditFree: number; candidates: ReimbursementCandidate[] } | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const [query, setQuery] = useState("")
  const [chosen, setChosen] = useState<ReimbursementCandidate | null>(null)
  const [saving, setSaving] = useState(false)
  const formId = useId()

  // Efecto genuino: leer candidatos al abrir el paso.
  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    listReimbursementCandidates(creditId, controller.signal)
      .then((d) => {
        setLoadError(null)
        setData(d)
      })
      .catch((e) => {
        if (!controller.signal.aborted) setLoadError(errorText(e, "No se pudieron cargar los gastos."))
      })
    return () => controller.abort()
  }, [open, creditId, retry])

  const q = query.trim().toLowerCase()
  const candidates = (data?.candidates ?? []).filter(
    (c) => !q || c.description.toLowerCase().includes(q) || c.categoryName?.toLowerCase().includes(q)
  )

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={(o) => {
        if (!o) setChosen(null)
        onOpenChange(o)
      }}
      title={chosen ? "¿Cuánto devuelve?" : "¿Qué gasto devuelve?"}
      cancel={{
        label: chosen ? "Volver" : "Cancelar",
        disabled: saving,
        onClick: () => (chosen ? setChosen(null) : onOpenChange(false)),
      }}
      primary={
        chosen
          ? { label: saving ? "Vinculando…" : "Confirmar", form: formId, busy: saving }
          : undefined
      }
    >
      <div className="flex flex-col px-5 pb-4">
        {chosen && data ? (
          <AmountForm
            formId={formId}
            creditId={creditId}
            candidate={chosen}
            max={Math.min(data.creditFree, chosen.free)}
            onSavingChange={setSaving}
            onLinked={() => {
              setChosen(null)
              onLinked()
            }}
          />
        ) : (
          <>
            {loadError && (
              <div role="alert" className="mb-3 flex flex-wrap items-center gap-x-3 rounded-md bg-destructive-soft pl-3 text-callout text-destructive">
                <span className="min-w-0 flex-1 py-2">{loadError}</span>
                <button
                  type="button"
                  onClick={() => {
                    setLoadError(null)
                    setRetry((r) => r + 1)
                  }}
                  className="press min-h-11 rounded-md px-3 font-semibold"
                >
                  Reintentar
                </button>
              </div>
            )}
            {data && data.creditFree > 0 && (
              <p className="pb-3 text-callout text-ink-2">
                Este abono tiene <span className="font-semibold whitespace-nowrap">{formatCLP(data.creditFree)}</span> por
                vincular. Elige el gasto que te devuelve.
              </p>
            )}
            <div className="mb-2">
              <SearchInput
                value={query}
                onValueChange={setQuery}
                placeholder="Buscar gasto"
                aria-label="Buscar gasto"
              />
            </div>
            {data === null ? (
              !loadError && (
                <p className="py-8 text-callout text-ink-2">
                  Buscando gastos…
                </p>
              )
            ) : candidates.length === 0 ? (
              <p className="py-8 text-callout text-ink-2">
                {q ? "Ningún gasto calza con la búsqueda." : "No hay gastos con saldo para devolver"}
              </p>
            ) : (
              <ul className="-mx-3 flex flex-col gap-1">
                {candidates.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => setChosen(c)}
                      disabled={data.creditFree <= 0}
                      className="press flex min-h-14 w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-secondary disabled:opacity-45"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">{c.description}</span>
                        <span className="block truncate text-callout text-ink-2">
                          {shortDate(c.date)}
                          {c.categoryName && ` · ${c.categoryName}`}
                        </span>
                      </span>
                      <span className="flex shrink-0 flex-col items-end text-right whitespace-nowrap">
                        <span className="font-semibold">{formatCLP(c.amount)}</span>
                        {c.free < c.amount && (
                          <span className="text-caption text-ink-3">
                            Por devolver {formatCLP(c.free)}
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </ResponsiveModal>
  )
}

function AmountForm({
  formId,
  creditId,
  candidate,
  max,
  onSavingChange,
  onLinked,
}: {
  formId: string
  creditId: string
  candidate: ReimbursementCandidate
  max: number
  onSavingChange: (s: boolean) => void
  onLinked: () => void
}) {
  const fieldId = `reimbursement-amount-${candidate.id}`
  // El esquema compartido del POST más el tope del abono y del gasto elegidos.
  const schema = useMemo(
    () =>
      z.object({
        amount: linkReimbursementSchema.shape.amount.max(max, `No puede pasar de ${formatCLP(max)}`),
      }),
    [max]
  )
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { amount: max },
  })
  const { errors } = form.formState

  async function submit({ amount }: { amount: number }) {
    form.clearErrors("root")
    onSavingChange(true)
    try {
      await linkReimbursement(creditId, { expenseId: candidate.id, amount })
      haptic("success")
      toast.success("Reembolso vinculado", {
        description: `${formatCLP(amount)} de ${candidate.description}`,
      })
      onLinked()
    } catch (e) {
      haptic("error")
      form.setError("root", { message: errorText(e, "No se pudo vincular el reembolso.") })
    } finally {
      onSavingChange(false)
    }
  }

  return (
    <form id={formId} onSubmit={form.handleSubmit(submit)} className="flex flex-col gap-6">
      {errors.root && (
        <p role="alert" className="rounded-md bg-destructive-soft px-3 py-2 text-callout text-destructive">
          {errors.root.message}
        </p>
      )}
      <div className="rounded-lg bg-secondary px-4 py-3">
        <p className="truncate font-semibold">{candidate.description}</p>
        <p className="text-callout text-ink-2">
          {shortDate(candidate.date)}
          {candidate.categoryName && ` · ${candidate.categoryName}`} ·{" "}
          <span className="whitespace-nowrap">{formatCLP(candidate.amount)}</span>
        </p>
      </div>
      <fieldset disabled={form.formState.isSubmitting} className="contents">
        <FinanceField
          id={fieldId}
          label="Monto que devuelve"
          error={errors.amount?.message}
          hint={`Hasta ${formatCLP(max)}: lo que le queda al abono o al gasto, lo menor.`}
        >
          <Controller
            name="amount"
            control={form.control}
            render={({ field }) => (
              <MoneyFormInput
                id={fieldId}
                name={field.name}
                ref={field.ref}
                value={field.value}
                // Bloquea al escribir: no deja pasar el tope del abono ni del gasto.
                onValueChange={(v) => field.onChange(Math.min(v, max))}
                onBlur={field.onBlur}
                aria-invalid={!!errors.amount}
                aria-describedby={`${fieldId}-${errors.amount ? "error" : "hint"}`}
              />
            )}
          />
        </FinanceField>
      </fieldset>
    </form>
  )
}
