"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, ChevronLeft, ChevronRight, Home, ArrowLeftRight, BarChart3, Search, Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { AccountCard } from "./account-card";
import { MovementRow } from "./movement-row";
import { ProgressRing } from "./progress-ring";
import { AddTransactionSheet } from "./add-transaction-sheet";
import { CategoryModal } from "./category-modal";
import { CategoryDetailSheet } from "./category-detail-sheet";
import { AccountModal } from "./account-modal";
import { CategoryIcon } from "./category-icons";
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
  userInitial: string;
};

export function Dashboard({ period, summary, accounts, budget, transactions, userInitial }: Props) {
  const router = useRouter();
  const [tab, setTab] = useState<"resumen" | "presupuestos">("resumen");
  const [showBalance, setShowBalance] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [detail, setDetail] = useState<CategoryDTO | null>(null);
  const [editCat, setEditCat] = useState<CategoryDTO | null | undefined>(undefined); // undefined=cerrado, null=crear

  function goMonth(delta: number) {
    const d = new Date(Date.UTC(period.year, period.month - 1 + delta, 1));
    router.push(`/?year=${d.getUTCFullYear()}&month=${d.getUTCMonth() + 1}`);
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col px-4 pb-28">
      {/* Top bar */}
      <header className="flex items-center justify-between py-4">
        <button onClick={() => setAddOpen(true)} className="grid size-11 place-items-center rounded-full bg-secondary" aria-label="Agregar">
          <Plus className="size-5" />
        </button>
        <div className="flex items-center gap-1 rounded-full bg-secondary px-3 py-2">
          <button onClick={() => goMonth(-1)} aria-label="Mes anterior">
            <ChevronLeft className="size-4" />
          </button>
          <span className="min-w-20 text-center font-semibold">{monthName(period.month)}</span>
          <button onClick={() => goMonth(1)} aria-label="Mes siguiente">
            <ChevronRight className="size-4" />
          </button>
        </div>
        <Avatar className="size-11 bg-primary">
          <AvatarFallback className="bg-primary text-primary-foreground">{userInitial}</AvatarFallback>
        </Avatar>
      </header>

      {/* Tabs */}
      <div className="mb-4 flex gap-1 rounded-full bg-secondary p-1">
        {(["resumen", "presupuestos"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "h-10 flex-1 rounded-full text-sm font-medium capitalize transition-colors",
              tab === t ? "bg-background shadow-sm" : "text-muted-foreground",
            )}
          >
            {t === "resumen" ? "Resumen" : "Presupuestos"}
          </button>
        ))}
      </div>

      {tab === "resumen" ? (
        <ResumenTab
          summary={summary}
          accounts={accounts}
          showBalance={showBalance}
          onToggle={() => setShowBalance((v) => !v)}
          onCreateAccount={() => setAccountOpen(true)}
        />
      ) : (
        <PresupuestosTab budget={budget} onSelect={setDetail} onCreate={() => setEditCat(null)} />
      )}

      {/* Movimientos */}
      <section className="mt-6">
        <h2 className="mb-1 text-lg font-bold">Movimientos</h2>
        {transactions.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Sin movimientos este mes</p>
        ) : (
          <div className="divide-y">
            {transactions.map((t) => (
              <MovementRow key={t.id} tx={t} />
            ))}
          </div>
        )}
      </section>

      {/* Bottom nav */}
      <nav className="fixed inset-x-0 bottom-4 mx-auto flex max-w-xs items-center justify-around rounded-full bg-secondary/90 py-3 backdrop-blur">
        <Home className="size-6" />
        <ArrowLeftRight className="size-6 text-muted-foreground" />
        <BarChart3 className="size-6 text-muted-foreground" />
        <Search className="size-6 text-muted-foreground" />
      </nav>

      {/* Modales */}
      <AddTransactionSheet
        open={addOpen}
        onOpenChange={setAddOpen}
        accounts={accounts}
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
      <CategoryModal
        open={editCat !== undefined}
        onOpenChange={(o) => !o && setEditCat(undefined)}
        budgetId={budget.budgetId}
        period={period}
        category={editCat}
      />
    </div>
  );
}

