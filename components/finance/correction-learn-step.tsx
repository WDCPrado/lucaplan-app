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
      <div className="flex flex-col items-center gap-1 pt-2 text-center">
        <div className="text-title-3 font-semibold">Categoría guardada</div>
        <div className="text-subheadline text-balance text-muted-foreground">
          {description}
        </div>
      </div>

      <div>
        <Label htmlFor="correction-note" className="mb-2 block">
          ¿Qué es este movimiento? (opcional)
        </Label>
        <Input
          id="correction-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={120}
          placeholder="Ej.: pedidos de comida a domicilio"
          inputMode="text"
          className="h-12"
        />
        <p className="mt-2 text-footnote text-muted-foreground">
          Tu explicación queda guardada y la IA la usa para clasificar los
          próximos movimientos parecidos.
        </p>
      </div>

      {learnedCategoryName && (
        <p className="sheet-group px-4 py-3 text-footnote text-muted-foreground">
          Esta descripción venía clasificándose como{" "}
          <span className="font-medium text-foreground">
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
            className="h-auto min-h-12 py-3 whitespace-normal"
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
          className="h-12"
        >
          {spinner(false)}
          {n > 0 || learnedCategoryName ? "Solo este" : "Listo"}
        </Button>
      </div>
    </div>
  )
}
