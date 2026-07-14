"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Eye, EyeOff, Pencil } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/haptics";
import { useDragScroll } from "@/hooks/use-drag-scroll";
import { AppShell, type NavKey } from "./app-shell";
import { MonthPicker } from "./month-picker";
import { AccountCard } from "./account-card";
import { MovementsList } from "./movements-list";
import { ProgressRing } from "./progress-ring";
import { CategoryIcon } from "./category-icons";
import { AddTransactionSheet } from "./add-transaction-sheet";
import { CategoryModal } from "./category-modal";
import { BudgetLimitModal } from "./budget-limit-modal";
import { CategoryDetailSheet } from "./category-detail-sheet";
import { AccountModal } from "./account-modal";
import { AccountInfoModal } from "./account-info-modal";
import { SyncBancoChileButton } from "./sync-bancochile-button";
import { CategorizationAutoRefresh } from "./categorization-auto-refresh";
import { UncategorizedTriage } from "./uncategorized-triage";
import { TransactionModal } from "./transaction-modal";
import { TransactionSearch } from "./transaction-search";
import { formatCLP, formatCompact, monthName } from "@/lib/finance-format";
import type {
  AccountDTO,
  BudgetViewDTO,
  CategoryDTO,
  MonthlySummaryDTO,
  TransactionDTO,
  UncategorizedDTO,
} from "@/arch/v1/application/finance-use-cases/finance-read";

type Props = {
  period: { year: number; month: number };
  summary: MonthlySummaryDTO;
  accounts: AccountDTO[];
  budget: BudgetViewDTO;
  transactions: TransactionDTO[];
  uncategorized: UncategorizedDTO;
  user: { name: string; initial: string; email: string };
};

