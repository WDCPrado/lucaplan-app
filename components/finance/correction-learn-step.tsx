"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

// Paso de aprendizaje tras categorizar a mano: pregunta el "porqué" (opcional) y ofrece propagar la
// categoría a los N movimientos con la misma descripción. La categoría YA quedó persistida por el
// caller (PATCH); este paso solo dispara el follow-up de aprendizaje vía `onFinish`. Compartido por
// el modal de transacción y el triage de pendientes para no duplicar la UI ni el copy.
export function CorrectionLearnStep({
  description,
  sameTextCount,
  saving,
  onFinish,
}: {
  description: string
  sameTextCount: number
  saving: boolean
  onFinish: (opts: { note: string; applyToSameText: boolean }) => void
}) {
  const [note, setNote] = useState("")
  const n = sameTextCount

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col items-center gap-1 pt-2 text-center">
        <div className="text-lg font-semibold">Categoría guardada</div>
        <div className="text-sm text-balance text-muted-foreground">
          {description}
        </div>
      </div>

      <div>
        <Label htmlFor="correction-note" className="mb-2 block text-xs">
          ¿Qué es este movimiento? (opcional)
        </Label>
        <Input
          id="correction-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={120}
          placeholder="Ej.: pedidos de comida a domicilio"
          className="h-11 text-base"
        />
        <p className="mt-2 text-xs text-muted-foreground">
          Tu explicación queda guardada y la IA la usa para clasificar los
          próximos movimientos parecidos.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        {n > 0 && (
          <Button
            onClick={() => onFinish({ note, applyToSameText: true })}
            disabled={saving}
            className="h-12 rounded-full text-base"
          >
            {saving ? "Guardando…" : `Aplicar a los ${n} con esta descripción`}
          </Button>
        )}
        <Button
          variant={n > 0 ? "outline" : "default"}
          onClick={() => onFinish({ note, applyToSameText: false })}
          disabled={saving}
          className="h-12 rounded-full text-base"
        >
          {saving ? "Guardando…" : n > 0 ? "Solo este" : "Listo"}
        </Button>
      </div>
    </div>
  )
}