function ResumenTab({
  summary,
  accounts,
  showBalance,
  onToggle,
  onCreateAccount,
}: {
  summary: MonthlySummaryDTO;
  accounts: AccountDTO[];
  showBalance: boolean;
  onToggle: () => void;
  onCreateAccount: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      {/* Un solo carrusel: saldo + tarjetas, mismo porte, scroll lateral con peek (full-bleed) */}
      <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="glass flex h-44 w-72 shrink-0 snap-start flex-col justify-between rounded-2xl p-5">
          <button onClick={onToggle} className="flex items-center gap-2 text-sm text-muted-foreground">
            Saldo bancario {showBalance ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
          </button>
          <div className="tabular text-3xl font-bold">{showBalance ? formatCLP(summary.activeCash) : "••••••"}</div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <Stat label="Ingresos" value={formatCompact(summary.income, true)} className="text-success" />
            <Stat label="Gastos" value={formatCompact(-summary.expense)} />
            <Stat label="Presup." value={formatCompact(summary.totalBudget)} />
          </div>
        </div>

        {accounts.map((a) => (
          <AccountCard key={a.id} account={a} hidden={!showBalance} />
        ))}

        <button
          onClick={onCreateAccount}
          className="flex h-44 w-72 shrink-0 snap-start flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed text-muted-foreground"
          aria-label="Agregar cuenta"
        >
          <span className="text-2xl">＋</span>
          <span className="text-sm font-medium">Nueva cuenta</span>
        </button>
      </div>

      {(summary.overdraftDebt > 0 || summary.creditCardDebts.length > 0) && (
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {summary.overdraftDebt > 0 && <DebtPill label="Sobregiro" value={summary.overdraftDebt} />}
          {summary.creditCardDebts.map((d) => (
            <DebtPill key={d.accountId} label={d.name} value={d.debt} />
          ))}
        </div>
      )}
    </div>
  );
}

function PresupuestosTab({
  budget,
  onSelect,
  onCreate,
}: {
  budget: BudgetViewDTO;
  onSelect: (c: CategoryDTO) => void;
  onCreate: () => void;
}) {
  return (
    <div className="-mx-4 flex gap-4 overflow-x-auto px-4 pb-2">
      {budget.categories.map((c) => {
        const pct = c.limit > 0 ? (c.used / c.limit) * 100 : 0;
        return (
          <button key={c.id} onClick={() => onSelect(c)} className="flex w-24 shrink-0 flex-col items-center gap-2">
            <ProgressRing percent={pct} status={c.status}>
              <CategoryIcon icon={c.icon} size={28} color={c.color ?? undefined} />
            </ProgressRing>
            <div className="text-center">
              <div className="tabular text-sm font-bold">{formatCLP(c.available)}</div>
              <div className="text-xs text-muted-foreground">disponible</div>
              <div className="tabular text-xs text-muted-foreground">de {formatCLP(c.limit)}</div>
            </div>
          </button>
        );
      })}
      <button onClick={onCreate} className="flex w-24 shrink-0 flex-col items-center gap-2" aria-label="Crear categoría">
        <span className="grid size-24 place-items-center rounded-full border-2 border-dashed text-3xl text-muted-foreground">+</span>
        <span className="text-xs text-muted-foreground">Nueva</span>
      </button>
    </div>
  );
}

function Stat({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground uppercase">{label}</div>
      <div className={cn("tabular font-semibold", className)}>{value}</div>
    </div>
  );
}

function DebtPill({ label, value }: { label: string; value: number }) {
  return (
    <div className="shrink-0 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="tabular font-semibold text-destructive">{formatCLP(value)}</div>
    </div>
  );
}
