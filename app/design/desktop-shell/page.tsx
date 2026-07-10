"use client";

// MOCK desechable del shell desktop-first real: AppShell (shadcn sidebar colapsable, dropdown
// de usuario, command ⌘K, toggle de tema) + layout multi-columna + TODAS las superficies de
// creación/edición (adaptativas: dialog en escritorio, sheet en móvil). Datos en memoria.
import { useState } from "react";
import { ChevronLeft, ChevronRight, Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDragScroll } from "@/hooks/use-drag-scroll";
import { AppShell, type NavKey } from "@/components/finance/app-shell";
import { MovementRow } from "@/components/finance/movement-row";
import { ProgressRing } from "@/components/finance/progress-ring";
import { CategoryIcon } from "@/components/finance/category-icons";
import { AddTransactionSheet } from "@/components/finance/add-transaction-sheet";
import { AccountModal } from "@/components/finance/account-modal";
import { CategoryModal } from "@/components/finance/category-modal";
import { CategoryDetailSheet } from "@/components/finance/category-detail-sheet";
import { formatCLP, formatCompact, monthName } from "@/lib/finance-format";
import type {
  AccountDTO,
  CategoryDTO,
  TransactionDTO,
} from "@/arch/v1/application/finance-use-cases/finance-read";

// ---- datos mock ------------------------------------------------------------
const SUMMARY = { activeCash: 2_450_000, income: 1_800_000, expense: 920_000, totalBudget: 1_100_000 };

const ACCOUNTS: AccountDTO[] = [
  { id: "acc-8842", bankId: "b1", bankName: "Banco de Chile", name: "Cuenta Corriente", accountType: "checking", currency: "CLP", balance: 1_250_000, color: "#1e40af", cardLast4: "8842", provider: "fintoc" },
  { id: "acc-1120", bankId: "b2", bankName: "BancoEstado", name: "Ahorro", accountType: "savings", currency: "CLP", balance: 900_000, color: "#0f766e", cardLast4: null, provider: "manual" },
  { id: "acc-3390", bankId: "b3", bankName: "Santander", name: "Visa", accountType: "credit_card", currency: "CLP", balance: -340_000, color: "#7c3aed", cardLast4: "3390", provider: "manual" },
];

const CATEGORIES: CategoryDTO[] = [
  { id: "c1", name: "Supermercado", type: "expense", icon: "ShoppingCart", color: "#16a34a", limit: 400_000, used: 260_000, available: 140_000, status: "moderado" },
  { id: "c2", name: "Transporte", type: "expense", icon: "Car", color: "#2563eb", limit: 150_000, used: 60_000, available: 90_000, status: "bueno" },
  { id: "c3", name: "Comida fuera", type: "expense", icon: "Utensils", color: "#ea580c", limit: 120_000, used: 135_000, available: -15_000, status: "excedido" },
  { id: "c4", name: "Servicios", type: "expense", icon: "Zap", color: "#ca8a04", limit: 180_000, used: 120_000, available: 60_000, status: "moderado" },
  { id: "c5", name: "Entretención", type: "expense", icon: "Film", color: "#db2777", limit: 100_000, used: 40_000, available: 60_000, status: "bueno" },
];

const TX: TransactionDTO[] = [
  { id: "t1", accountId: "acc-8842", currency: "CLP", editable: true, description: "Jumbo Costanera", amount: 45_990, direction: "debit", date: "2026-07-08", status: "confirmed", categoryId: "c1", categoryName: "Supermercado", categoryIcon: "ShoppingCart", categoryColor: "#16a34a", remaining: 140_000 },
  { id: "t2", accountId: "acc-8842", currency: "CLP", editable: true, description: "Sueldo Julio", amount: 1_800_000, direction: "credit", date: "2026-07-05", status: "confirmed", categoryId: null, categoryName: "Ingreso", categoryIcon: "TrendingUp", categoryColor: "#16a34a", remaining: null },
  { id: "t3", accountId: "acc-8842", currency: "CLP", editable: true, description: "Copec", amount: 38_000, direction: "debit", date: "2026-07-04", status: "confirmed", categoryId: "c2", categoryName: "Transporte", categoryIcon: "Fuel", categoryColor: "#2563eb", remaining: 90_000 },
  { id: "t4", accountId: "acc-8842", currency: "CLP", editable: true, description: "Starbucks", amount: 6_500, direction: "debit", date: "2026-07-03", status: "confirmed", categoryId: "c3", categoryName: "Comida fuera", categoryIcon: "Coffee", categoryColor: "#ea580c", remaining: -15_000 },
  { id: "t5", accountId: "acc-8842", currency: "CLP", editable: true, description: "Cuenta Luz Enel", amount: 42_300, direction: "debit", date: "2026-07-02", status: "confirmed", categoryId: "c4", categoryName: "Servicios", categoryIcon: "Zap", categoryColor: "#ca8a04", remaining: 60_000 },
  { id: "t6", accountId: "acc-8842", currency: "CLP", editable: true, description: "Netflix", amount: 9_990, direction: "debit", date: "2026-07-01", status: "confirmed", categoryId: "c5", categoryName: "Entretención", categoryIcon: "Film", categoryColor: "#db2777", remaining: 60_000 },
];

