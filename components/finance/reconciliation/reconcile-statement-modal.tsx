"use client"

import * as React from "react"
import { useId, useState } from "react"
import { useRouter } from "next/navigation"
import { Controller, useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { toast } from "sonner"
import { ArrowRight, Check, FileText } from "lucide-react"
import { ModalSection, ResponsiveModal } from "@/components/ui/responsive-modal"
import { FinanceField } from "../finance-form-field"
import { IconTile } from "../blocks"
import {
  formatMoney,
  formatShortDateHeader,
  todayKey,
} from "@/lib/finance-format"
import { haptic } from "@/lib/haptics"
import { cn } from "@/lib/utils"
import type { CurrencyCode } from "@/arch/v1/domain/finance/money"
import {
  applyReconciliation,
  isStalePreview,
  previewReconciliation,
  readStatement,
  type ReconcileInput,
  type ReconciliationPreview,
  type ReconciliationProposal,
} from "./http"

const MAX_BYTES = 10 * 1024 * 1024
const ACCEPT = ".pdf,.xls,.xlsx,.csv"
const fileSchema = z.object({
  file: z
    .custom<File | null>()
    .refine((f): f is File => f instanceof File, "Elige la cartola")
    .refine((f) => !f || f.size <= MAX_BYTES, "El archivo pesa más de 10 MB")
    .refine(
      (f) => !f || /\.(pdf|xlsx?|csv)$/i.test(f.name),
      "Solo PDF, XLS, XLSX o CSV"
    ),
})

const KIND_LABEL: Record<string, string> = {
  income: "Ingreso",
  reimbursement: "Reembolso",
  reversal: "Reverso",
  overdraft_draw: "Uso de línea",
  overdraft_payment: "Pago de línea",
  own_transfer: "Traspaso propio",
  card_payment: "Pago de tarjeta",
}

// Por fila ambigua: el id del candidato elegido, "otro" (movimiento distinto de todos), "agregar"
// u "omitir" (reverso sin cargo).
type Decisions = Record<number, string>
type Ambiguous = ReconciliationProposal["ambiguous"][number]

export function snapshotLabel(iso: string) {
  return new Date(iso).toLocaleString("es-CL", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

const money = (amount: number, currency: string) =>
  formatMoney(amount, currency as CurrencyCode)

type Read = ReconciliationProposal
type Row = Read["rows"][number]
type Bucket = ReconciliationPreview["projectedBuckets"][number]

// Una cuota o un pago de tarjeta van por su propio flujo: no se deciden aquí ni bloquean Aplicar.
const needsDecision = (a: Ambiguous) =>
  a.reason === "multiple_candidates" || a.reason === "reversal_without_charge"

// La entrada propuesta (sin accountId, que va en la URL) más lo decidido en «Por decidir».
function withDecisions(proposal: Read, decisions: Decisions): ReconcileInput {
  const { accountId, ...input } = proposal.reconcileInput
  void accountId
  const additions = [...input.additions]
  const corrections = [...input.corrections]
  const includedSameDayIds = [...input.includedSameDayIds]
  const excluded = new Set(input.excludedSameDayIds ?? [])
  const picked = new Set<string>()
  const cutoffDay = todayKey(new Date(input.snapshotAt))
  for (const a of proposal.ambiguous) {
    const pick = decisions[a.rowIndex]
    const row = proposal.rows.find((r) => r.rowIndex === a.rowIndex)
    if (!row || pick === undefined || pick === "omitir") continue
    // «Es otro movimiento» / «Agregar como reverso»: el alta viene lista del servidor.
    if (pick === "otro" || pick === "agregar") {
      if (a.addition) additions.push(a.addition)
      continue
    }
    const c = a.candidates.find((x) => x.id === pick)
    if (!c) continue
    picked.add(c.id)
    // Un reverso no se corrige contra el cargo: entra como alta que anula el cargo elegido.
    if (row.kind === "reversal") {
      if (a.addition) additions.push({ ...a.addition, reversalOfId: c.id })
      continue
    }
    // Elegido con otro importe, moneda o fecha: se corrige con los datos de la cartola.
    if (
      c.amount !== row.amount ||
      c.currency !== row.currency ||
      c.date !== row.date
    )
      corrections.push({
        transactionId: c.id,
        date: row.date,
        description: c.description,
        amount: row.amount,
        currency: row.currency,
        categoryId: c.categoryId,
        evidence: `Fila ${row.rowIndex + 1} de la cartola: ${row.description}`,
      })
    // Queda con fecha del corte (par exacto o corregido a la fila): el documento ya lo incluye.
    if (row.date === cutoffDay && !includedSameDayIds.includes(c.id))
      includedSameDayIds.push(c.id)
  }
  // Candidato del día del corte que nadie eligió: el documento no lo incluye (posterior al corte).
  for (const a of proposal.ambiguous)
    for (const c of a.candidates)
      if (c.date === cutoffDay && !picked.has(c.id) && !includedSameDayIds.includes(c.id))
        excluded.add(c.id)
  for (const id of picked) excluded.delete(id)
  const excludedSameDayIds = [...excluded]
  return {
    ...input,
    additions,
    corrections,
    includedSameDayIds,
    ...(excludedSameDayIds.length ? { excludedSameDayIds } : {}),
  }
}

export function ReconcileStatementModal({
  accountId,
  open,
  onOpenChange,
}: {
  accountId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const formId = `statement-${useId()}`
  const fieldId = `${formId}-file`
  const form = useForm({
    resolver: zodResolver(fileSchema),
    defaultValues: { file: null },
  })
  const { errors, isSubmitting } = form.formState
  const [read, setRead] = useState<Read | null>(null)
  const [preview, setPreview] = useState<ReconciliationPreview | null>(null)
  const [decisions, setDecisions] = useState<Decisions>({})
  const [busy, setBusy] = useState<"preview" | "apply" | null>(null)
  const [error, setError] = useState<string | null>(null)

  function reset() {
    form.reset()
    setRead(null)
    setPreview(null)
    setDecisions({})
    setBusy(null)
    setError(null)
  }
  function close() {
    reset()
    onOpenChange(false)
  }
  const fail = (e: unknown, fallback: string) => {
    haptic("error")
    setError(e instanceof Error ? e.message : fallback)
  }

  async function readFile({ file }: { file: File | null }) {
    if (!file) return
    setError(null)
    let next: Read
    try {
      next = await readStatement(accountId, file)
    } catch (e) {
      return fail(e, "No se pudo leer la cartola")
    }
    // La lectura (lenta, con IA) se conserva: si la previsualización falla, se reintenta solo esa.
    setRead(next)
    await runPreview(next, {})
  }

  // Previsualiza `proposal` con `next`; las decisiones solo se guardan si responde.
  async function runPreview(proposal: Read, next: Decisions) {
    setBusy("preview")
    setError(null)
    try {
      setPreview(
        await previewReconciliation(accountId, withDecisions(proposal, next))
      )
      setDecisions(next)
      return true
    } catch (e) {
      fail(e, "No se pudo previsualizar")
      return false
    } finally {
      setBusy(null)
    }
  }

  // Cada decisión cambia las altas o correcciones: se vuelve a previsualizar (token nuevo).
  function decide(rowIndex: number, value: string) {
    if (read && busy === null)
      void runPreview(read, { ...decisions, [rowIndex]: value })
  }

  async function apply() {
    if (!read || !preview) return
    setBusy("apply")
    setError(null)
    try {
      if (!preview.previewToken)
        throw new Error("Falta la previsualización; vuelve a leer la cartola")
      const applied = await applyReconciliation(
        accountId,
        withDecisions(read, decisions),
        preview.previewToken
      )
      haptic("success")
      toast.success(
        `Conciliada hasta ${snapshotLabel(applied.reconciledUntil ?? preview.snapshotAt)}`,
        {
          description: summary(applied),
        }
      )
      close()
      router.refresh()
    } catch (e) {
      setBusy(null)
      if (!isStalePreview(e))
        return fail(e, "No se pudo aplicar la conciliación")
      // Otro cambio en la cuenta dejó viejo el token: nueva propuesta con lo ya decidido.
      if (await runPreview(read, decisions))
        setError("La cuenta cambió; revisa la nueva propuesta")
    }
  }

  const pending = read
    ? read.ambiguous.filter(
        (a) => needsDecision(a) && decisions[a.rowIndex] === undefined
      ).length
    : 0

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      title="Conciliar cartola"
      className={preview ? undefined : "sm:max-w-md"}
      dismissible={busy === null && !isSubmitting}
      cancel={{
        label: "Cancelar",
        disabled: busy !== null || isSubmitting,
        onClick: close,
      }}
      primary={
        preview
          ? {
              label: busy === "apply" ? "Aplicando…" : "Aplicar",
              onClick: apply,
              busy: busy === "apply",
              disabled: busy !== null || pending > 0,
            }
          : read
            ? {
                label: busy === "preview" ? "Previsualizando…" : "Reintentar",
                onClick: () => void runPreview(read, decisions),
                busy: busy === "preview",
                disabled: busy !== null,
              }
            : {
                label: isSubmitting ? "Leyendo…" : "Leer cartola",
                plain: true,
                form: formId,
                busy: isSubmitting,
              }
      }
    >
      <div className="flex flex-col gap-6 px-4 pb-6 md:px-6">
        {error && (
          <p
            role="alert"
            className="rounded-md bg-destructive-soft px-3 py-2.5 text-callout text-destructive"
          >
            {error}
          </p>
        )}
        {read && !preview ? (
          <p
            role="status"
            className="rounded-md bg-secondary px-3 py-3 text-callout text-ink-2"
          >
            {busy === "preview"
              ? "Cartola leída. Preparando la propuesta…"
              : "La cartola ya está leída; solo falta la propuesta. Reintenta sin volver a subirla."}
          </p>
        ) : !preview || !read ? (
          <form
            id={formId}
            onSubmit={form.handleSubmit(readFile)}
            className="flex flex-col gap-4"
          >
            <FinanceField
              id={fieldId}
              label="Cartola del banco"
              error={errors.file?.message}
              hint="PDF, XLS, XLSX o CSV de hasta 10 MB. Lo anterior a la última conciliación no se vuelve a procesar. El archivo no se guarda."
            >
              <Controller
                name="file"
                control={form.control}
                render={({ field }) => (
                  <label
                    htmlFor={fieldId}
                    className={cn(
                      "sheet-group press flex min-h-14 cursor-pointer items-center gap-3 rounded-lg px-3 py-2 hover:bg-surface-3 focus-within:outline-2 focus-within:outline-ring",
                      errors.file && "outline-2 outline-destructive"
                    )}
                  >
                    <IconTile>
                      <FileText aria-hidden />
                    </IconTile>
                    <span
                      className={cn(
                        "min-w-0 flex-1 truncate",
                        field.value ? "font-semibold" : "text-primary font-semibold"
                      )}
                    >
                      {field.value?.name ?? "Elegir archivo"}
                    </span>
                    {field.value && (
                      <span className="shrink-0 text-caption whitespace-nowrap text-ink-3">
                        {(field.value.size / 1024 / 1024).toFixed(1)} MB
                      </span>
                    )}
                    <input
                      id={fieldId}
                      ref={field.ref}
                      name={field.name}
                      type="file"
                      accept={ACCEPT}
                      className="sr-only"
                      disabled={isSubmitting}
                      aria-invalid={!!errors.file}
                      aria-describedby={`${fieldId}-${errors.file ? "error" : "hint"}`}
                      onBlur={field.onBlur}
                      onChange={(e) =>
                        field.onChange(e.target.files?.[0] ?? null)
                      }
                    />
                  </label>
                )}
              />
            </FinanceField>
          </form>
        ) : (
          <Review
            read={read}
            preview={preview}
            decisions={decisions}
            disabled={busy !== null}
            onDecide={decide}
          />
        )}
      </div>
    </ResponsiveModal>
  )
}

// Título de sección con cuántas filas trae, en tinta 3: se lee el tamaño de cada grupo sin contarlo.
function CountTitle({ label, count }: { label: string; count: number }) {
  return (
    <span className="flex items-baseline gap-2">
      {label}
      <span className="font-normal text-ink-3 tabular-nums">{count}</span>
    </span>
  )
}

function summary(p: ReconciliationPreview) {
  const parts = [
    [p.additions.length, "agregado", "agregados"],
    [p.corrections.length, "corregido", "corregidos"],
    [p.retentions.length, "retención anulada", "retenciones anuladas"],
  ] as const
  return (
    parts
      .filter(([n]) => n > 0)
      .map(([n, one, many]) => `${n} ${n === 1 ? one : many}`)
      .join(" · ") || "Sin cambios en los movimientos"
  )
}

function Review({
  read: proposal,
  preview,
  decisions,
  disabled,
  onDecide,
}: {
  read: Read
  preview: ReconciliationPreview
  decisions: Decisions
  disabled: boolean
  onDecide: (rowIndex: number, value: string) => void
}) {
  return (
    <>
      <ModalSection
        title="Saldos"
        footer={`Al corte del ${snapshotLabel(preview.snapshotAt)}.${
          proposal.skippedBeforeCutoff === 1
            ? " 1 fila anterior ya estaba conciliada."
            : proposal.skippedBeforeCutoff > 1
              ? ` ${proposal.skippedBeforeCutoff} filas anteriores ya estaban conciliadas.`
              : ""
        }`}
      >
        {preview.projectedBuckets.map((after) => (
          <BucketRow
            key={after.kind}
            before={preview.beforeBuckets.find((b) => b.kind === after.kind)}
            after={after}
          />
        ))}
      </ModalSection>

      {proposal.ambiguous.length > 0 && (
        <ModalSection
          title={<CountTitle label="Por decidir" count={proposal.ambiguous.length} />}
          footer="Filas de la cartola que no se pueden emparejar solas. Aplicar se habilita cuando decides cada una."
        >
          {proposal.ambiguous.map((a) => (
            <AmbiguousRow
              key={a.rowIndex}
              item={a}
              row={proposal.rows.find((r) => r.rowIndex === a.rowIndex)}
              value={decisions[a.rowIndex]}
              disabled={disabled}
              onDecide={(v) => onDecide(a.rowIndex, v)}
            />
          ))}
        </ModalSection>
      )}

      {(proposal.skipped ?? []).length > 0 && (
        <ModalSection
          title={<CountTitle label="Quedan fuera" count={(proposal.skipped ?? []).length} />}
          footer="Filas que esta cuenta no puede conciliar. No impiden aplicar el resto."
        >
          {(proposal.skipped ?? []).map((s, i) => {
            const row = proposal.rows.find((r) => r.rowIndex === s.rowIndex)
            return row ? (
              <MovementLine
                key={i}
                date={row.date}
                description={row.description}
                tag={s.detail}
                amount={money(row.amount, row.currency)}
                credit={row.direction === "credit"}
              />
            ) : (
              <p key={i} className="px-4 py-3 text-body">
                {s.detail}
              </p>
            )
          })}
        </ModalSection>
      )}

      {preview.additions.length > 0 && (
        <ModalSection
          title={<CountTitle label="Se agregan" count={preview.additions.length} />}
        >
          {preview.additions.map((a, i) => (
            <MovementLine
              key={i}
              date={a.date}
              description={a.description}
              tag={KIND_LABEL[a.creditKind ?? a.internalKind ?? ""] ?? "Cargo"}
              amount={money(a.amount, a.currency)}
              credit={a.direction === "credit"}
            />
          ))}
        </ModalSection>
      )}

      {preview.corrections.length > 0 && (
        <ModalSection
          title={<CountTitle label="Se corrigen" count={preview.corrections.length} />}
        >
          {preview.corrections.map(({ before, after }) => (
            <MovementLine
              key={after.id}
              date={after.date}
              description={after.description}
              tag={
                before.date !== after.date
                  ? `Fecha ${formatShortDateHeader(before.date)} → ${formatShortDateHeader(after.date)}`
                  : undefined
              }
              amount={
                <span className="inline-flex flex-wrap items-center justify-end gap-x-1.5">
                  <span className="text-muted-foreground line-through">
                    {money(before.amount, before.currency)}
                  </span>
                  <ArrowRight
                    aria-label="pasa a"
                    className="size-3.5 text-muted-foreground"
                  />
                  <span>{money(after.amount, after.currency)}</span>
                </span>
              }
            />
          ))}
        </ModalSection>
      )}

      {preview.retentions.length > 0 && (
        <ModalSection
          title={
            <CountTitle
              label="Retenciones que se anulan"
              count={preview.retentions.length}
            />
          }
          footer="Cargos avisados por correo que la cartola no trae. Quedan anulados, no se borran."
        >
          {preview.retentions.map(({ before }) => (
            <MovementLine
              key={before.id}
              date={before.date}
              description={before.description}
              amount={
                <span className="text-muted-foreground line-through">
                  {money(before.amount, before.currency)}
                </span>
              }
            />
          ))}
        </ModalSection>
      )}

      {preview.additions.length +
        preview.corrections.length +
        preview.retentions.length ===
        0 &&
        proposal.ambiguous.length === 0 && (
          <p
            role="status"
            className="rounded-md bg-primary-soft px-3 py-3 text-callout text-primary"
          >
            Los movimientos ya coinciden con la cartola. Aplicar deja la cuenta
            conciliada hasta este corte.
          </p>
        )}
    </>
  )
}

const BUCKET_LABEL: Record<Bucket["kind"], string> = {
  cash: "Caja",
  overdraft: "Línea de crédito usada",
  credit_national: "Cupo nacional disponible",
  credit_international: "Cupo internacional disponible",
}

// Cada bucket en su moneda: caja = disponible; línea = usado de total; cupos = disponible de total.
function bucketValue(b: Bucket) {
  if (b.kind === "cash") return money(b.available, b.currency)
  if (b.kind === "overdraft") return money(b.used, b.currency)
  return money(b.available, b.currency)
}

function BucketRow({ before, after }: { before?: Bucket; after: Bucket }) {
  const changed = !before || bucketValue(before) !== bucketValue(after)
  return (
    <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3">
      <span className="text-ink-2">{BUCKET_LABEL[after.kind]}</span>
      <span className="ml-auto flex flex-wrap items-center justify-end gap-x-1.5 whitespace-nowrap tabular-nums">
        {before && changed && (
          <>
            <span className="text-muted-foreground">{bucketValue(before)}</span>
            <ArrowRight
              aria-label="pasa a"
              className="size-3.5 text-muted-foreground"
            />
          </>
        )}
        <span className="font-semibold">{bucketValue(after)}</span>
        {after.kind !== "cash" && (
          <span className="text-muted-foreground">
            de {money(after.limit, after.currency)}
          </span>
        )}
      </span>
    </div>
  )
}

function MovementLine({
  date,
  description,
  tag,
  amount,
  credit,
}: {
  date: string
  description: string
  tag?: string
  amount: React.ReactNode
  credit?: boolean
}) {
  return (
    <div className="flex min-h-11 items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">{description}</p>
        <p className="text-callout text-ink-2">
          {formatShortDateHeader(date)}
          {tag && ` · ${tag}`}
        </p>
      </div>
      <span
        className={cn(
          "shrink-0 text-right font-semibold whitespace-nowrap tabular-nums",
          credit && "text-success"
        )}
      >
        {credit && typeof amount === "string" ? `+${amount}` : amount}
      </span>
    </div>
  )
}

function AmbiguousRow({
  item,
  row,
  value,
  disabled,
  onDecide,
}: {
  item: Ambiguous
  row: Row | undefined
  value: string | undefined
  disabled: boolean
  onDecide: (value: string) => void
}) {
  if (!row) return null
  const options =
    item.reason === "multiple_candidates"
      ? [
          ...item.candidates.map((c) => ({
            value: c.id,
            label: c.description,
            detail: `${formatShortDateHeader(c.date)} · ${money(c.amount, c.currency)}`,
          })),
          ...(item.addition
            ? [
                {
                  value: "otro",
                  label: "Es otro movimiento",
                  detail: "Se agrega como movimiento nuevo",
                },
              ]
            : []),
        ]
      : item.reason === "reversal_without_charge"
        ? [
            ...(item.addition
              ? [
                  {
                    value: "agregar",
                    label: "Agregar como reverso",
                    detail: "No hay un cargo que anular; entra como abono",
                  },
                ]
              : []),
            {
              value: "omitir",
              label: "No agregar",
              detail: "La fila queda fuera de esta conciliación",
            },
          ]
        : []
  const hint =
    item.reason === "multiple_candidates"
      ? "Puede ser cualquiera de estos movimientos"
      : item.reason === "reversal_without_charge"
        ? "Reverso sin cargo que anular"
        : item.reason === "card_payment"
          ? "Pago de tarjeta: va por su propio flujo"
          : "Cuota: se salda desde su plan de cuotas"
  return (
    <div role="group" aria-label={row.description} className="py-1">
      <MovementLine
        date={row.date}
        description={row.description}
        tag={hint}
        amount={money(row.amount, row.currency)}
        credit={row.direction === "credit"}
      />
      {options.length > 0 && (
        // Botones con aria-pressed (no radios): cada elección previsualiza, y las flechas de un
        // radiogroup dispararían una previsualización por tecla. aria-disabled y no `disabled`
        // mientras previsualiza, para no perder el foco.
        <div className="flex flex-col gap-1 px-2 pb-2">
          {options.map((o) => {
            const selected = value === o.value
            return (
              <button
                key={o.value}
                type="button"
                aria-pressed={selected}
                aria-disabled={disabled || undefined}
                onClick={() => !disabled && onDecide(o.value)}
                className={cn(
                  "press flex min-h-11 items-center gap-3 rounded-md px-2 py-2 text-left focus-visible:outline-2 focus-visible:outline-ring aria-disabled:opacity-60",
                  selected
                    ? "bg-primary-soft text-primary"
                    : "hover:bg-surface-3"
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{o.label}</span>
                  <span
                    className={cn(
                      "block text-caption",
                      selected ? "text-primary" : "text-ink-3"
                    )}
                  >
                    {o.detail}
                  </span>
                </span>
                {/* La elegida lleva su marca además del tono. */}
                {selected && (
                  <Check aria-hidden className="size-4 shrink-0" strokeWidth={2.5} />
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