// Dashboard desktop-first: AppShell (sidebar + topbar + FAB) con el contenido en grid
// multi-columna. Las mutaciones van por la API + router.refresh() dentro de cada superficie.
export function Dashboard({ period, summary, accounts, budget, transactions, uncategorized, user }: Props) {
  const router = useRouter();
  const [showBalance, setShowBalance] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [detail, setDetail] = useState<CategoryDTO | null>(null);
  const [detailTx, setDetailTx] = useState<TransactionDTO | null>(null);
  const [editCat, setEditCat] = useState<CategoryDTO | null | undefined>(undefined); // undefined=cerrado, null=crear
  const { ref: cardsRef, handlers: cardsHandlers } = useDragScroll();
  const [infoAccount, setInfoAccount] = useState<AccountDTO | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [budgetLimitOpen, setBudgetLimitOpen] = useState(false);
  // Triage de sin categoría: descartado no reaparece hasta la PRÓXIMA carga (el estado vive en
  // el cliente; recargar la app lo resetea). Se monta solo mientras está abierto.
  const [triageDismissed, setTriageDismissed] = useState(false);
  const triageOpen = uncategorized.transactions.length > 0 && !triageDismissed;

  // Solo cuentas manuales aceptan movimientos a mano; las conectadas (fintoc) son de solo lectura.
  const manualAccounts = accounts.filter((a) => a.provider === "manual");
  // ¿Hay banco conectado? → montar el auto-refresh que sigue la categorización de fondo.
  const hasConnected = accounts.some((a) => a.provider === "fintoc");
  // El presupuesto es de gastos: solo categorías de gasto tienen tope/uso. Las de ingreso solo
  // clasifican (aparecen al categorizar movimientos de ingreso, no en esta grilla).
  const expenseCategories = budget.categories.filter((c) => c.type === "expense");
  // Sobre-asignado: los límites de categoría superan el límite global del mes (alerta, no bloquea).
  const overAllocated = budget.remainingToAllocate !== null && budget.remainingToAllocate < 0;

  function goMonth(delta: number) {
    const d = new Date(Date.UTC(period.year, period.month - 1 + delta, 1));
    router.push(`/dashboard?year=${d.getUTCFullYear()}&month=${d.getUTCMonth() + 1}`);
  }

  const now = new Date();
  const isCurrentMonth = period.year === now.getUTCFullYear() && period.month === now.getUTCMonth() + 1;

  // Fade del carrusel según posición: aparece a la izquierda al scrollear y desaparece
  // a la derecha al llegar al final. En móvil (snap-center, una tarjeta protagonista) además
  // escala cada tarjeta según su distancia al centro (zoom estilo wallet) y dispara un haptic
  // ligero cuando cambia la tarjeta activa.
  const carouselRaf = useRef(0);
  const activeCard = useRef(-1);
  function updateCarousel(el: HTMLElement) {
    el.style.setProperty("--fade-l", el.scrollLeft > 8 ? "2.5rem" : "0rem");
    el.style.setProperty("--fade-r", el.scrollLeft < el.scrollWidth - el.clientWidth - 8 ? "2.5rem" : "0rem");
    cancelAnimationFrame(carouselRaf.current);
    carouselRaf.current = requestAnimationFrame(() => {
      // Solo los ítems marcados: ConnectBankButton puede colar un overlay como hijo directo.
      const children = Array.from(el.querySelectorAll<HTMLElement>(":scope > [data-card]"));
      if (window.innerWidth >= 1024) {
        // Escritorio: snap-start sin zoom; limpia escalas residuales (p. ej. tras rotar tablet).
        for (const child of children) child.style.transform = "";
        activeCard.current = -1;
        return;
      }
      const viewCenter = el.scrollLeft + el.clientWidth / 2;
      let nearest = -1;
      let best = Infinity;
      children.forEach((child, i) => {
        // offsetLeft/offsetWidth son de layout: inmunes al scroll y al propio scale.
        const center = child.offsetLeft - el.offsetLeft + child.offsetWidth / 2;
        const dist = Math.abs(center - viewCenter);
        child.style.transform = `scale(${1 - 0.07 * Math.min(1, dist / el.clientWidth)})`;
        if (dist < best) {
          best = dist;
          nearest = i;
        }
      });
      if (nearest !== activeCard.current) {
        if (activeCard.current !== -1) haptic("light"); // no vibrar en el montaje
        activeCard.current = nearest;
      }
    });
  }

  // Zoom inicial: las escalas dependen de medidas del DOM, así que se aplican tras montar.
  useEffect(() => {
    if (cardsRef.current) updateCarousel(cardsRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al montar
  }, []);

  async function signOut() {
    await authClient.signOut();
    router.push("/login");
  }

  // Nav de una sola página: Inicio → arriba.
  function navigate(_key: NavKey) {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <AppShell
      user={user}
      onNavigate={navigate}
      onSignOut={signOut}
      onAdd={() => setAddOpen(true)}
      onSearch={() => setSearchOpen(true)}
      title="Resumen"
      actions={
        // Móvil: columna invertida → selector arriba y "Hoy" colgando debajo; escritorio: fila.
        <div className="flex flex-col-reverse items-center gap-2 md:flex-row">
          {!isCurrentMonth && (
            <button
              onClick={() => {
                haptic("light");
                router.push("/dashboard");
              }}
              className="rounded-full bg-secondary px-3.5 py-1.5 text-sm font-semibold transition-colors hover:bg-accent"
            >
              Hoy
            </button>
          )}
          <div className="flex items-center gap-1 rounded-full bg-secondary px-1.5 py-1">
            <button onClick={() => goMonth(-1)} className="grid size-8 place-items-center rounded-full hover:bg-background" aria-label="Mes anterior">
              <ChevronLeft className="size-4" />
            </button>
            <MonthPicker period={period} onSelect={(y, m) => router.push(`/dashboard?year=${y}&month=${m}`)} />
            <button onClick={() => goMonth(1)} className="grid size-8 place-items-center rounded-full hover:bg-background" aria-label="Mes siguiente">
              <ChevronRight className="size-4" />
            </button>
          </div>
        </div>
      }
    >
      <div className="mx-auto w-full max-w-6xl px-4 py-6 lg:px-8">
        {/* Cuentas */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-heading text-lg font-bold">Cuentas</h2>
            <button onClick={() => setShowBalance((v) => !v)} className="flex items-center gap-1.5 text-sm text-muted-foreground">
              {showBalance ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
              {showBalance ? "Ocultar" : "Mostrar"}
            </button>
          </div>
          <div
            ref={cardsRef}
            {...cardsHandlers}
            onScroll={(e) => updateCarousel(e.currentTarget)}
            // pt-1: aire para el hover -translate-y; mask con fade dinámico en ambos bordes
            // (izquierda solo al scrollear, derecha desaparece al llegar al final).
            // snap-mandatory: las tarjetas siempre asientan en un punto de snap (no quedan a
            // medias); en móvil centradas con lock (snap-always), en escritorio al inicio.
            className="scrollbar-none -mx-4 flex cursor-grab snap-x snap-mandatory gap-4 overflow-x-auto px-4 pt-1 pb-4 active:cursor-grabbing lg:mx-0 lg:px-0 mask-[linear-gradient(90deg,transparent,black_var(--fade-l,0rem),black_calc(100%-var(--fade-r,2.5rem)),transparent)]"
          >
            <div data-card className="glass flex min-h-40 w-72 shrink-0 snap-center snap-always flex-col justify-between rounded-2xl p-5 lg:snap-start">
              <div className="text-sm text-muted-foreground">Saldo bancario</div>
              <div className="tabular my-3 text-3xl font-bold">{showBalance ? formatCLP(summary.activeCash) : "••••••"}</div>
              <div className="grid grid-cols-3 gap-2 border-t border-border/50 pt-3 text-center">
                <Stat label="Ingresos" value={formatCompact(summary.income, true)} className="text-success" />
                <Stat label="Gastos" value={formatCompact(-summary.expense)} />
                <Stat label="Presup." value={formatCompact(summary.totalBudget)} />
              </div>
            </div>
            {accounts.map((a) => (
              <div key={a.id} data-card className="flex w-72 shrink-0 snap-center snap-always lg:snap-start">
                <AccountCard account={a} hidden={!showBalance} onClick={() => setInfoAccount(a)} />
              </div>
            ))}
            <SyncBancoChileButton />
          </div>
        </section>

        {/* Presupuestos + Movimientos */}
        <div className="mt-8 grid gap-6 lg:grid-cols-3">
          <section id="presupuestos" className="min-w-0 scroll-mt-20 lg:order-2 lg:col-span-1 lg:sticky lg:top-20 lg:self-start">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="font-heading text-lg font-bold">Presupuestos</h2>
              <span className="shrink-0 text-sm text-muted-foreground">{monthName(period.month)}</span>
            </div>
            <div className="glass rounded-2xl p-4">
              {/* Cabecera del límite global: restante por presupuestar (o CTA para definirlo) */}
              {budget.globalLimit === null ? (
                <button
                  onClick={() => setBudgetLimitOpen(true)}
                  className="mb-4 flex w-full items-center justify-between gap-3 rounded-xl border-2 border-dashed border-border px-4 py-3 text-left text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium">Definir presupuesto del mes</div>
                    <div className="text-xs">Fija un límite global para repartir entre categorías</div>
                  </div>
                  <span className="shrink-0 text-xl">＋</span>
                </button>
              ) : (
                <button
                  onClick={() => setBudgetLimitOpen(true)}
                  className="group mb-4 w-full rounded-xl bg-secondary/50 px-4 py-3 text-left transition-colors hover:bg-accent"
                  aria-label="Editar presupuesto del mes"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs uppercase text-muted-foreground">
                      {overAllocated ? "Sobre-asignado" : "Por presupuestar"}
                    </span>
                    <Pencil className="size-3.5 shrink-0 text-muted-foreground opacity-60 transition-opacity group-hover:opacity-100" />
                  </div>
                  <div className={cn("tabular text-2xl font-bold", overAllocated && "text-destructive")}>
                    {formatCLP(budget.remainingToAllocate ?? 0)}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    Asignado {formatCLP(budget.allocated)} de {formatCLP(budget.globalLimit)}
                  </div>
                </button>
              )}
              {expenseCategories.length === 0 ? (
                <button onClick={() => setEditCat(null)} className="flex w-full flex-col items-center gap-2 py-6 text-muted-foreground">
                  <span className="grid size-18 place-items-center rounded-full border-2 border-dashed border-border text-2xl">+</span>
                  <span className="text-sm">Crear categoría</span>
                </button>
              ) : (
                // Móvil: scroll-x sin wrap (más limpio que la grilla); escritorio: grid 2 col.
                <div className="scrollbar-none -mx-4 flex gap-4 overflow-x-auto px-4 lg:mx-0 lg:grid lg:grid-cols-2 lg:overflow-visible lg:px-0">
                  {expenseCategories.map((c) => {
                    const pct = c.limit > 0 ? (c.used / c.limit) * 100 : 0;
                    return (
                      <button key={c.id} onClick={() => setDetail(c)} className="flex w-20 shrink-0 flex-col items-center gap-1.5 lg:w-auto">
                        <ProgressRing percent={pct} status={c.status} size={72}>
                          <CategoryIcon icon={c.icon} size={22} color={c.color ?? undefined} />
                        </ProgressRing>
                        <div className="w-full text-center">
                          <div className="truncate text-xs font-medium">{c.name}</div>
                          <div className="tabular text-xs text-muted-foreground">{formatCLP(c.available)}</div>
                        </div>
                      </button>
                    );
                  })}
                  <button onClick={() => setEditCat(null)} className="flex w-20 shrink-0 flex-col items-center gap-1.5 lg:w-auto" aria-label="Nueva categoría">
                    <span className="grid size-18 place-items-center rounded-full border-2 border-dashed border-border text-2xl text-muted-foreground">+</span>
                    <span className="text-xs text-muted-foreground">Nueva</span>
                  </button>
                </div>
              )}
            </div>
          </section>

          <section id="movimientos" className="min-w-0 scroll-mt-20 lg:order-1 lg:col-span-2">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-heading text-lg font-bold">Movimientos</h2>
              <span className="text-sm text-muted-foreground">{transactions.length} este mes</span>
            </div>
            {transactions.length === 0 ? (
              <p className="glass-strong rounded-2xl py-10 text-center text-sm text-muted-foreground">Sin movimientos este mes</p>
            ) : (
              <MovementsList key={`${period.year}-${period.month}`} transactions={transactions} onOpen={setDetailTx} />
            )}
          </section>
        </div>
      </div>

      {/* Superficies (adaptativas: dialog en escritorio, sheet en móvil) */}
      <AddTransactionSheet
        open={addOpen}
        onOpenChange={setAddOpen}
        accounts={manualAccounts}
        categories={budget.categories}
        onCreateAccount={() => {
          setAddOpen(false);
          setAccountOpen(true);
        }}
      />
      <AccountModal open={accountOpen} onOpenChange={setAccountOpen} />
      <AccountInfoModal account={infoAccount} onOpenChange={(o) => !o && setInfoAccount(null)} />
      <CategoryDetailSheet
        // Derivada de las props frescas (no del snapshot en estado): si el modal de transacción
        // guarda encima y refresca, el usado/disponible del detalle se actualiza solo.
        category={detail && (expenseCategories.find((c) => c.id === detail.id) ?? detail)}
        transactions={transactions}
        // Con el modal de transacción abierto encima, su X / click fuera llega aquí como
        // "interact outside": se ignora para que solo se cierre el modal de arriba.
        onOpenChange={(o) => !o && detailTx === null && setDetail(null)}
        onEdit={(c) => {
          setDetail(null);
          setEditCat(c);
        }}
        onOpenTx={setDetailTx}
      />
      <CategoryModal
        key={editCat?.id ?? "new"}
        open={editCat !== undefined}
        onOpenChange={(o) => !o && setEditCat(undefined)}
        period={period}
        category={editCat}
        remainingToAllocate={budget.remainingToAllocate}
      />
      <BudgetLimitModal
        key={`${period.year}-${period.month}-${budget.globalLimit ?? "unset"}`}
        open={budgetLimitOpen}
        onOpenChange={setBudgetLimitOpen}
        period={period}
        current={budget.globalLimit}
      />
      <TransactionModal tx={detailTx} categories={budget.categories} accounts={accounts} onOpenChange={(o) => !o && setDetailTx(null)} />
      <TransactionSearch
        open={searchOpen}
        onOpenChange={setSearchOpen}
        categories={budget.categories}
        accounts={accounts}
        onOpenTransaction={(tx) => {
          setSearchOpen(false);
          setDetailTx(tx);
        }}
      />
      {triageOpen && (
        <UncategorizedTriage
          transactions={uncategorized.transactions}
          hasMore={uncategorized.hasMore}
          accounts={accounts}
          categories={budget.categories}
          onClose={() => setTriageDismissed(true)}
          onCreateCategory={() => {
            setTriageDismissed(true);
            setEditCat(null); // abre el modal de categoría existente; el triage vuelve en la próxima carga
          }}
        />
      )}
      {/* Auto-refresh pausado mientras el triage está abierto: sus router.refresh() reemplazarían
          las props del dashboard bajo el overlay en plena interacción. */}
      {hasConnected && !triageOpen && <CategorizationAutoRefresh />}
    </AppShell>
  );
}

function Stat({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div>
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div className={cn("tabular text-sm font-semibold", className)}>{value}</div>
    </div>
  );
}

