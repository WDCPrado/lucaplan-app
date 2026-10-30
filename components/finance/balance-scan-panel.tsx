"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Camera, Loader2, Plus, TriangleAlert, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ModalActions } from "@/components/ui/responsive-modal"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { downscaleToDataUrl } from "@/lib/image-downscale"
import { haptic } from "@/lib/haptics"
import { formatMoney, groupByCurrency } from "@/lib/finance-format"
import { MAX_SCAN_IMAGES } from "@/arch/v1/domain/finance/balance-scan.domain"
import {
  CURRENCY_DECIMALS,
  type CurrencyCode,
} from "@/arch/v1/domain/finance/money"
import type { AccountDTO } from "@/arch/v1/application/finance-use-cases/finance-read"

// "Actualizar saldo" con una captura de la app del banco: se sube, la IA lee los montos y el usuario
// CONFIRMA antes de guardar. La confirmación no es ceremonia: la lectura puede equivocarse en un
// dígito y devolver un monto perfectamente válido, así que el ojo del usuario es la última
// validación.
//
// El CUPO TOTAL no se edita ni se lee de la foto: lo fija el banco, ya está en la cuenta y es
// justamente la referencia con la que se despeja lo que la captura no mostró y se comprueba lo que
// sí. Lo confirmable es el disponible y el utilizado, que son complementos: al escribir uno, el otro
// se ajusta en pantalla.

type BucketKind = "overdraft" | "credit_national" | "credit_international"

type BucketField = { kind: BucketKind; label: string; currency: CurrencyCode }

const CHECKING_BUCKETS: BucketField[] = [
  { kind: "overdraft", label: "Línea de crédito", currency: "CLP" },
]

const CARD_BUCKETS: BucketField[] = [
  { kind: "credit_national", label: "Cupo nacional", currency: "CLP" },
  {
    kind: "credit_international",
    label: "Cupo internacional",
    currency: "USD",
  },
]

// Los dos montos de un cupo. `null` = "no lo sé", que NO es cero: con el campo vacío el servidor
// calcula ese monto desde el otro.
type Pair = { available: number | null; used: number | null }

type Values = { cash: number | null; buckets: Record<BucketKind, Pair> }

// Descuadre que reporta el servidor: llega estructurado y la frase se arma acá.
type MismatchDTO = {
  kind: string
  difference: number // cupo guardado − lo leído
  currency: CurrencyCode
}

const BUCKET_LABEL: Record<string, string> = {
  overdraft: "la línea de crédito",
  credit_national: "el cupo nacional",
  credit_international: "el cupo internacional",
}

// Entrada "cents-first", igual que el resto de la app: el usuario teclea dígitos y el separador de
// miles aparece solo, así que no hay forma de tipear un punto ambiguo (en Chile separa miles, pero
// en dólares mucha gente lo usa como decimal).
const showAmount = (value: number | null, currency: CurrencyCode) =>
  value === null ? "" : groupByCurrency(value, currency)

function readAmount(raw: string, currency: CurrencyCode): number | null {
  const digits = raw.replace(/\D/g, "").slice(0, 15)
  if (!digits) return null
  const value = Number(digits) / 10 ** CURRENCY_DECIMALS[currency]
  // El signo lo conserva el texto que ya estaba en pantalla (el saldo de la corriente puede ser
  // negativo); se cambia con el botón ±, no tecleando.
  return raw.trim().startsWith("-") ? -value : value
}

// Complemento contra el cupo total. Se calcula solo para MOSTRARLO: lo que se guarda lo rehace el
// servidor con enteros, sin float de por medio.
const complement = (total: number, value: number, currency: CurrencyCode) =>
  Number((total - value).toFixed(CURRENCY_DECIMALS[currency]))

