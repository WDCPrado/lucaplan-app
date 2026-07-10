"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Eye, EyeOff } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { useDragScroll } from "@/hooks/use-drag-scroll";
import { AppShell, type NavKey } from "./app-shell";
import { AccountCard } from "./account-card";
import { MovementsList } from "./movements-list";
import { ProgressRing } from "./progress-ring";
import { CategoryIcon } from "./category-icons";
import { AddTransactionSheet } from "./add-transaction-sheet";
import { CategoryModal } from "./category-modal";
import { CategoryDetailSheet } from "./category-detail-sheet";
import { AccountModal } from "./account-modal";
import { ConnectBankButton } from "./connect-bank-button";
import { TransactionModal } from "./transaction-modal";
import { formatCLP, formatCompact, monthName } from "@/lib/finance-format";
import type {
  AccountDTO,
  BudgetViewDTO,
  CategoryDTO,
  MonthlySummaryDTO,
  TransactionDTO,
} from "@/arch/v1/application/finance-use-cases/finance-read";

type Props = {
  period: { year: number; month: number };
  summary: MonthlySummaryDTO;
  accounts: AccountDTO[];
  budget: BudgetViewDTO;
  transactions: TransactionDTO[];
  user: { name: string; initial: string; email: string };
};

// Dashboard desktop-first: AppShell (sidebar + topbar + FAB) con el contenido en grid
// multi-columna. Las mutaciones van por la API + router.refresh() dentro de cada superficie.
export function Dashboard({ period, summary, accounts, budget, transactions, user }: Props) {
  const router = useRouter();
  const [showBalance, setShowBalance] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [detail, setDetail] = useState<CategoryDTO | null>(null);
  const [detailTx, setDetailTx] = useState<TransactionDTO | null>(null);
  const [editCat, setEditCat] = useState<CategoryDTO | null | undefined>(undefined); // undefined=cerrado, null=crear
  const { ref: cardsRef, handlers: cardsHandlers } = useDragScroll();
  const [refreshing, setRefreshing] = useState<string | null>(null);

  // Solo cuentas manuales aceptan movimientos a mano; las conectadas (fintoc) son de solo lectura.
  const manualAccounts = accounts.filter((a) => a.provider === "manual");

  // Refresco manual de un banco conectado: re-sincroniza (incremental) y recarga.
  async function refreshBank(bankId: string) {
    setRefreshing(bankId);
    await fetch("/api/fintoc/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bankId }),
    });
    setRefreshing(null);
    router.refresh();
  }

  // Desconectar un banco: elimina sus cuentas y todos sus movimientos (con confirmación).
  async function disconnectBank(bankId: string, bankName: string) {
    if (!window.confirm(`¿Desconectar ${bankName}? Se eliminarán sus cuentas y todos sus movimientos.`)) return;
    setRefreshing(bankId);
    await fetch("/api/fintoc/disconnect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bankId }),
    });
    setRefreshing(null);
    router.refresh();
  }

  function goMonth(delta: number) {
    const d = new Date(Date.UTC(period.year, period.month - 1 + delta, 1));
    router.push(`/dashboard?year=${d.getUTCFullYear()}&month=${d.getUTCMonth() + 1}`);
  }

  async function signOut() {
    await authClient.signOut();
    router.push("/login");
  }

  // Nav de una sola página: Inicio → arriba; Movimientos/Presupuestos → scroll a su sección.
  function navigate(key: NavKey) {
    if (key === "inicio") {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    document.getElementById(key)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <AppShell
      user={user}
      onNavigate={navigate}
      onSignOut={signOut}
      onAdd={() => setAddOpen(true)}
      title="Resumen"
      actions={
        <div className="flex items-center gap-1 rounded-full bg-secondary px-1.5 py-1">
          <button onClick={() => goMonth(-1)} className="grid size-8 place-items-center rounded-full hover:bg-background" aria-label="Mes anterior">
            <ChevronLeft className="size-4" />
          </button>
          <span className="min-w-20 text-center text-sm font-semibold">{monthName(period.month)}</span>
          <button onClick={() => goMonth(1)} className="grid size-8 place-items-center rounded-full hover:bg-background" aria-label="Mes siguiente">
            <ChevronRight className="size-4" />
          </button>
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
            className="-mx-4 flex cursor-grab snap-x gap-4 overflow-x-auto px-4 pb-4 active:cursor-grabbing lg:mx-0 lg:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            <div className="glass flex min-h-40 w-72 shrink-0 snap-start flex-col justify-between rounded-2xl p-5">
              <div className="text-sm text-muted-foreground">Saldo bancario</div>
              <div className="tabular my-3 text-3xl font-bold">{showBalance ? formatCLP(summary.activeCash) : "••••••"}</div>
              <div className="grid grid-cols-3 gap-2 border-t border-border/50 pt-3 text-center">
                <Stat label="Ingresos" value={formatCompact(summary.income, true)} className="text-success" />
                <Stat label="Gastos" value={formatCompact(-summary.expense)} />
                <Stat label="Presup." value={formatCompact(summary.totalBudget)} />
              </div>
            </div>
            {accounts.map((a) => (
              <div key={a.id} className="flex w-72 shrink-0 snap-start">
                <AccountCard
                  account={a}
                  hidden={!showBalance}
                  onRefresh={a.provider === "fintoc" ? () => refreshBank(a.bankId) : undefined}
                  onDisconnect={a.provider === "fintoc" ? () => disconnectBank(a.bankId, a.bankName) : undefined}
                  refreshing={refreshing === a.bankId}
                />
              </div>
            ))}
            <ConnectBankButton />
            <button
              onClick={() => setAccountOpen(true)}
              className="flex min-h-40 w-72 shrink-0 snap-start flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-border text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
            >
              <span className="text-2xl">＋</span>
              <span className="text-sm font-medium">Nueva tarjeta</span>
            </button>
          </div>

          {(summary.overdraftDebt > 0 || summary.creditCardDebts.length > 0) && (
            <div className="mt-4 flex flex-wrap gap-2">
              {summary.overdraftDebt > 0 && <DebtPill label="Sobregiro" value={summary.overdraftDebt} />}
              {summary.creditCardDebts.map((d) => (
                <DebtPill key={d.accountId} label={d.name} value={d.debt} />
              ))}
            </div>
          )}
        </section>

        {/* Presupuestos + Movimientos */}
        <div className="mt-8 grid gap-6 lg:grid-cols-3">
          <section id="presupuestos" className="min-w-0 scroll-mt-20 lg:order-2 lg:col-span-1 lg:sticky lg:top-20 lg:self-start">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-heading text-lg font-bold">Presupuestos</h2>
              <span className="text-sm text-muted-foreground">{monthName(period.month)}</span>
            </div>
            <div className="glass rounded-2xl p-4">
              {budget.categories.length === 0 ? (
                <button onClick={() => setEditCat(null)} className="flex w-full flex-col items-center gap-2 py-6 text-muted-foreground">
                  <span className="grid size-18 place-items-center rounded-full border-2 border-dashed border-border text-2xl">+</span>
                  <span className="text-sm">Crear categoría</span>
                </button>
              ) : (
                <div className="grid grid-cols-3 gap-4 sm:grid-cols-4 lg:grid-cols-2">
                  {budget.categories.map((c) => {
                    const pct = c.limit > 0 ? (c.used / c.limit) * 100 : 0;
                    return (
                      <button key={c.id} onClick={() => setDetail(c)} className="flex flex-col items-center gap-1.5">
                        <ProgressRing percent={pct} status={c.status} size={72}>
                          <CategoryIcon icon={c.icon} size={22} color={c.color ?? undefined} />
                        </ProgressRing>
                        <div className="text-center">
                          <div className="truncate text-xs font-medium">{c.name}</div>
                          <div className="tabular text-xs text-muted-foreground">{formatCLP(c.available)}</div>
                        </div>
                      </button>
                    );
                  })}
                  <button onClick={() => setEditCat(null)} className="flex flex-col items-center gap-1.5" aria-label="Nueva categoría">
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
      <CategoryDetailSheet
        category={detail}
        transactions={transactions}
        onOpenChange={(o) => !o && setDetail(null)}
        onEdit={(c) => {
          setDetail(null);
          setEditCat(c);
        }}
      />
      <CategoryModal open={editCat !== undefined} onOpenChange={(o) => !o && setEditCat(undefined)} period={period} category={editCat} />
      <TransactionModal tx={detailTx} categories={budget.categories} onOpenChange={(o) => !o && setDetailTx(null)} />
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

function DebtPill({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="tabular font-semibold text-destructive">−{formatCLP(value)}</div>
    </div>
  );
}
