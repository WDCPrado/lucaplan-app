"use client"

import { useRef, useState, type ReactNode } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { ChevronLeft, ChevronRight } from "lucide-react"

import { authClient } from "@/lib/auth-client"
import { formatDateHeader, monthName } from "@/lib/finance-format"
import { Button } from "@/components/ui/button"
import { AppShell } from "./app-shell"
import { MonthPicker } from "./month-picker"
import { MovementRow } from "./movement-row"
import { TransactionModal } from "./transaction-modal"
import {
  TransactionFilters,
  filtersToParams,
  fromYmd,
  type Dir,
  type FilterValues,
} from "./transaction-filters"
import type {
  AccountDTO,
  AmountBoundsDTO,
  CategoryDTO,
  TransactionDTO,
  TransactionPage,
} from "@/arch/v1/application/finance-use-cases/finance-read"

const SEARCH_INPUT_ID = "movements-q"

// Pantalla Movimientos: la cartola del mes (o ciclo) paginada por el servidor, con el buscador y
// sus filtros abiertos al lado (escritorio) o arriba (celular). Los filtros viven en la URL: el
// servidor lee la página con ellos, y recargar o compartir el enlace muestra lo mismo.
export function MovementsView({
  user,
  period,
  current,
  result,
  accounts,
  categories,
  amountBounds,
  filters,
}: {
  user: { name: string; email: string; initial: string }
  period: { year: number; month: number }
  current: { year: number; month: number }
  result: TransactionPage
  accounts: AccountDTO[]
  categories: CategoryDTO[]
  amountBounds: AmountBoundsDTO
  filters: {
    q: string
    direction: Dir
    categoryId: string
    bank: string
    from?: string
    to?: string
    amountMin?: number
    amountMax?: number
  }
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [detailTx, setDetailTx] = useState<TransactionDTO | null>(null)

  // Estado local del panel (el input responde al tiro); la URL se actualiza después. Se inicializa
  // una vez desde la URL.
  // ponytail: atrás/adelante del navegador no resincroniza el panel; si molesta, remontarlo por
  // `bfcacheId` del router.
  const [values, setValues] = useState<FilterValues>(() => {
    const from = fromYmd(filters.from)
    return {
      q: filters.q,
      direction: filters.direction,
      categoryId: filters.categoryId,
      bank: filters.bank,
      range: from ? { from, to: fromYmd(filters.to) } : undefined,
      amount: [
        filters.amountMin ?? amountBounds.min,
        filters.amountMax ?? amountBounds.max,
      ],
    }
  })
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  // Cambiar un filtro reescribe la URL y vuelve a la página 1. El texto y el slider esperan 300ms
  // a que se deje de escribir o arrastrar; el resto va de inmediato.
  function changeFilters(next: FilterValues) {
    const typing =
      next.q !== values.q ||
      next.amount[0] !== values.amount[0] ||
      next.amount[1] !== values.amount[1]
    setValues(next)
    clearTimeout(timer.current)
    timer.current = setTimeout(
      () => {
        const params = filtersToParams(next, amountBounds)
        const year = searchParams.get("year")
        const month = searchParams.get("month")
        if (year) params.set("year", year)
        if (month) params.set("month", month)
        router.replace(`/movements?${params.toString()}`, { scroll: false })
      },
      typing ? 300 : 0
    )
  }

  // El mes manda sobre las fechas elegidas: al cambiarlo se sueltan, junto con la página.
  function goPeriod(year: number, month: number) {
    const params = new URLSearchParams(searchParams.toString())
    params.set("year", String(year))
    params.set("month", String(month))
    for (const k of ["page", "from", "to"]) params.delete(k)
    setValues((v) => ({ ...v, range: undefined }))
    router.push(`/movements?${params.toString()}`)
  }
  function goMonth(delta: number) {
    const d = new Date(Date.UTC(period.year, period.month - 1 + delta, 1))
    goPeriod(d.getUTCFullYear(), d.getUTCMonth() + 1)
  }

  function pageHref(page: number) {
    const params = new URLSearchParams(searchParams.toString())
    if (page > 1) params.set("page", String(page))
    else params.delete("page")
    return `/movements?${params.toString()}`
  }

  async function signOut() {
    await authClient.signOut()
    router.push("/login")
  }

  // Agrupa por día (vienen más reciente primero).
  const groups: { key: string; header: string; txs: TransactionDTO[] }[] = []
  for (const tx of result.items) {
    const key = tx.date.slice(0, 10)
    if (groups.at(-1)?.key !== key)
      groups.push({ key, header: formatDateHeader(tx.date), txs: [] })
    groups[groups.length - 1].txs.push(tx)
  }

  const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize))
  const first = (result.page - 1) * result.pageSize + 1
  const last = first + result.items.length - 1
  const hasFilters = [...searchParams.keys()].some((k) => k !== "year" && k !== "month" && k !== "page")

  return (
    <AppShell
      user={{ name: user.name, initial: user.initial, email: user.email }}
      onSignOut={signOut}
      showAdd
      onSearch={() => document.getElementById(SEARCH_INPUT_ID)?.focus()}
      title="Movimientos"
      actions={
        <div className="liquid-glass min-h-11 rounded-full px-1 flex items-center gap-1 md:min-h-0 md:rounded-lg md:bg-secondary md:py-1 md:shadow-none md:backdrop-blur-none md:before:hidden">
          <button
            onClick={() => goMonth(-1)}
            className="relative grid size-8 place-items-center rounded-md after:absolute after:-inset-1.5 hover:bg-background"
            aria-label="Mes anterior"
          >
            <ChevronLeft className="size-4" />
          </button>
          <MonthPicker
            period={period}
            current={current}
            onSelect={goPeriod}
          />
          <button
            onClick={() => goMonth(1)}
            className="relative grid size-8 place-items-center rounded-md after:absolute after:-inset-1.5 hover:bg-background"
            aria-label="Mes siguiente"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      }
    >
      <div className="mx-auto w-full max-w-6xl px-4 pt-1 pb-6 lg:px-8 lg:py-6">
        <h1 className="sr-only">Movimientos</h1>
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start lg:gap-16">
          <section aria-label="Lista de movimientos" className="min-w-0">
            {result.items.length === 0 ? (
              <div className="glass rounded-xl px-6 py-12 text-center">
                <p className="font-medium">
                  {hasFilters
                    ? "No hay movimientos con estos filtros"
                    : `No hay movimientos en ${monthName(period.month).toLowerCase()}`}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {hasFilters
                    ? "Prueba otra descripción, cambia los filtros o elige otro mes."
                    : "Cuando lleguen los cargos del banco o registres uno, aparecen aquí."}
                </p>
              </div>
            ) : (
              <div className="glass flex flex-col gap-0.5 rounded-xl p-2">
                {groups.map((g) => (
                  <div key={g.key}>
                    <div className="px-3 pt-2 pb-1 text-xs text-muted-foreground">
                      {g.header}
                    </div>
                    {g.txs.map((tx) => (
                      <MovementRow key={tx.id} tx={tx} onOpen={setDetailTx} />
                    ))}
                  </div>
                ))}
              </div>
            )}

            {totalPages > 1 && (
              <nav
                aria-label="Paginación"
                className="flex flex-col gap-3 px-1 pt-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <p className="tabular text-sm text-muted-foreground">
                  {result.items.length > 0
                    ? `Mostrando ${first}–${last} de ${result.total} movimientos`
                    : `${result.total} movimientos`}
                </p>
                <div className="flex w-full items-center gap-2 sm:w-auto">
                  <PageButton
                    href={result.page > 1 ? pageHref(result.page - 1) : null}
                  >
                    Anterior
                  </PageButton>
                  <span className="tabular px-2 text-sm text-muted-foreground">
                    {result.page} / {totalPages}
                  </span>
                  <PageButton
                    href={
                      result.page < totalPages
                        ? pageHref(result.page + 1)
                        : null
                    }
                  >
                    Siguiente
                  </PageButton>
                </div>
              </nav>
            )}
          </section>

          <aside
            aria-label="Buscar y filtrar"
            className="glass flex min-w-0 flex-col gap-6 rounded-xl px-5 pt-5 pb-6 max-lg:order-first lg:sticky lg:top-6"
          >
            <TransactionFilters
              value={values}
              onChange={changeFilters}
              categories={categories}
              accounts={accounts}
              amountBounds={amountBounds}
              inputId={SEARCH_INPUT_ID}
            />
          </aside>
        </div>
      </div>

      <TransactionModal
        tx={detailTx}
        categories={categories}
        accounts={accounts}
        onOpenChange={(o) => !o && setDetailTx(null)}
      />
    </AppShell>
  )
}

// Botón de paginación: un link mientras haya a dónde ir; deshabilitado en el borde.
function PageButton({
  href,
  children,
}: {
  href: string | null
  children: ReactNode
}) {
  const className = "h-11 flex-1 sm:flex-none"
  if (!href)
    return (
      <Button variant="outline" disabled className={className}>
        {children}
      </Button>
    )
  return (
    <Button asChild variant="outline" className={className}>
      <Link href={href}>{children}</Link>
    </Button>
  )
}
