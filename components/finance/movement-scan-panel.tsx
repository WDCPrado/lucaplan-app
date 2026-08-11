"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Camera, Loader2, Plus, TriangleAlert, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { haptic } from "@/lib/haptics"
import { groupByCurrency } from "@/lib/finance-format"
import { downscaleToDataUrl } from "@/lib/image-downscale"
import { MAX_SCAN_IMAGES } from "@/arch/v1/domain/finance/balance-scan.domain"
import {
  CURRENCY_DECIMALS,
  type CurrencyCode,
} from "@/arch/v1/domain/finance/money"
import type { Direction } from "@/arch/v1/domain/finance/finance.domain"
import type { AccountDTO } from "@/arch/v1/application/finance-use-cases/finance-read"

// "Del banco": los movimientos que el aviso del banco no trajo, leídos de una foto de la cartola.
// La foto propone; el usuario dispone. Nada se guarda hasta que confirma, y lo que ya está
// registrado llega marcado y destildado — esa es la defensa contra contar dos veces el mismo gasto
// cuando el correo aparezca. Siempre se puede agregar una fila a mano.

type Row = {
  id: string
  date: string // YYYY-MM-DD
  description: string
  amount: number
  direction: Direction
  duplicate: boolean
  checked: boolean
}

type ScannedDTO = {
  date: string
  description: string
  amount: number
  direction: Direction
  duplicate: boolean
}

const todayISO = () => new Date().toISOString().slice(0, 10)

let seq = 0
const rowId = () => `row-${seq++}`

