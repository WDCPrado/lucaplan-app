"use client"

import { useState } from "react"
import { Loader } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

// Paso de aprendizaje tras categorizar a mano: pregunta el "porqué" (opcional) y ofrece propagar la
// categoría a los N movimientos con la misma descripción. La categoría YA quedó persistida por el
// caller (PATCH); este paso solo dispara el follow-up de aprendizaje vía `onFinish`. Compartido por
// el modal de transacción y el triage de pendientes para no duplicar la UI ni el copy.
//
// `learnedCategoryName`: esta descripción ya tenía OTRA categoría aprendida y no se pisó. Aquí se
// decide qué era este cambio — la regla nueva (aplicar a los demás) o una excepción (solo este).
export function CorrectionLearnStep({
  description,
  sameTextCount,
  learnedCategoryName,
  saving,
  onFinish,
}: {
  description: string
  sameTextCount: number
  learnedCategoryName?: string | null
  saving: boolean
  onFinish: (opts: { note: string; applyToSameText: boolean }) => void
}) {
  const [note, setNote] = useState("")
  // Qué botón se tocó: el spinner va en ese, con su texto intacto (es su nombre accesible).
  const [chosen, setChosen] = useState<boolean | null>(null)
  const n = sameTextCount
  const finish = (applyToSameText: boolean) => {
    setChosen(applyToSameText)
    onFinish({ note, applyToSameText })
  }
  const spinner = (apply: boolean) =>
    saving && chosen === apply ? (
      <Loader aria-hidden className="size-5 animate-spin motion-reduce:animate-none" />
    ) : null

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <p className="text-title font-semibold">Categoría guardada</p>
        <p className="text-callout break-words text-ink-2">{description}</p>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="correction-note">
          ¿Qué es este movimiento? (opcional)
        </Label>
        <Input
          id="correction-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={120}
          placeholder="Ej.: pedidos de comida a domicilio"
          inputMode="text"
          aria-describedby="correction-note-hint"
        />
        <p id="correction-note-hint" className="text-caption text-ink-3">
          Tu explicación queda guardada y la IA la usa para clasificar los
          próximos movimientos parecidos.
        </p>
      </div>

      {learnedCategoryName && (
        <p className="rounded-lg bg-secondary px-4 py-3 text-callout text-ink-2">
          Esta descripción venía clasificándose como{" "}
          <span className="font-semibold text-foreground">
            {learnedCategoryName}
          </span>
          . Si fue una excepción, elige «Solo este» y los próximos seguirán
          yendo ahí.
        </p>
      )}

      <div className="flex flex-col gap-2">
        {(n > 0 || learnedCategoryName) && (
          <Button
            onClick={() => finish(true)}
            disabled={saving}
            aria-busy={(saving && chosen === true) || undefined}
            className="h-auto min-h-(--ctl) py-2.5 whitespace-normal"
          >
            {spinner(true)}
            {n > 0
              ? `Aplicar a los ${n} con esta descripción`
              : "Usar esta categoría de aquí en adelante"}
          </Button>
        )}
        <Button
          variant={n > 0 || learnedCategoryName ? "secondary" : "default"}
          onClick={() => finish(false)}
          disabled={saving}
          aria-busy={(saving && chosen === false) || undefined}
        >
          {spinner(false)}
          {n > 0 || learnedCategoryName ? "Solo este" : "Listo"}
        </Button>
      </div>
    </div>
  )
}
