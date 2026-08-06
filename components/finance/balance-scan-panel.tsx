"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Camera, Loader2, TriangleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { downscaleToDataUrl } from "@/lib/image-downscale"
import { haptic } from "@/lib/haptics"
import type { AccountDTO } from "@/arch/v1/application/finance-use-cases/finance-read"

// "Actualizar saldo" con una captura de la app del banco: se sube, la IA lee los montos y el usuario
// CONFIRMA antes de guardar. La confirmación no es ceremonia: la lectura puede equivocarse en un
// dígito y devolver un monto perfectamente válido, así que el ojo del usuario es la última
// validación. Todo campo es editable y los saldos derivados los calcula el servidor.

type FieldKey =
  | "cash"
  | "overdraftAvailable"
  | "overdraftLimit"
  | "nationalAvailable"
  | "nationalLimit"
  | "internationalAvailable"
  | "internationalLimit"

type Field = {
  key: FieldKey
  label: string
  hint?: string
  currency: "CLP" | "USD"
}

const CHECKING_FIELDS: Field[] = [
  {
    key: "cash",
    label: "Saldo de la cuenta",
    hint: "Negativo si estás usando la línea",
    currency: "CLP",
  },
  { key: "overdraftAvailable", label: "Línea disponible", currency: "CLP" },
  {
    key: "overdraftLimit",
    label: "Cupo total de la línea",
    hint: "Se calcula solo si lo dejas vacío",
    currency: "CLP",
  },
]

const CARD_FIELDS: Field[] = [
  { key: "nationalAvailable", label: "Cupo nacional disponible", currency: "CLP" },
  {
    key: "nationalLimit",
    label: "Cupo nacional total",
    hint: "Se usa el guardado si lo dejas vacío",
    currency: "CLP",
  },
  {
    key: "internationalAvailable",
    label: "Cupo internacional disponible",
    currency: "USD",
  },
  { key: "internationalLimit", label: "Cupo internacional total", currency: "USD" },
]

type Values = Partial<Record<FieldKey, string>>

// "1.334.697" → 1334697; "2.069,00" → 2069; "-25650" → -25650. Vacío ⇒ null (el campo no se envía).
function toNumber(raw: string | undefined): number | null {
  const clean = (raw ?? "").trim().replace(/\./g, "").replace(",", ".")
  if (!clean || clean === "-") return null
  const n = Number(clean)
  return Number.isFinite(n) ? n : null
}

function format(value: number | null | undefined, currency: "CLP" | "USD"): string {
  if (value === null || value === undefined) return ""
  return value.toLocaleString("es-CL", {
    minimumFractionDigits: currency === "USD" ? 2 : 0,
    maximumFractionDigits: currency === "USD" ? 2 : 0,
  })
}