export function MovementScanPanel({
  account,
  onDone,
}: {
  account: AccountDTO
  onDone: () => void
}) {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [shots, setShots] = useState<
    { id: string; name: string; url: string }[]
  >([])
  const [rows, setRows] = useState<Row[] | null>(null)
  const [busy, setBusy] = useState<"reading" | "saving" | null>(null)
  const [skipped, setSkipped] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const currency = (account.currency as CurrencyCode) ?? "CLP"
  // Entrada de monto "cents-first", igual que el resto de la app: el usuario teclea dígitos.
  const scale = 10 ** CURRENCY_DECIMALS[currency]
  const showAmount = (v: number) => (v ? groupByCurrency(v, currency) : "")
  const readAmount = (raw: string) =>
    Number(raw.replace(/\D/g, "").slice(0, 15) || 0) / scale

  const selected = rows?.filter((r) => r.checked) ?? []

  async function addShots(files: File[]) {
    setError(null)
    const free = MAX_SCAN_IMAGES - shots.length
    if (free <= 0) return
    if (files.length > free)
      setError(
        `Se leen hasta ${MAX_SCAN_IMAGES} fotos; se agregaron las primeras.`
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
    try {
      const res = await fetch(`/api/accounts/${account.id}/movement-scan`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ images: shots.map((s) => s.url) }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setError(data?.error ?? "No se pudo leer la foto")
        return
      }
      const scanned: ScannedDTO[] = data?.movements ?? []
      setSkipped(data?.skipped ?? 0)
      // Los duplicados llegan destildados: entran solo si el usuario decide que esta vez sí.
      setRows(
        scanned.map((m) => ({ ...m, id: rowId(), checked: !m.duplicate }))
      )
      haptic("light")
    } catch {
      setError("No se pudo leer la foto")
    } finally {
      setBusy(null)
    }
  }

  function addRow() {
    haptic("light")
    setRows((prev) => [
      ...(prev ?? []),
      {
        id: rowId(),
        date: todayISO(),
        description: "",
        amount: 0,
        direction: "debit",
        duplicate: false,
        checked: true,
      },
    ])
  }

  const patch = (id: string, changes: Partial<Row>) =>
    setRows(
      (prev) =>
        prev?.map((r) => (r.id === id ? { ...r, ...changes } : r)) ?? null
    )

  async function save() {
    if (selected.length === 0) return
    setBusy("saving")
    setError(null)
    const res = await fetch(`/api/accounts/${account.id}/movement-scan`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        movements: selected.map(({ date, description, amount, direction }) => ({
          date,
          description,
          amount,
          direction,
        })),
      }),
    })
    setBusy(null)
    haptic(res.ok ? "success" : "error")
    if (!res.ok) {
      const data = await res.json().catch(() => null)
      setError(data?.error ?? "No se pudieron registrar los movimientos")
      return
    }
    router.refresh()
    onDone()
  }

  return (
    <div className="flex flex-col gap-4">
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          e.target.value = "" // permite volver a elegir el mismo archivo
          if (files.length) addShots(files)
        }}
      />

      {!rows && (
        <div className="flex flex-col gap-3 py-2">
          <p className="text-center text-sm text-muted-foreground">
            Sube una foto de la cartola o del historial de tu banco y se leen
            los movimientos que falten. Hasta {MAX_SCAN_IMAGES} fotos. No se
            guardan.
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
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {shot.name}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setShots((prev) => prev.filter((s) => s.id !== shot.id))
                    }
                    disabled={busy !== null}
                    aria-label={`Quitar ${shot.name}`}
                    className="grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-accent"
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
              className="h-12 rounded-full px-6"
            >
              {shots.length > 0 ? (
                <Plus className="size-4" />
              ) : (
                <Camera className="size-4" />
              )}
              {shots.length > 0 ? "Agregar otra foto" : "Elegir fotos"}
            </Button>

            {shots.length > 0 && (
              <Button
                onClick={scan}
                disabled={busy !== null}
                className="h-12 w-full rounded-full"
              >
                {busy === "reading" && (
                  <Loader2 className="size-4 animate-spin" />
                )}
                {busy === "reading"
                  ? "Leyendo…"
                  : `Leer ${shots.length === 1 ? "la foto" : `las ${shots.length} fotos`}`}
              </Button>
            )}

            <Button variant="ghost" onClick={addRow} disabled={busy !== null}>
              Escribirlos a mano
            </Button>
          </div>
        </div>
      )}

      {rows && (
        <>
          <p className="text-sm text-muted-foreground">
            {rows.length === 0
              ? "No se reconoció ningún movimiento en la foto. Agrégalos a mano."
              : "Revisa los montos y las fechas contra la foto. Solo se registran los marcados."}
          </p>
          {skipped > 0 && (
            <p className="flex items-start gap-2 text-sm text-muted-foreground">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              {skipped === 1
                ? "Una línea no se pudo leer (monto o fecha ilegible)."
                : `${skipped} líneas no se pudieron leer (monto o fecha ilegible).`}{" "}
              Agrégalas a mano si te faltan.
            </p>
          )}

          <ul className="flex flex-col gap-2">
            {rows.map((row) => (
              <li
                key={row.id}
                className={cn(
                  "flex flex-col gap-2 rounded-lg border border-border/60 p-3",
                  !row.checked && "opacity-55"
                )}
              >
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={row.checked}
                    onChange={(e) =>
                      patch(row.id, { checked: e.target.checked })
                    }
                    aria-label="Registrar este movimiento"
                    className="size-5 shrink-0 accent-primary"
                  />
                  <Input
                    value={row.description}
                    onChange={(e) =>
                      patch(row.id, { description: e.target.value })
                    }
                    placeholder="Descripción"
                    className="h-9 flex-1"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      haptic("light")
                      patch(row.id, {
                        direction:
                          row.direction === "debit" ? "credit" : "debit",
                      })
                    }}
                    aria-label={
                      row.direction === "debit"
                        ? "Es un gasto; cambiar a ingreso"
                        : "Es un ingreso; cambiar a gasto"
                    }
                    className={cn(
                      "size-9 shrink-0 rounded-full border text-xl",
                      row.direction === "debit"
                        ? "text-destructive"
                        : "bg-success/10 text-success"
                    )}
                  >
                    {row.direction === "debit" ? "−" : "+"}
                  </button>
                </div>
                <div className="flex items-center gap-2 pl-8">
                  <Input
                    type="date"
                    value={row.date}
                    max={todayISO()}
                    onChange={(e) => patch(row.id, { date: e.target.value })}
                    aria-label="Fecha del movimiento"
                    className="h-9 w-36"
                  />
                  <Input
                    inputMode="numeric"
                    value={showAmount(row.amount)}
                    onChange={(e) =>
                      patch(row.id, { amount: readAmount(e.target.value) })
                    }
                    placeholder="0"
                    aria-label="Monto del movimiento"
                    className="tabular h-9 flex-1 text-right"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setRows(
                        (prev) => prev?.filter((r) => r.id !== row.id) ?? null
                      )
                    }
                    aria-label="Quitar de la lista"
                    className="grid size-9 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-accent"
                  >
                    <X className="size-4" />
                  </button>
                </div>
                {row.duplicate && (
                  <p className="pl-8 text-xs text-muted-foreground">
                    Ya tienes uno igual ese día: márcalo solo si de verdad
                    fueron dos.
                  </p>
                )}
              </li>
            ))}
          </ul>

          <Button variant="outline" onClick={addRow} disabled={busy !== null}>
            <Plus className="size-4" /> Agregar movimiento
          </Button>

          <Button
            onClick={save}
            disabled={busy !== null || selected.length === 0}
            className="h-12 rounded-full"
          >
            {busy === "saving" && <Loader2 className="size-4 animate-spin" />}
            {busy === "saving"
              ? "Registrando…"
              : selected.length === 1
                ? "Registrar 1 movimiento"
                : `Registrar ${selected.length} movimientos`}
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setRows(null)
              setSkipped(0)
            }}
            disabled={busy !== null}
          >
            Volver a las fotos
          </Button>
        </>
      )}

      {error && (
        <p className="flex items-start gap-2 text-sm text-destructive">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      )}
    </div>
  )
}
