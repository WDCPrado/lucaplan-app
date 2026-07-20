"use client"

import * as React from "react"
import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Check, CreditCard, Plus, Undo2, X } from "lucide-react"
import { toast } from "sonner"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { haptic } from "@/lib/haptics"
import { formatCLP, formatDateHeader } from "@/lib/finance-format"
import { CategoryIcon } from "./category-icons"
import { CorrectionLearnStep } from "./correction-learn-step"
import { accountLabel, Chip, savedFirst } from "./transaction-modal"
import type {
  AccountDTO,
  CategoryDTO,
  TransactionDTO,
} from "@/arch/v1/application/finance-use-cases/finance-read"

// Emparejado con la duración de la transición de salida de la card (duration-300).
const EXIT_MS = 300
// Píxeles de arrastre hacia abajo sobre el montón de hechas que disparan "corregir última".
const RESTORE_DRAG_PX = 56

// Triage de movimientos sin categoría: stack de cards sobre el Dialog de shadcn (portal, nombre
// accesible, focus trap/restauración, fondo inerte, scroll lock, Escape). Elegir un chip PERSISTE
// primero (PATCH existente) y recién entonces la card vuela hacia arriba al montón de hechas;
// arrastrar el montón hacia abajo (o el botón) recupera la última para corregirla. El padre monta
// este componente solo mientras el triage está abierto; cerrar = desmontar (no reaparece hasta la
// próxima carga del dashboard).
export function UncategorizedTriage({
  transactions,
  hasMore,
  accounts,
  categories,
  onClose,
  onCreateCategory,
}: {
  transactions: TransactionDTO[]
  hasMore: boolean
  accounts: AccountDTO[]
  categories: CategoryDTO[]
  onClose: () => void
  onCreateCategory: () => void
}) {
  const router = useRouter()
  const [pending, setPending] = useState(transactions)
  const [done, setDone] = useState<TransactionDTO[]>([])
  const [busy, setBusy] = useState(false)
  const [exiting, setExiting] = useState(false) // card frontal animando su salida hacia arriba
  const [returningId, setReturningId] = useState<string | null>(null) // card recuperada (entra desde arriba)
  // Paso de aprendizaje sobre la card frontal (tras elegir categoría, antes de volarla): nota
  // "¿por qué?" + propagar a los N con la misma descripción. Refiere siempre al frontal.
  const [learn, setLearn] = useState<{
    categoryId: string
    sameTextCount: number
  } | null>(null)
  const drag = useRef({ active: false, startY: 0, dy: 0 })

  const front = pending[0]

  // Un único router.refresh() al cerrar/terminar (no por card): el dashboard no se re-renderiza
  // bajo el overlay en plena interacción. Con busy/exiting no se cierra ni se salta a crear
  // categoría: el refresh correría antes de que termine el PATCH en vuelo.
  // Hubo cambios que persistir (movimientos categorizados o uno en pleno paso de aprendizaje).
  const dirty = () => done.length > 0 || learn !== null

  function handleClose() {
    if (busy || exiting) return
    if (dirty()) router.refresh()
    onClose()
  }

  function createCategory() {
    if (busy || exiting) return
    if (dirty()) router.refresh()
    onCreateCategory()
  }

  // Elegir categoría PERSISTE (PATCH) y abre el paso de aprendizaje sobre la card; recién al
  // terminarlo (finishLearn) la card vuela al montón de hechas.
  async function pick(categoryId: string) {
    if (!front || busy || exiting || learn) return
    setBusy(true)
    let ok = false
    let sameTextCount = 0
    try {
      const res = await fetch(`/api/transactions/${front.id}/category`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoryId }),
      })
      ok = res.ok
      if (ok) {
        const data = await res.json().catch(() => ({}))
        sameTextCount = Number(data.sameTextCount) || 0
      }
    } catch {
      // red caída → mismo aviso que un error del servidor
    }
    setBusy(false)
    if (!ok) {
      haptic("error")
      toast.error("No se pudo guardar la categoría")
      return // la card sigue al frente
    }
    haptic("light")
    setLearn({ categoryId, sameTextCount })
  }

  // Cierre del paso de aprendizaje: guarda la nota y/o propaga a los parecidos (best-effort), y
  // recién entonces vuela la card. Al propagar, quita del montón los pendientes con la MISMA
  // descripción exacta (subconjunto seguro de los que el servidor ya categorizó; el resto se
  // reconcilia con el refresh al cerrar).
  async function finishLearn({
    note,
    applyToSameText,
  }: {
    note: string
    applyToSameText: boolean
  }) {
    if (!front || !learn) return
    setBusy(true)
    if (note.trim() || applyToSameText) {
      await fetch("/api/categorization/corrections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transactionId: front.id,
          note: note.trim() || undefined,
          applyToSameText,
        }),
      }).catch(() => {})
    }
    haptic(pending.length === 1 ? "success" : "light") // el último cierra el triage
    const doneTx = { ...front, categoryId: learn.categoryId }
    const desc = front.description
    setReturningId(null)
    setExiting(true)
    // ponytail: timeout emparejado con la transición (sin escuchar transitionend)
    window.setTimeout(() => {
      setPending((p) => {
        const rest = p.slice(1)
        return applyToSameText
          ? rest.filter((t) => t.description !== desc)
          : rest
      })
      setDone((d) => [...d, doneTx])
      setExiting(false)
      setBusy(false)
      setLearn(null)
    }, EXIT_MS)
  }

  // Corregir: la última hecha vuelve al frente con su categoría marcada; elegir otra re-persiste.
  // (Es corrección, no deshacer: la categoría guardada se mantiene hasta elegir otra.)
  function restoreLast() {
    if (busy || exiting || learn || done.length === 0) return
    const last = done[done.length - 1]
    setDone((d) => d.slice(0, -1))
    setPending((p) => [last, ...p])
    setReturningId(last.id)
  }

  // Drag hacia abajo SOLO sobre el montón de hechas (touch-action none local: no pelea con el
  // tap de los chips ni con su scroll-x). El botón interno corrige con click normal.
  function onPileDown(e: React.PointerEvent<HTMLDivElement>) {
    if (busy || exiting || learn || done.length === 0) return
    if ((e.target as HTMLElement).closest("button")) return
    drag.current = { active: true, startY: e.clientY, dy: 0 }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  function onPileMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current
    if (!d.active) return
    d.dy = Math.max(0, e.clientY - d.startY)
    e.currentTarget.style.transition = "none" // sigue al puntero sin pelear con la clase
    e.currentTarget.style.transform = `translateY(${Math.min(d.dy, 96) * 0.5}px)`
  }
  function onPileUp(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current
    if (!d.active) return
    d.active = false
    e.currentTarget.style.transition = "" // la clase transition-transform anima el regreso
    e.currentTarget.style.transform = ""
    if (d.dy > RESTORE_DRAG_PX) restoreLast()
  }

  return (
    <Dialog open onOpenChange={(o) => !o && handleClose()}>
      <DialogContent
        showCloseButton={false}
        className="top-0 left-0 flex h-dvh w-dvw max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none bg-background/85 p-0 text-base text-foreground ring-0 backdrop-blur-xl sm:max-w-none motion-reduce:data-open:zoom-in-100 motion-reduce:data-closed:zoom-out-100"
      >
        <header className="mx-auto flex w-full max-w-md items-start justify-between gap-3 px-4 pt-[max(env(safe-area-inset-top),1.25rem)]">
          <div className="min-w-0">
            <DialogTitle className="font-heading text-lg font-bold">
              Movimientos por categorizar
            </DialogTitle>
            <DialogDescription className="mt-1">
              {pending.length > 0
                ? `${pending.length} pendiente${pending.length === 1 ? "" : "s"}${hasMore ? " · hay más en la próxima carga" : ""}`
                : "Todo categorizado"}
            </DialogDescription>
          </div>
          <DialogClose asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-11 shrink-0 rounded-full"
              aria-label="Cerrar"
              disabled={busy || exiting}
            >
              <X className="size-5" />
            </Button>
          </DialogClose>
        </header>

        {/* Montón de hechas: mini-pila + contador + corregir (drag hacia abajo o botón). */}
        {done.length > 0 && (
          <div className="mx-auto mt-4 w-full max-w-md px-4">
            <div
              onPointerDown={onPileDown}
              onPointerMove={onPileMove}
              onPointerUp={onPileUp}
              onPointerCancel={onPileUp}
              className="flex cursor-grab touch-none items-center justify-between gap-3 rounded-2xl bg-secondary/60 py-1.5 pr-1.5 pl-4 transition-transform duration-200 ease-out select-none active:cursor-grabbing"
            >
              <div className="flex min-w-0 items-center gap-3">
                <div className="relative h-9 w-12 shrink-0" aria-hidden>
                  {done.length >= 3 && (
                    <div className="absolute inset-x-2 top-0 h-6 rounded-md border border-border/60 bg-card/60" />
                  )}
                  {done.length >= 2 && (
                    <div className="absolute inset-x-1 top-1 h-6 rounded-md border border-border/80 bg-card/80" />
                  )}
                  <div className="absolute inset-x-0 top-2 h-6 rounded-md border border-border bg-card shadow-sm" />
                </div>
                <span className="truncate text-sm text-muted-foreground">
                  {done.length} categorizado{done.length === 1 ? "" : "s"}
                </span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-11 shrink-0 gap-1.5 rounded-full px-3"
                onClick={restoreLast}
                disabled={busy || exiting}
              >
                <Undo2 className="size-4" /> Corregir última
              </Button>
            </div>
          </div>
        )}

        <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-4 py-6">
          <div className="w-full max-w-md">
            {pending.length === 0 ? (
              // Estado final: resumen + cierre (el refresh va en handleClose).
              <div className="glass-strong flex animate-in flex-col items-center gap-4 rounded-3xl p-8 text-center duration-300 fade-in-0">
                <span className="grid size-14 place-items-center rounded-full bg-success/15 text-success">
                  <Check className="size-7" />
                </span>
                <div>
                  <p className="font-heading text-xl font-bold">
                    {done.length} categorizado{done.length === 1 ? "" : "s"}
                  </p>
                  {hasMore && (
                    <p className="mt-1 text-sm text-muted-foreground">
                      Quedan más pendientes: reaparecerán en la próxima carga.
                    </p>
                  )}
                </div>
                <Button
                  className="h-11 w-full rounded-full text-base"
                  onClick={handleClose}
                >
                  Listo
                </Button>
              </div>
            ) : (
              // Stack: card frontal + hasta 2 detrás (solo chrome, asoman con scale/translate).
              // Al salir la frontal, la siguiente hereda su key y transiciona sola a la posición 0.
              <div className="relative">
                {pending.slice(0, 3).map((t, i) => (
                  <div
                    key={t.id}
                    aria-hidden={i > 0 || undefined}
                    className={cn(
                      "glass-strong rounded-3xl transition-[transform,opacity] duration-300 ease-out motion-reduce:transition-opacity motion-reduce:duration-150",
                      i === 0 && "relative z-3",
                      i === 0 &&
                        returningId === t.id &&
                        "animate-in duration-300 fade-in-0 slide-in-from-top-6 motion-reduce:slide-in-from-top-0",
                      i === 0 &&
                        exiting &&
                        "-translate-y-[120%] rotate-3 opacity-0 motion-reduce:translate-y-0 motion-reduce:rotate-0",
                      i === 1 &&
                        "pointer-events-none absolute inset-0 z-2 -translate-y-3 scale-95",
                      i === 2 &&
                        "pointer-events-none absolute inset-0 z-1 -translate-y-6 scale-90"
                    )}
                  >
                    {i === 0 &&
                      (learn ? (
                        <div className="p-6">
                          <CorrectionLearnStep
                            description={t.description}
                            sameTextCount={learn.sameTextCount}
                            saving={busy}
                            onFinish={finishLearn}
                          />
                        </div>
                      ) : (
                        <TriageCard
                          tx={t}
                          account={accounts.find((a) => a.id === t.accountId)}
                          categories={categories}
                          busy={busy || exiting}
                          onPick={pick}
                          onCreateCategory={createCategory}
                        />
                      ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// Detalle compacto del movimiento (como ConnectedDetail) + chips de categoría del lado del
// movimiento. Sin categorías del lado → CTA que salta al modal de categoría del dashboard.
function TriageCard({
  tx,
  account,
  categories,
  busy,
  onPick,
  onCreateCategory,
}: {
  tx: TransactionDTO
  account: AccountDTO | undefined
  categories: CategoryDTO[]
  busy: boolean
  onPick: (categoryId: string) => void
  onCreateCategory: () => void
}) {
  const income = tx.direction === "credit"
  const visible = savedFirst(
    categories.filter((c) => c.type === (income ? "income" : "expense")),
    tx.categoryId
  )
  const label = accountLabel(account)

  return (
    <div className="flex flex-col gap-5 p-6">
      <div className="flex flex-col items-center gap-1 pt-1 text-center">
        <div
          className={cn(
            "tabular text-3xl font-bold",
            income ? "text-success" : "text-foreground"
          )}
        >
          {income ? "+" : "−"}
          {formatCLP(Math.abs(tx.amount))}
        </div>
        <div className="line-clamp-2 text-sm text-balance text-muted-foreground">
          {tx.description}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {label && (
          <span className="flex items-center gap-1.5">
            <CreditCard className="size-3.5 shrink-0" />
            {label}
          </span>
        )}
        <span>{formatDateHeader(tx.date)}</span>
      </div>

      {visible.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl bg-secondary/50 p-4 text-center">
          <p className="text-sm text-muted-foreground">
            Sin categorías de {income ? "ingreso" : "gasto"} para clasificar
            este movimiento.
          </p>
          <Button
            variant="outline"
            className="h-11 rounded-full"
            onClick={onCreateCategory}
          >
            Crear categoría
          </Button>
        </div>
      ) : (
        <div className="-mx-6 flex scrollbar-none gap-2 overflow-x-auto px-6 pb-1">
          {visible.map((c) => (
            <Chip
              key={c.id}
              active={c.id === tx.categoryId}
              disabled={busy}
              onClick={() => c.id !== tx.categoryId && onPick(c.id)}
            >
              <CategoryIcon
                icon={c.icon}
                size={16}
                color={c.color ?? undefined}
              />{" "}
              {c.name}
            </Chip>
          ))}
          {/* Crear una categoría nueva sin salir del triage (aparece siempre, al final de los chips). */}
          <Chip active={false} disabled={busy} onClick={onCreateCategory}>
            <Plus className="size-4" /> Nueva
          </Chip>
        </div>
      )}
    </div>
  )
}
