"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useMoneyInput } from "@/hooks/use-money-input";
import type { CurrencyCode } from "@/arch/v1/domain/finance/money";

const BANKS = ["Banco de Chile", "Santander", "BICE", "Mercado Pago", "Tenpo", "Racional", "Hapi"];

const TYPES: { value: string; label: string }[] = [
  { value: "checking", label: "Cuenta corriente" },
  { value: "credit_card", label: "Tarjeta de crédito" },
  { value: "savings", label: "Ahorro" },
  { value: "wallet", label: "Billetera" },
];

export function AccountModal({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const [bankName, setBankName] = useState("Banco de Chile");
  const [name, setName] = useState("");
  const [accountType, setAccountType] = useState("checking");
  const [currency, setCurrency] = useState<CurrencyCode>("CLP");
  const [color, setColor] = useState("#1e3a8a");
  const [saving, setSaving] = useState(false);
  const balance = useMoneyInput(currency, 0);

  const canSave = bankName.trim() && name.trim() && !saving;

  async function save() {
    if (!canSave) return;
    setSaving(true);
    const res = await fetch("/api/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bankName: bankName.trim(), name: name.trim(), accountType, currency, balance: balance.value, color }),
    });
    setSaving(false);
    if (res.ok) {
      setName("");
      balance.reset();
      onOpenChange(false);
      router.refresh();
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[92dvh] overflow-y-auto rounded-t-3xl">
        <SheetHeader>
          <SheetTitle>Nueva cuenta</SheetTitle>
        </SheetHeader>
        <div className="flex flex-col gap-4 px-4 pb-6">
          <div>
            <Label className="mb-1 block text-xs">Banco</Label>
            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
              {BANKS.map((b) => (
                <Chip key={b} active={bankName === b} onClick={() => setBankName(b)}>
                  {b}
                </Chip>
              ))}
            </div>
          </div>
          <div>
            <Label className="mb-1 block text-xs">Tipo de cuenta</Label>
            <div className="flex flex-wrap gap-2">
              {TYPES.map((t) => (
                <Chip key={t.value} active={accountType === t.value} onClick={() => setAccountType(t.value)}>
                  {t.label}
                </Chip>
              ))}
            </div>
          </div>
          <div>
            <Label className="mb-1 block text-xs">Nombre de la cuenta</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Cuenta corriente CLP" className="h-11" />
          </div>
          <div className="flex gap-2">
            {(["CLP", "USD"] as const).map((c) => (
              <Chip key={c} active={currency === c} onClick={() => setCurrency(c)}>
                {c}
              </Chip>
            ))}
          </div>
          <div>
            <Label className="mb-1 block text-xs">Saldo inicial</Label>
            <Input inputMode="numeric" value={balance.display} onChange={(e) => balance.onChange(e.target.value)} placeholder="0" className="tabular h-11" />
          </div>
          <div>
            <Label className="mb-1 block text-xs">Color</Label>
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-11 w-full rounded-md border bg-transparent" />
          </div>
          <Button onClick={save} disabled={!canSave} className="h-12 rounded-full text-base">
            {saving ? "Guardando…" : "Crear cuenta"}
          </Button>
        </div>
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
        "flex h-11 items-center rounded-full border px-4 text-sm whitespace-nowrap",
        active ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground",
      )}
    >
      {children}
    </button>
  );
}