export function BalanceScanPanel({
  account,
  onDone,
  onBack,
}: {
  account: AccountDTO
  onDone: () => void
  onBack: () => void // vuelve al detalle de la cuenta
}) {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  // Capturas elegidas, ya reescaladas. El banco reparte los datos entre pantallas (nacional en una,
  // internacional en otra), así que se juntan todas y se leen de una sola pasada.
  const [shots, setShots] = useState<
    { id: string; name: string; url: string }[]
  >([])
  const [busy, setBusy] = useState<"reading" | "saving" | null>(null)
  const [values, setValues] = useState<Values | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [mismatches, setMismatches] = useState<MismatchDTO[]>([])

  const isCard = account.accountType === "credit_card"
  const bucketFields = isCard ? CARD_BUCKETS : CHECKING_BUCKETS

  // Cupo total guardado. null (o cero) ⇒ la cuenta todavía no lo tiene: ahí no hay con qué despejar
  // ni comprobar, y los dos montos se escriben sueltos.
  const limitOf = (kind: BucketKind): number | null =>
    account.buckets?.find((b) => b.kind === kind)?.limit || null

  // Agrega capturas a la lista (sin leer todavía): así se pueden juntar varias pantallas del banco.
  async function add(files: File[]) {
    setError(null)
    const free = MAX_SCAN_IMAGES - shots.length
    if (free <= 0) return
    if (files.length > free)
      setError(
        `Se leen hasta ${MAX_SCAN_IMAGES} capturas; se agregaron las primeras.`
      )
    try {
      const added = await Promise.all(
        files.slice(0, free).map(async (file, i) => ({
          id: `${file.name}-${file.lastModified}-${i}`,
          name: file.name,
          url: await downscaleToDataUrl(file),
        }))
      )
      setShots((prev) => [...prev, ...added])
      haptic("light")
    } catch {
      setError("No se pudo procesar alguna imagen")
    }
  }

  async function scan() {
    if (shots.length === 0) return
    setBusy("reading")
    setError(null)
    setWarning(null)
    setMismatches([])
    try {
      const res = await fetch(`/api/accounts/${account.id}/balance-scan`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ images: shots.map((s) => s.url) }),
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
      setMismatches(data.mismatches ?? [])
      setValues(prefill(data.reading))
      haptic("light")
    } catch {
      setError("No se pudo procesar la imagen")
    } finally {
      setBusy(null)
    }
  }

  // Prefill: da igual cuál de los dos montos trajo la captura —disponible, utilizado o los dos—; con
  // el cupo total guardado, uno despeja al otro y la pantalla muestra el par completo.
  function prefill(reading: ReadingDTO | null): Values {
    const pair = (
      kind: BucketKind,
      currency: CurrencyCode,
      read: BucketDTO | undefined
    ): Pair => {
      const total = limitOf(kind)
      const available =
        read?.available ??
        (total !== null && read?.used != null
          ? complement(total, read.used, currency)
          : null)
      const used =
        total !== null && available !== null
          ? complement(total, available, currency)
          : (read?.used ?? null)
      return { available, used }
    }
    return {
      cash: reading?.cash ?? null,
      buckets: {
        overdraft: pair("overdraft", "CLP", reading?.overdraft),
        credit_national: pair("credit_national", "CLP", reading?.national),
        credit_international: pair(
          "credit_international",
          "USD",
          reading?.international
        ),
      },
    }
  }

  function setPair(
    field: BucketField,
    side: "available" | "used",
    raw: string
  ) {
    const value = readAmount(raw, field.currency)
    const total = limitOf(field.kind)
    const other = side === "available" ? "used" : "available"
    setValues((prev) =>
      prev
        ? {
            ...prev,
            buckets: {
              ...prev.buckets,
              [field.kind]: {
                [side]: value,
                [other]:
                  total !== null && value !== null
                    ? complement(total, value, field.currency)
                    : prev.buckets[field.kind][other],
              } as Pair,
            },
          }
        : prev
    )
    // El aviso hablaba de los montos de la foto: al corregirlos deja de describir la pantalla.
    setMismatches((ms) => ms.filter((m) => m.kind !== field.kind))
  }

  async function save() {
    if (!values) return
    setBusy("saving")
    setError(null)
    const res = await fetch(`/api/accounts/${account.id}/balances`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        last4: account.cardLast4,
        cash: isCard ? null : values.cash,
        overdraft: values.buckets.overdraft,
        national: values.buckets.credit_national,
        international: values.buckets.credit_international,
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
    <div className="flex flex-col gap-6">
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          e.target.value = "" // permite volver a elegir el mismo archivo
          if (files.length) add(files)
        }}
      />

      {!values && (
        <div className="flex flex-col gap-3 py-2">
          <p className="text-center text-subheadline text-muted-foreground">
            Sube capturas de la app de tu banco y se leen los saldos. Puedes
            juntar hasta {MAX_SCAN_IMAGES} si el cupo internacional está en otra
            pantalla. No se guardan.
          </p>

          {shots.length > 0 && (
            <ul className="flex flex-col gap-2">
              {shots.map((shot) => (
                <li
                  key={shot.id}
                  className="flex items-center gap-3 rounded-lg border border-border/60 p-2"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- data: URL local, sin optimización que hacer */}
                  <img
                    src={shot.url}
                    alt=""
                    className="size-12 shrink-0 rounded-md object-cover object-top"
                  />
                  <span className="min-w-0 flex-1 truncate text-subheadline">
                    {shot.name}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setShots((prev) => prev.filter((s) => s.id !== shot.id))
                    }
                    disabled={busy !== null}
                    aria-label={`Quitar ${shot.name}`}
                    className="grid size-11 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-accent"
                  >
                    <X className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-col items-center gap-2">
            <Button
              variant={shots.length > 0 ? "outline" : "default"}
              onClick={() => {
                haptic("light")
                fileRef.current?.click()
              }}
              disabled={busy !== null || shots.length >= MAX_SCAN_IMAGES}
              className="h-12 px-6"
            >
              {shots.length > 0 ? (
                <Plus className="size-4" />
              ) : (
                <Camera className="size-4" />
              )}
              {shots.length > 0 ? "Agregar otra captura" : "Elegir capturas"}
            </Button>

            {shots.length > 0 && (
              <Button
                onClick={scan}
                disabled={busy !== null}
                className="h-12 w-full"
              >
                {busy === "reading" && (
                  <Loader2 className="size-4 animate-spin" />
                )}
                {busy === "reading"
                  ? "Leyendo…"
                  : `Leer ${shots.length === 1 ? "la captura" : `las ${shots.length} capturas`}`}
              </Button>
            )}
          </div>
        </div>
      )}

      {values && (
        <>
          <p className="text-subheadline text-muted-foreground">
            Revisa que los montos coincidan con la captura antes de guardar. El
            cupo total no se toca: es el que tiene la cuenta.
          </p>
          {/* Descuadre aritmético contra el cupo total guardado. Es la única pista automática de que
              se leyó mal un dígito (o de que el banco cambió el cupo), así que se señala fuerte pero
              no bloquea. */}
          {mismatches.map((m) => (
            <p
              key={m.kind}
              className="flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-subheadline text-destructive"
            >
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              <span>
                Lo leído en {BUCKET_LABEL[m.kind] ?? "este cupo"} no cuadra con
                el cupo total guardado: {m.difference > 0 ? "faltan" : "sobran"}{" "}
                {formatMoney(Math.abs(m.difference), m.currency)}. Revisa los
                montos contra la captura; si el banco te cambió el cupo,
                actualízalo en la cuenta.
              </span>
            </p>
          ))}

          {!isCard && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cash">Saldo de la cuenta</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="cash"
                  inputMode="numeric"
                  value={showAmount(values.cash, "CLP")}
                  onChange={(e) =>
                    setValues({
                      ...values,
                      cash: readAmount(e.target.value, "CLP"),
                    })
                  }
                  placeholder="—"
                  className="tabular flex-1 text-right"
                />
                <button
                  type="button"
                  onClick={() => {
                    haptic("light")
                    setValues({
                      ...values,
                      cash: values.cash === null ? null : -values.cash,
                    })
                  }}
                  disabled={values.cash === null}
                  aria-label={
                    (values.cash ?? 0) < 0
                      ? "Está en negativo; cambiar a positivo"
                      : "Está en positivo; cambiar a negativo"
                  }
                  className="size-11 shrink-0 rounded-lg border text-title-3 disabled:opacity-40"
                >
                  {(values.cash ?? 0) < 0 ? "−" : "+"}
                </button>
              </div>
              <p className="text-footnote text-muted-foreground">
                Conserva el signo que muestra el banco. La línea se informa aparte.
              </p>
            </div>
          )}

          {bucketFields.map((f) => {
            const total = limitOf(f.kind)
            const pair = values.buckets[f.kind]
            return (
              <div
                key={f.kind}
                className="flex flex-col gap-3 rounded-lg border border-border/60 p-3"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-subheadline font-medium">
                    {f.label}
                    {f.currency === "USD" && (
                      <span className="ml-1 text-muted-foreground">(USD)</span>
                    )}
                  </span>
                  <span className="tabular text-footnote text-muted-foreground">
                    {total === null
                      ? "Sin cupo total guardado"
                      : `Cupo total ${formatMoney(total, f.currency)}`}
                  </span>
                </div>

                {(["available", "used"] as const).map((side) => (
                  <div key={side} className="flex flex-col gap-1.5">
                    <Label htmlFor={`${f.kind}-${side}`}>
                      {side === "available" ? "Disponible" : "Utilizado"}
                    </Label>
                    <Input
                      id={`${f.kind}-${side}`}
                      inputMode="numeric"
                      value={showAmount(pair[side], f.currency)}
                      onChange={(e) => setPair(f, side, e.target.value)}
                      placeholder="—"
                      className="tabular text-right"
                    />
                  </div>
                ))}

                <p className="text-footnote text-muted-foreground">
                  {total === null
                    ? "Escribe los dos: sin cupo total guardado, de su suma sale el de la cuenta."
                    : "Escribe el que muestre la captura; el otro sale del cupo total."}
                </p>
              </div>
            )
          })}
        </>
      )}

      {(error || warning) && (
        <p
          className={`flex items-start gap-2 text-subheadline ${error ? "text-destructive" : "text-muted-foreground"}`}
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          {error ?? warning}
        </p>
      )}
      {/* El pie va al final, después del aviso: así queda abajo y sin nada debajo. Sin valores
          leídos, su «Cancelar» vuelve al detalle de la cuenta. */}
      {values ? (
        <ModalActions
          cancel={{
            label: "Volver a las capturas",
            mobileLabel: "Volver",
            disabled: busy !== null,
            onClick: () => {
              setValues(null) // vuelve a la lista: ahí se agregan, se quitan y se relee
              setMismatches([])
            },
          }}
          primary={{
            label: busy === "saving" ? "Guardando…" : "Guardar saldos",
            mobileLabel: busy === "saving" ? "Guardando…" : "Guardar",
            disabled: busy !== null,
            onClick: save,
          }}
        />
      ) : (
        <ModalActions
          cancel={{
            label: "Volver al detalle",
            mobileLabel: "Volver",
            disabled: busy !== null,
            onClick: onBack,
          }}
        />
      )}
    </div>
  )
}

// Lo que devuelve el endpoint de lectura. El `limit` que trae la lectura no se usa acá: el cupo total
// es el de la cuenta, y el servidor ya lo comparó contra la captura (`mismatches`).
type BucketDTO = { available: number | null; used: number | null }

type ReadingDTO = {
  last4: string | null
  cash: number | null
  overdraft: BucketDTO
  national: BucketDTO
  international: BucketDTO
}

