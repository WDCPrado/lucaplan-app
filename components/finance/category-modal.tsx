"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useMoneyInput } from "@/hooks/use-money-input";
import { cn } from "@/lib/utils";
import { CATEGORY_ICONS } from "./category-icons";
import type { CategoryDTO } from "@/arch/v1/application/finance-use-cases/finance-read";

// Crear o editar categoría, siempre en modal. `category` presente ⇒ edición (precargado).
export function CategoryModal({
  open,
  onOpenChange,
  budgetId,
  period,
  category,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  budgetId: string | null;
  period: { year: number; month: number };
  category?: CategoryDTO | null;
}) {
  const router = useRouter();
  const [name, setName] = useState(category?.name ?? "");
  const limit = useMoneyInput("CLP", category?.limit ?? 0);
  const [icon, setIcon] = useState(category?.icon ?? "");
  const [color, setColor] = useState(category?.color ?? "#6366f1");
  const [saving, setSaving] = useState(false);

  const canSave = name.trim() && limit.value >= 0 && !saving;

  // Si el mes aún no tiene presupuesto, lo crea antes de la categoría (onboarding sin fricción).
  async function ensureBudgetId(): Promise<string | null> {
    if (budgetId) return budgetId;
    const res = await fetch("/api/budgets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: `Presupuesto ${period.month}/${period.year}`, year: period.year, month: period.month }),
    });
    if (!res.ok) return null;
    return (await res.json()).id as string;
  }

  async function save() {
    if (!canSave) return;
    setSaving(true);
    const bId = await ensureBudgetId();
    if (!bId) {
      setSaving(false);
      return;
    }
    const res = await fetch("/api/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: category?.id, budgetId: bId, name: name.trim(), limit: limit.value, icon, color }),
    });
    setSaving(false);
    if (res.ok) {
      onOpenChange(false);
      router.refresh();
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-3xl">
        <SheetHeader>
          <SheetTitle>{category ? "Editar categoría" : "Nueva categoría"}</SheetTitle>
        </SheetHeader>
        <div className="flex max-h-[80dvh] flex-col gap-4 overflow-y-auto px-4 pb-6">
          <div>
            <Label className="mb-1 block text-xs">Nombre</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Compras" className="h-11" />
          </div>
          <div>
            <Label className="mb-1 block text-xs">Icono</Label>
            <div className="grid grid-cols-8 gap-2">
              {CATEGORY_ICONS.map(({ name: n, Icon }) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setIcon(n)}
                  className={cn(
                    "grid size-9 place-items-center rounded-lg border",
                    icon === n ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground",
                  )}
                  aria-label={n}
                >
                  <Icon size={18} />
                </button>
              ))}
            </div>
            <Input
              value={icon.length <= 2 ? icon : ""}
              onChange={(e) => setIcon(e.target.value.slice(0, 2))}
              placeholder="…o pega un emoji"
              className="mt-2 h-10 text-center text-lg"
            />
          </div>
          <div>
            <Label className="mb-1 block text-xs">Límite mensual (CLP)</Label>
            <Input
              inputMode="numeric"
              value={limit.display}
              onChange={(e) => limit.onChange(e.target.value)}
              placeholder="70.000"
              className="tabular h-11"
            />
          </div>
          <div>
            <Label className="mb-1 block text-xs">Color</Label>
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-11 w-full rounded-md border bg-transparent" />
          </div>
          <Button onClick={save} disabled={!canSave} className="h-12 rounded-full text-base">
            {saving ? "Guardando…" : "Guardar"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
