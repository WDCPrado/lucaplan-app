"use client"

import { Button } from "glisse"
import { Button as SlotButton } from "@/components/ui/button"

import { useRef, useState, type ReactNode } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { SlidersHorizontal } from "lucide-react"

import { formatDateHeader, fromYmd, monthName } from "@/lib/finance-format"

import { ResponsiveModal } from "@/components/ui/responsive-modal"
import { AppShell } from "./app-shell"
import { MonthNav } from "./month-nav"
import { MovementRow } from "./movement-row"
import { TransactionModal } from "./transaction-modal"
import {
  FilterControls,
  SearchField,
  activeFilterCount,
  filtersToParams,
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

// Pantalla Movimientos: la cartola del mes (o ciclo) paginada por el servidor, con el campo que
// filtra la lista y sus filtros al lado (escritorio) o, en el celular, el campo arriba y el resto
// tras «Filtros (n)». Los filtros viven en la URL: el
// servidor lee la página con ellos, y recargar o compartir el enlace muestra lo mismo.
export function MovementsView({
  period,
  current,
  cycleRange,
  result,
  accounts,
  categories,
  amountBounds,
  filters,
}: {
  period: { year: number; month: number }
  current: { year: number; month: number }
  // Rango del ciclo en modo tarjeta: la etiqueta del selector dice «Ciclo …» como en el Inicio.
  cycleRange?: { start: string; end: string }
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
  const [filtersOpen, setFiltersOpen] = useState(false)

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
  function pageHref(page: number) {
    const params = new URLSearchParams(searchParams.toString())
    if (page > 1) params.set("page", String(page))
    else params.delete("page")
    return `/movements?${params.toString()}`
  }

  const filterCount = activeFilterCount(values, amountBounds)
  const filterProps = {
    value: values,
    onChange: changeFilters,
    categories,
    accounts,
    amountBounds,
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
      actions={
        <MonthNav
          period={period}
          current={current}
          cycleRange={cycleRange}
          onNavigate={goPeriod}
        />
      }
    >
      <div className="mx-auto w-full max-w-6xl px-4 pt-1 pb-6 md:pt-6 lg:px-8">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start lg:gap-16">
          {/* Filtrar la lista (no es la búsqueda global). Móvil: el campo y «Filtros (n)», que abre
              el resto en una hoja; escritorio: todo abierto en el panel lateral. */}
          <aside
            aria-label="Filtrar movimientos"
            className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-24 lg:col-start-2 lg:row-start-1 lg:gap-6 lg:rounded-xl lg:bg-card lg:px-5 lg:pt-5 lg:pb-6"
          >
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <SearchField
                  value={values}
                  onChange={changeFilters}
                  inputId={SEARCH_INPUT_ID}
                />
              </div>
              <Button
                type="button"
                onClick={() => setFiltersOpen(true)}
                className="h-11 shrink-0 text-subheadline lg:hidden"
              >
                <SlidersHorizontal className="size-4" />
                Filtros{filterCount > 0 && ` (${filterCount})`}
              </Button>
            </div>
            <div className="flex flex-col gap-6 max-lg:hidden">
              <FilterControls {...filterProps} />
            </div>
          </aside>

          <section aria-label="Lista de movimientos" className="min-w-0 lg:col-start-1 lg:row-start-1">
            {result.items.length === 0 ? (
              <div className="glass rounded-xl px-6 py-12 text-center">
                <p className="text-body font-medium">
                  {hasFilters
                    ? "No hay movimientos con estos filtros"
                    : `No hay movimientos en ${monthName(period.month).toLowerCase()}`}
                </p>
                <p className="mt-1 text-subheadline text-muted-foreground">
                  {hasFilters
                    ? "Prueba otra descripción, cambia los filtros o elige otro mes."
                    : "Cuando lleguen los cargos del banco o registres uno, aparecen aquí."}
                </p>
              </div>
            ) : (
              // Mismo patrón que el Inicio: el día en footnote fuera de la tarjeta y una lista
              // agrupada por día.
              <div className="flex flex-col gap-5">
                {groups.map((g) => (
                  <div key={g.key}>
                    <h2 className="mb-1.5 px-4 text-footnote font-medium text-muted-foreground">
                      {g.header}
                    </h2>
                    <div className="glass inset-list flex flex-col overflow-hidden rounded-xl [--inset:4.5rem]">
                      {g.txs.map((tx) => (
                        <MovementRow
                          key={tx.id}
                          tx={tx}
                          onOpen={setDetailTx}
                          className="press rounded-none px-4 hover:bg-accent"
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {totalPages > 1 && (
              <nav
                aria-label="Paginación"
                className="flex flex-col gap-3 px-1 pt-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <p className="tabular text-subheadline text-muted-foreground">
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
                  <span className="tabular px-2 text-subheadline text-muted-foreground">
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
        </div>
      </div>

      <ResponsiveModal
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        title="Filtros"
      >
        <div className="flex flex-col gap-6 px-5 pb-6">
          <FilterControls {...filterProps} />
        </div>
      </ResponsiveModal>

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
      <Button disabled className={className}>
        {children}
      </Button>
    )
  return (
    <SlotButton asChild variant="outline" className={className}>
      <Link href={href}>{children}</Link>
    </SlotButton>
  )
}
