"use client"

import { useEffect, useId, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { ModalSection } from "@/components/ui/responsive-modal"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { haptic } from "@/lib/haptics"
import type { TransactionDTO } from "@/arch/v1/application/finance-use-cases/finance-read"
import { linkCreditToIncomeSource, listIncomeSources, type IncomeSourceDTO } from "./http"

const NONE = "none"

/**
 * «Ingreso programado» de un abono (WDC-185): dice de qué programado es (el sueldo de octubre) o
 * ninguno. Solo en abonos de ingreso confirmados y no internos. Cambiar el valor guarda al tiro.
 */
export function IncomeSourceLink({
  tx,
}: {
  tx: TransactionDTO
}) {
  const router = useRouter()
  const fieldId = `income-source-${useId()}`
  const eligible =
    tx.direction === "credit" &&
    tx.status === "confirmed" &&
    !tx.isInternal &&
    tx.creditKind === "income" &&
    (tx.currency === "CLP" || tx.currency === "USD")
  // `tx` es una foto que el refresh no actualiza: el vínculo vigente vive aquí.
  const [value, setValue] = useState(tx.incomeSourceId ?? null)
  const [sources, setSources] = useState<IncomeSourceDTO[] | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Efecto genuino: leer los programados al abrir el abono (no hay render del servidor aquí).
  useEffect(() => {
    if (!eligible) return
    const controller = new AbortController()
    listIncomeSources(null, controller.signal)
      .then(setSources)
      .catch(() => {
        /* El modal sigue utilizable aunque falle la consulta. */
      })
    return () => controller.abort()
  }, [eligible])

  if (!eligible) return null
  const options = (sources ?? []).filter((s) => s.currency === tx.currency || s.id === value)
  // Sin programados de esta moneda y sin vínculo, la sección no aporta nada.
  if (sources && options.length === 0 && !value) return null

  async function change(next: string) {
    const id = next === NONE ? null : next
    if (id === value || saving) return
    const previous = value
    setValue(id)
    setSaving(true)
    setError(null)
    try {
      await linkCreditToIncomeSource(tx.id, id)
      haptic("success")
      toast.success(
        id ? `Abono vinculado a ${options.find((s) => s.id === id)?.name ?? "el programado"}` : "Abono sin ingreso programado"
      )
      router.refresh()
    } catch (e) {
      haptic("error")
      setValue(previous)
      setError(e instanceof Error ? e.message : "No se pudo cambiar el ingreso programado del abono.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mb-6 px-5">
      <ModalSection
        title={<label htmlFor={fieldId}>Ingreso programado</label>}
        footer={
          error ? (
            <span id={`${fieldId}-error`} role="alert" className="text-destructive">
              {error}
            </span>
          ) : (
            "Si este abono es tu sueldo u otro ingreso programado, vincúlalo: el plan deja de esperarlo."
          )
        }
      >
        <div className="px-4 py-2">
          <Select value={value ?? NONE} onValueChange={change} disabled={saving || sources === null}>
            <SelectTrigger
              id={fieldId}
              aria-invalid={!!error}
              aria-describedby={error ? `${fieldId}-error` : undefined}
              aria-busy={saving || undefined}
              className="h-11! w-full text-body"
            >
              <SelectValue placeholder={sources === null ? "Cargando…" : "Ninguno"} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Ninguno</SelectItem>
              {options.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </ModalSection>
    </div>
  )
}
