"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ResponsiveModal } from "@/components/ui/responsive-modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useMoneyInput } from "@/hooks/use-money-input";
import { CategoryIcon } from "./category-icons";
import type { CurrencyCode } from "@/arch/v1/domain/finance/money";
import type { AccountDTO, CategoryDTO } from "@/arch/v1/application/finance-use-cases/finance-read";

export function AddTransactionSheet({
  open,
  onOpenChange,
  accounts,
  categories,
  onCreateAccount,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  accounts: AccountDTO[];
  categories: CategoryDTO[];
  onCreateAccount: () => void;
}) {
  const router = useRouter();
  const [direction, setDirection] = useState<"debit" | "credit">("debit");
  const [description, setDescription] = useState("");
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Cuenta activa: la seleccionada o la primera (cubre el caso de crear una cuenta recién).
  const account = accounts.find((a) => a.id === accountId) ?? accounts[0];
  const money = useMoneyInput((account?.currency as CurrencyCode) ?? "CLP");
  const amountNum = money.value;
  const canSave = amountNum > 0 && !!account && !saving;

  // Cuenta conectada por correo: solo abonos/ingresos (los cargos llegan solos por correo).
  // Se deriva en render: cambiar a una cuenta conectada fuerza el lado sin tocar el estado.
  const incomeOnly = !!account && account.provider !== "manual";
  const effDirection = incomeOnly ? "credit" : direction;

  // Las categorías se filtran por el lado elegido: gasto → categorías de gasto, ingreso → de ingreso.
  const wantType = effDirection === "credit" ? "income" : "expense";
  const visibleCategories = categories.filter((c) => c.type === wantType);

  function changeDirection(d: "debit" | "credit") {
    setDirection(d);
    const t = d === "credit" ? "income" : "expense";
    if (categoryId && categories.find((c) => c.id === categoryId)?.type !== t) setCategoryId(null);
  }

  async function save() {
    if (!canSave || !account) return;
    setSaving(true);
    const res = await fetch("/api/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accountId: account.id,
        // Solo una categoría del lado visible (cambiar de cuenta puede voltear el lado).
        categoryId: visibleCategories.some((c) => c.id === categoryId) ? categoryId : null,
        amount: amountNum,
        currency: account.currency,
        direction: effDirection,
        description: description || "Movimiento",
      }),
    });
    setSaving(false);
    if (res.ok) {
      money.reset();
      setDescription("");
      setCategoryId(null);
      onOpenChange(false);
      router.refresh();
    }
  }

  return (
    <ResponsiveModal open={open} onOpenChange={onOpenChange} title="Nueva transacción">
        {accounts.length === 0 ? (
          <div className="flex flex-col items-center gap-4 px-4 py-10 text-center">
            <p className="text-sm text-muted-foreground">
              Necesitas una tarjeta para registrar movimientos a mano.
            </p>
            <Button onClick={onCreateAccount} className="h-12 rounded-full">
              Nueva tarjeta
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-5 px-4 pb-6">
          <Input
            placeholder="Descripción"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="h-12 border-0 bg-transparent px-0 text-2xl font-bold shadow-none focus-visible:ring-0"
          />
          <div className="flex items-center gap-3">
            <div className="flex overflow-hidden rounded-full border">
              <button
                type="button"
                onClick={() => changeDirection("debit")}
                disabled={incomeOnly}
                title={incomeOnly ? "Los cargos de esta cuenta llegan solos por correo" : undefined}
                className={cn(
                  "size-11 text-xl",
                  effDirection === "debit" && "bg-destructive text-destructive-foreground",
                  incomeOnly && "cursor-not-allowed opacity-40",
                )}
              >
                −
              </button>
              <button
                type="button"
                onClick={() => changeDirection("credit")}
                className={cn("size-11 text-xl", effDirection === "credit" && "bg-success text-success-foreground")}
              >
                +
              </button>
            </div>
            <Input
              inputMode="numeric"
              placeholder="0"
              value={money.display}
              onChange={(e) => money.onChange(e.target.value)}
              className={cn(
                "tabular h-12 border-0 bg-transparent px-0 text-3xl font-bold shadow-none focus-visible:ring-0",
                effDirection === "debit" ? "text-destructive" : "text-success",
              )}
            />
          </div>
          {incomeOnly && (
            <p className="-mt-2 text-xs text-muted-foreground">
              Cuenta conectada: aquí solo se registran abonos e ingresos — los cargos llegan solos
              desde el correo del banco.
            </p>
          )}

          {accounts.length > 1 && (
            <div className="scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
              {accounts.map((a) => (
                <Chip key={a.id} active={a.id === account?.id} onClick={() => setAccountId(a.id)}>
                  {a.name}
                </Chip>
              ))}
            </div>
          )}

          <div className="scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
            {visibleCategories.length === 0 ? (
              <span className="text-sm text-muted-foreground">Sin categorías de {direction === "credit" ? "ingreso" : "gasto"}.</span>
            ) : (
              visibleCategories.map((c) => (
                <Chip key={c.id} active={c.id === categoryId} onClick={() => setCategoryId(c.id === categoryId ? null : c.id)}>
                  <CategoryIcon icon={c.icon} size={16} /> {c.name}
                </Chip>
              ))
            )}
          </div>

          <Button onClick={save} disabled={!canSave} className="h-12 rounded-full text-base">
            {saving ? "Guardando…" : "✓ Guardar"}
          </Button>
          </div>
        )}
    </ResponsiveModal>
  );
}

function Chip({ active, onClick, children }: { active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-11 shrink-0 items-center gap-1.5 rounded-full border px-4 text-sm whitespace-nowrap",
        active ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground",
      )}
    >
      {children}
    </button>
  );
}