// ---------------------------------------------------------------------------
export default function DesktopShellMock() {
  const [active, setActive] = useState<NavKey>("inicio");
  const [month, setMonth] = useState(7);
  const [showBalance, setShowBalance] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [detail, setDetail] = useState<CategoryDTO | null>(null);
  const [editCat, setEditCat] = useState<CategoryDTO | null | undefined>(undefined); // undefined=cerrado, null=crear
  const { ref: cardsRef, handlers: cardsHandlers } = useDragScroll();

  return (
    <AppShell
      user={{ name: "Wellington", initial: "W", email: "contacto@lucaplan.cl" }}
      active={active}
      onNavigate={setActive}
      onSignOut={() => alert("Cerrar sesión (mock)")}
      onAdd={() => setAddOpen(true)}
      title="Resumen"
      actions={
        <div className="flex items-center gap-1 rounded-full bg-secondary px-1.5 py-1">
          <button onClick={() => setMonth((m) => (m > 1 ? m - 1 : 12))} className="grid size-8 place-items-center rounded-full hover:bg-background" aria-label="Mes anterior">
            <ChevronLeft className="size-4" />
          </button>
          <span className="min-w-20 text-center text-sm font-semibold">{monthName(month)}</span>
          <button onClick={() => setMonth((m) => (m < 12 ? m + 1 : 1))} className="grid size-8 place-items-center rounded-full hover:bg-background" aria-label="Mes siguiente">
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
              <div className="text-sm text-muted-foreground">Saldo disponible</div>
              <div className="tabular my-3 text-3xl font-bold">{showBalance ? formatCLP(SUMMARY.activeCash) : "••••••"}</div>
              <div className="grid grid-cols-3 gap-2 border-t border-border/50 pt-3 text-center">
                <Stat label="Ingresos" value={formatCompact(SUMMARY.income, true)} className="text-success" />
                <Stat label="Gastos" value={formatCompact(-SUMMARY.expense)} />
                <Stat label="Presup." value={formatCompact(SUMMARY.totalBudget)} />
              </div>
            </div>
            {ACCOUNTS.map((a) => (
              <div key={a.id} className="flex w-72 shrink-0 snap-start">
                <AccountTile account={a} hidden={!showBalance} />
              </div>
            ))}
            <button
              onClick={() => setAccountOpen(true)}
              className="flex min-h-40 w-72 shrink-0 snap-start flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-border text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
            >
              <span className="text-2xl">＋</span>
              <span className="text-sm font-medium">Nueva cuenta</span>
            </button>
          </div>
        </section>

        {/* Presupuestos + Movimientos */}
        <div className="mt-8 grid gap-6 lg:grid-cols-3">
          <section className="lg:order-2 lg:col-span-1">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-heading text-lg font-bold">Presupuestos</h2>
              <span className="text-sm text-muted-foreground">{monthName(month)}</span>
            </div>
            <div className="glass rounded-2xl p-4">
              <div className="grid grid-cols-3 gap-4 sm:grid-cols-4 lg:grid-cols-2">
                {CATEGORIES.map((c) => {
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
            </div>
          </section>

          <section className="lg:order-1 lg:col-span-2">
            <div className="mb-1 flex items-center justify-between">
              <h2 className="font-heading text-lg font-bold">Movimientos</h2>
              <span className="text-sm text-muted-foreground">{TX.length} este mes</span>
            </div>
            <div className="glass-strong divide-y divide-border/60 rounded-2xl px-4">
              {TX.map((t) => (
                <MovementRow key={t.id} tx={t} />
              ))}
            </div>
          </section>
        </div>
      </div>

      {/* Superficies (adaptativas: dialog en escritorio, sheet en móvil) */}
      <AddTransactionSheet
        open={addOpen}
        onOpenChange={setAddOpen}
        accounts={ACCOUNTS}
        categories={CATEGORIES}
        onCreateAccount={() => {
          setAddOpen(false);
          setAccountOpen(true);
        }}
      />
      <AccountModal open={accountOpen} onOpenChange={setAccountOpen} />
      <CategoryDetailSheet
        category={detail}
        transactions={TX}
        onOpenChange={(o) => !o && setDetail(null)}
        onEdit={(c) => {
          setDetail(null);
          setEditCat(c);
        }}
      />
      <CategoryModal open={editCat !== undefined} onOpenChange={(o) => !o && setEditCat(undefined)} period={{ year: 2026, month }} category={editCat} />
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

// Tarjeta de cuenta a ancho completo (versión de grid; la AccountCard real usa w-72 para carrusel).
function AccountTile({ account, hidden }: { account: AccountDTO; hidden: boolean }) {
  return (
    <div className="relative flex min-h-40 w-full flex-col justify-between overflow-hidden rounded-2xl p-5 text-white shadow-[0_2px_8px_-2px_rgb(0_0_0/0.1),0_16px_32px_-12px_rgb(0_0_0/0.22)]" style={{ background: account.color ?? "var(--primary)" }}>
      <div className="text-lg font-semibold tracking-tight">{account.bankName}</div>
      <div>
        <div className="text-xs text-white/70">Saldo {account.currency}</div>
        <div className="tabular text-2xl font-semibold">{hidden ? "••••••" : formatCLP(account.balance)}</div>
      </div>
      <div className="flex items-center justify-between text-sm text-white/80">
        <span className="tabular tracking-widest">•••• {account.id.slice(-4)}</span>
        <span className="capitalize">{account.accountType.replace("_", " ")}</span>
      </div>
    </div>
  );
}
