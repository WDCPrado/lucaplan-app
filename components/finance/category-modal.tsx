"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ResponsiveModal } from "@/components/ui/responsive-modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useMoneyInput } from "@/hooks/use-money-input";
import { cn } from "@/lib/utils";
import { monthName } from "@/lib/finance-format";
import { CATEGORY_ICONS } from "./category-icons";
import type { CategoryDTO } from "@/arch/v1/application/finance-use-cases/finance-read";

// Crear o editar categoría (global) + su límite del mes, siempre en modal. `category` ⇒ edición.
export function CategoryModal({
  open,
  onOpenChange,
  period,
  category,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
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

  async function save() {
    if (!canSave) return;
    setSaving(true);
    // 1) Categoría global (nombre/icono/color)
    const catRes = await fetch("/api/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: category?.id, name: name.trim(), icon, color }),
    });
    if (!catRes.ok) {
      setSaving(false);
      return;
    }
    const categoryId = category?.id ?? ((await catRes.json()).id as string);
    // 2) Límite para el mes actual
    await fetch("/api/category-limits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categoryId, year: period.year, month: period.month, limit: limit.value }),
    });
    setSaving(false);
    onOpenChange(false);
    router.refresh();
  }

  return (
    <ResponsiveModal open={open} onOpenChange={onOpenChange} title={category ? "Editar categoría" : "Nueva categoría"}>
        <div className="flex flex-col gap-4 px-4 pb-6">
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
          </div>
          <div>
            <Label className="mb-1 block text-xs">Límite de {monthName(period.month)} (CLP)</Label>
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
    </ResponsiveModal>
  );
}
