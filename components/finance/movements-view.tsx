"use client"

import { useRef, useState, useTransition, type ReactNode } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { SlidersHorizontal } from "lucide-react"

import { formatDateHeader, fromYmd, monthName } from "@/lib/finance-format"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { ResponsiveModal } from "@/components/ui/responsive-modal"
import { AppShell } from "./app-shell"
import { MonthNav } from "./month-nav"
import { SectionCard } from "./blocks"
import { Segmented } from "./segmented"
import { MovementRow } from "./movement-row"
import { TransactionModal } from "./transaction-modal"
import {
  FilterControls,
  SearchField,
  DIRS,
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

// Pantalla Movimientos: la cartola del mes (o ciclo) paginada por el servidor. Arriba (o a la
// derecha en escritorio ancho) cuántos movimientos hay, el campo que filtra la lista y sus filtros;
// en el celular, el tipo a la vista y el resto tras «Filtros (n)». Los filtros viven en la URL: el
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
  // Mientras el servidor trae la lista filtrada, la actual se atenúa (sin esqueleto que salte).
  const [loading, startLoading] = useTransition()

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
        startLoading(() =>
          router.replace(`/movements?${params.toString()}`, { scroll: false })
        )
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
    startLoading(() => router.push(`/movements?${params.toString()}`))
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

  const mes = monthName(period.month).toLowerCase()
  const totalLabel = result.total.toLocaleString("es-CL")

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
      <div className="page-container">
        <div className="grid grid-cols-1 gap-4 md:gap-6 xl:grid-cols-3">
          {/* Resumen y filtros de la lista (no es la búsqueda global). Móvil y tablet: la cifra, el
              campo, «Filtros (n)» que abre el resto en una hoja y el tipo a la vista. Escritorio
              ancho: columna derecha pegada, con el panel de filtros abierto. */}
          <div className="min-w-0 xl:col-start-3 xl:row-start-1">
            <aside
              aria-label="Filtrar movimientos"
              className="flex min-w-0 flex-col gap-4 md:gap-6 xl:sticky xl:top-20"
            >
              <section
                aria-labelledby="movements-summary"
                className="flex min-w-0 flex-col rounded-xl bg-card p-(--pad-card)"
              >
                <h2 id="movements-summary" className="text-body text-ink-2">
                  {hasFilters
                    ? "Movimientos con tus filtros"
                    : cycleRange
                      ? `Movimientos del ciclo de ${mes}`
                      : `Movimientos de ${mes}`}
                </h2>
                <p className="text-display font-semibold whitespace-nowrap">
                  {totalLabel}
                </p>
                {totalPages > 1 && (
                  <p className="text-callout text-ink-2">
                    Página {result.page} de {totalPages}
                  </p>
                )}
                <div className="mt-4 flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <SearchField
                      value={values}
                      onChange={changeFilters}
                      inputId={SEARCH_INPUT_ID}
                    />
                  </div>
                  {/* Botón que se comporta como toggle: con filtros puestos queda en acento suave. */}
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setFiltersOpen(true)}
                    aria-label={
                      filterCount > 0 ? `Filtros, ${filterCount} ${filterCount === 1 ? "activo" : "activos"}` : "Filtros"
                    }
                    className={cn(
                      "xl:hidden",
                      filterCount > 0 && "bg-primary-soft text-primary hover:bg-primary-soft"
                    )}
                  >
                    <SlidersHorizontal aria-hidden />
                    Filtros
                    {filterCount > 0 && <span>{filterCount}</span>}
                  </Button>
                </div>
                {/* El tipo es el filtro de todos los días: a la vista, sin abrir la hoja. */}
                <Segmented
                  label="Tipo de movimiento"
                  value={values.direction === "" ? "all" : values.direction}
                  onChange={(d) =>
                    changeFilters({ ...values, direction: d === "all" ? "" : d })
                  }
                  options={DIRS}
                  className="mt-3 w-full xl:hidden"
                />
              </section>

              <SectionCard title="Filtros" className="max-xl:hidden">
                <div className="flex flex-col gap-4">
                  <FilterControls {...filterProps} />
                </div>
              </SectionCard>
            </aside>
          </div>

          <section
            aria-label="Lista de movimientos"
            aria-busy={loading || undefined}
            className="flex min-w-0 flex-col rounded-xl bg-card p-(--pad-card) transition-opacity duration-200 aria-busy:opacity-60 motion-reduce:transition-none xl:col-span-2 xl:col-start-1 xl:row-start-1"
          >
            {result.items.length === 0 ? (
              <div className="flex flex-col gap-1 py-6">
                <p className="text-title font-semibold">
                  {hasFilters
                    ? "No hay movimientos con estos filtros"
                    : `No hay movimientos en ${mes}`}
                </p>
                <p className="text-callout text-ink-2">
                  {hasFilters
                    ? "Prueba otra descripción, cambia los filtros o elige otro mes."
                    : "Los cargos llegan desde el correo del banco y aparecen aquí."}
                </p>
              </div>
            ) : (
              // Agrupada por día: el día como encabezado y sus filas debajo.
              <div className="flex flex-col gap-5">
                {groups.map((g) => (
                  <div key={g.key}>
                    <h2 className="mb-1 text-callout font-semibold text-ink-2">
                      {g.header}
                    </h2>
                    <div className="flex flex-col gap-2">
                      {g.txs.map((tx) => (
                        <MovementRow
                          key={tx.id}
                          tx={tx}
                          onOpen={setDetailTx}
                          className="-mx-3 w-[calc(100%+1.5rem)]"
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
                className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <p className="text-callout text-ink-2">
                  {result.items.length > 0
                    ? `${first}–${last} de ${totalLabel}`
                    : `${totalLabel} movimientos`}
                </p>
                <div className="flex w-full items-center gap-2 sm:w-auto">
                  <PageButton
                    href={result.page > 1 ? pageHref(result.page - 1) : null}
                  >
                    Anterior
                  </PageButton>
                  <span className="px-2 text-callout whitespace-nowrap text-ink-2">
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
        <div className="flex flex-col gap-4">
          <FilterControls {...filterProps} hideDirection />
        </div>
        {/* Los filtros se aplican al tocarlos: sin check. La salida visible es la X de la hoja. */}
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
  const className = "flex-1 sm:flex-none"
  if (!href)
    return (
      <Button variant="secondary" disabled className={className}>
        {children}
      </Button>
    )
  return (
    <Button asChild variant="secondary" className={className}>
      <Link href={href}>{children}</Link>
    </Button>
  )
}