export function BalanceScanPanel({
  account,
  onDone,
}: {
  account: AccountDTO
  onDone: () => void
}) {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState<"reading" | "saving" | null>(null)
  const [values, setValues] = useState<Values | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const isCard = account.accountType === "credit_card"
  const fields = isCard ? CARD_FIELDS : CHECKING_FIELDS
  const bucket = (kind: string) => account.buckets?.find((b) => b.kind === kind)

  async function pick(file: File) {
    setBusy("reading")
    setError(null)
    setWarning(null)
    try {
      const image = await downscaleToDataUrl(file)
      const res = await fetch(`/api/accounts/${account.id}/balance-scan`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ image }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setError(data?.error ?? "No se pudo leer la captura")
        return
      }
      if (!data?.reading) {
        // Sin IA configurada o captura ilegible: los campos quedan vacíos para llenarlos a mano.
        setWarning("No se reconoció ningún monto. Escríbelos tú.")
        setValues(prefill(null))
        return
      }
      if (!data.last4Matches) {
        setError(
          `La captura es de la tarjeta ••••${data.reading.last4}, no de esta cuenta.`
        )
        return
      }
      setValues(prefill(data.reading))
      haptic("light")
    } catch {
      setError("No se pudo procesar la imagen")
    } finally {
      setBusy(null)
    }
  }

  // Prefill: lo leído manda; el cupo total cae al guardado para que el usuario lo vea y pueda
  // corregirlo (si lo deja igual, el servidor recalcula lo mismo).
  function prefill(reading: ReadingDTO | null): Values {
    return {
      cash: format(reading?.cash ?? null, "CLP"),
      overdraftAvailable: format(reading?.overdraft?.available ?? null, "CLP"),
      overdraftLimit: format(
        reading?.overdraft?.limit ?? bucket("overdraft")?.limit ?? null,
        "CLP"
      ),
      nationalAvailable: format(reading?.national?.available ?? null, "CLP"),
      nationalLimit: format(
        reading?.national?.limit ?? bucket("credit_national")?.limit ?? null,
        "CLP"
      ),
      internationalAvailable: format(
        reading?.international?.available ?? null,
        "USD"
      ),
      internationalLimit: format(
        reading?.international?.limit ??
          bucket("credit_international")?.limit ??
          null,
        "USD"
      ),
    }
  }

  async function save() {
    if (!values) return
    setBusy("saving")
    setError(null)
    const n = (k: FieldKey) => toNumber(values[k])
    const res = await fetch(`/api/accounts/${account.id}/balances`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        last4: account.cardLast4,
        cash: isCard ? null : n("cash"),
        overdraft: {
          available: n("overdraftAvailable"),
          limit: n("overdraftLimit"),
        },
        national: { available: n("nationalAvailable"), limit: n("nationalLimit") },
        international: {
          available: n("internationalAvailable"),
          limit: n("internationalLimit"),
        },
      }),
    })
    setBusy(null)
    if (!res.ok) {
      const data = await res.json().catch(() => null)
      setError(data?.error ?? "No se pudieron guardar los saldos")
      return
    }
    haptic("medium")
    router.refresh()
    onDone()
  }

  return (
    <div className="flex flex-col gap-4">
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = "" // permite reintentar con la misma imagen
          if (file) pick(file)
        }}
      />

      {!values && (
        <div className="flex flex-col items-center gap-3 py-2 text-center">
          <p className="text-sm text-muted-foreground">
            Sube una captura de la app de tu banco y se leen los saldos. La imagen
            no se guarda.
          </p>
          <Button
            onClick={() => {
              haptic("light")
              fileRef.current?.click()
            }}
            disabled={busy !== null}
            className="h-12 rounded-full px-6"
          >
            {busy === "reading" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Camera className="size-4" />
            )}
            {busy === "reading" ? "Leyendo captura…" : "Elegir captura"}
          </Button>
        </div>
      )}

      {values && (
        <>
          <p className="text-sm text-muted-foreground">
            Revisa que los montos coincidan con la captura antes de guardar.
          </p>
          {fields.map((f) => (
            <div key={f.key} className="flex flex-col gap-1.5">
              <Label htmlFor={f.key}>
                {f.label}
                {f.currency === "USD" && (
                  <span className="ml-1 text-muted-foreground">(USD)</span>
                )}
              </Label>
              <Input
                id={f.key}
                inputMode="decimal"
                value={values[f.key] ?? ""}
                onChange={(e) =>
                  setValues({ ...values, [f.key]: e.target.value })
                }
                placeholder="—"
              />
              {f.hint && (
                <p className="text-xs text-muted-foreground">{f.hint}</p>
              )}
            </div>
          ))}
          <Button
            onClick={save}
            disabled={busy !== null}
            className="h-12 rounded-full"
          >
            {busy === "saving" && <Loader2 className="size-4 animate-spin" />}
            {busy === "saving" ? "Guardando…" : "Guardar saldos"}
          </Button>
          <Button
            variant="ghost"
            onClick={() => fileRef.current?.click()}
            disabled={busy !== null}
          >
            Usar otra captura
          </Button>
        </>
      )}

      {(error || warning) && (
        <p
          className={`flex items-start gap-2 text-sm ${error ? "text-destructive" : "text-muted-foreground"}`}
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          {error ?? warning}
        </p>
      )}
    </div>
  )
}

// Lo que devuelve el endpoint de lectura (mismo shape que BalanceReading del dominio).
type ReadingDTO = {
  last4: string | null
  cash: number | null
  overdraft: { limit: number | null; available: number | null }
  national: { limit: number | null; available: number | null }
  international: { limit: number | null; available: number | null }
}
