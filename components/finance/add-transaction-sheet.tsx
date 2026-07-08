"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
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

  async function save() {
    if (!canSave || !account) return;
    setSaving(true);
    const res = await fetch("/api/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accountId: account.id,
        categoryId,
        amount: amountNum,
        currency: account.currency,
        direction,
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
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[92dvh] rounded-t-3xl">
        <SheetHeader>
          <SheetTitle>Nueva transacción</SheetTitle>
        </SheetHeader>
        {accounts.length === 0 ? (
          <div className="flex flex-col items-center gap-4 px-4 py-10 text-center">
            <p className="text-sm text-muted-foreground">Necesitas una cuenta para registrar movimientos.</p>
            <Button onClick={onCreateAccount} className="h-12 rounded-full">
              Crear cuenta
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-5 overflow-y-auto px-4 pb-6">
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
                onClick={() => setDirection("debit")}
                className={cn("size-11 text-xl", direction === "debit" && "bg-destructive text-destructive-foreground")}
              >
                −
              </button>
              <button
                type="button"
                onClick={() => setDirection("credit")}
                className={cn("size-11 text-xl", direction === "credit" && "bg-success text-success-foreground")}
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
                direction === "debit" ? "text-destructive" : "text-success",
              )}
            />
          </div>

          {accounts.length > 1 && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {accounts.map((a) => (
                <Chip key={a.id} active={a.id === account?.id} onClick={() => setAccountId(a.id)}>
                  {a.name}
                </Chip>
              ))}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {categories.map((c) => (
              <Chip key={c.id} active={c.id === categoryId} onClick={() => setCategoryId(c.id === categoryId ? null : c.id)}>
                <CategoryIcon icon={c.icon} size={16} /> {c.name}
              </Chip>
            ))}
          </div>

          <Button onClick={save} disabled={!canSave} className="h-12 rounded-full text-base">
            {saving ? "Guardando…" : "✓ Guardar"}
          </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Chip({ active, onClick, children }: { active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-11 items-center gap-1.5 rounded-full border px-4 text-sm whitespace-nowrap",
        active ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground",
      )}
    >
      {children}
    </button>
  );
}
