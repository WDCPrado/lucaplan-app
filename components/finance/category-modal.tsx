"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { ResponsiveModal } from "@/components/ui/responsive-modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useMoneyInput } from "@/hooks/use-money-input";
import { cn } from "@/lib/utils";
import { formatCLP, monthName } from "@/lib/finance-format";
import { ProgressRing } from "./progress-ring";
import { CATEGORY_COLORS, CATEGORY_ICONS, CategoryIcon } from "./category-icons";
import type { CategoryDTO } from "@/arch/v1/application/finance-use-cases/finance-read";

// Crear o editar categoría (global) + su límite del mes, siempre en modal. `category` ⇒ edición.
// Campos agrupados por intención: identidad → presupuesto → apariencia → descripción IA (colapsable),
// con vista previa en vivo arriba. `remainingToAllocate` = restante por presupuestar del mes (null
// sin límite global), para la ayuda en vivo bajo el campo límite.
export function CategoryModal({
  open,
  onOpenChange,
  period,
  category,
  remainingToAllocate,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  period: { year: number; month: number };
  category?: CategoryDTO | null;
  remainingToAllocate?: number | null;
}) {
  const router = useRouter();
  const isEdit = !!category;
  const [name, setName] = useState(category?.name ?? "");
  const [type, setType] = useState<"income" | "expense">((category?.type as "income" | "expense") ?? "expense");
  const [description, setDescription] = useState(category?.description ?? "");
  const limit = useMoneyInput("CLP", category?.limit ?? 0);
  const [icon, setIcon] = useState(category?.icon ?? "");
  const [color, setColor] = useState(category?.color ?? CATEGORY_COLORS[0]);
  const [saving, setSaving] = useState(false);

  const canSave = !!name.trim() && !saving;

  // Color legacy fuera de la paleta: se muestra como swatch extra para no perderlo al editar.
  const palette = CATEGORY_COLORS.includes(color) ? CATEGORY_COLORS : [...CATEGORY_COLORS, color];

  // Restante en vivo: restante del mes + límite efectivo original − límite en pantalla.
  // Null (oculto) sin límite global definido o en categorías de ingreso.
  const liveRemaining =
    remainingToAllocate == null || type !== "expense" ? null : remainingToAllocate + (category?.limit ?? 0) - limit.value;

  // Vista previa: el anillo usa el uso real (edición) contra el límite en pantalla; crear parte en 0.
  const previewPct = isEdit && limit.value > 0 ? ((category?.used ?? 0) / limit.value) * 100 : 0;

  async function save() {
    if (!canSave) return;
    setSaving(true);
    // 1) Categoría global (nombre/tipo/icono/color)
    const catRes = await fetch("/api/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: category?.id, name: name.trim(), type, icon, color, description: description.trim() }),
    });
    if (!catRes.ok) {
      setSaving(false);
      toast.error("No se pudo guardar la categoría");
      return;
    }
    const categoryId = category?.id ?? ((await catRes.json()).id as string);
    // 2) Límite del mes: solo para categorías de gasto (las de ingreso no tienen tope).
    if (type === "expense") {
      const limRes = await fetch("/api/category-limits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoryId, year: period.year, month: period.month, limit: limit.value }),
      });
      if (!limRes.ok) {
        setSaving(false);
        toast.error("La categoría se guardó, pero el límite no. Vuelve a intentarlo.");
        return;
      }
    }
    setSaving(false);
    onOpenChange(false);
    router.refresh();
  }

  return (
    <ResponsiveModal open={open} onOpenChange={onOpenChange} title={isEdit ? "Editar categoría" : "Nueva categoría"}>
      <div className="flex flex-col gap-5 px-4 pb-6">
        {/* Vista previa en vivo: como se verá en Presupuestos */}
        <div className="flex flex-col items-center gap-1.5">
          <ProgressRing percent={previewPct} status={category?.status ?? "bueno"} size={80}>
            <CategoryIcon icon={icon} size={26} color={color} />
          </ProgressRing>
          <div className="max-w-full truncate text-sm font-semibold">{name.trim() || "Nueva categoría"}</div>
        </div>

        {/* Identidad */}
        <div>
          <Label className="mb-1 block text-xs">Nombre</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Compras" className="h-11 text-base" />
        </div>
        <div>
          <Label className="mb-1 block text-xs">Tipo</Label>
          <div className="flex gap-2">
            {(["expense", "income"] as const).map((t) => (
              <button
                key={t}
                type="button"
                disabled={isEdit}
                onClick={() => setType(t)}
                className={cn(
                  "h-11 flex-1 rounded-full border text-sm font-medium",
                  type === t
                    ? t === "income"
                      ? "border-success bg-success/10 text-success"
                      : "border-primary bg-primary/10 text-primary"
                    : "text-muted-foreground",
                  isEdit && "cursor-not-allowed opacity-50",
                )}
              >
                {t === "income" ? "Ingreso" : "Gasto"}
              </button>
            ))}
          </div>
          {isEdit && (
            <p className="mt-1 text-xs text-muted-foreground">El tipo no se puede cambiar en una categoría existente.</p>
          )}
        </div>

        {/* Presupuesto (solo gasto) */}
        {type === "expense" && (
          <div>
            <Label className="mb-1 block text-xs">Límite de {monthName(period.month)} (CLP)</Label>
            <Input
              inputMode="numeric"
              value={limit.display}
              onChange={(e) => limit.onChange(e.target.value)}
              placeholder="70.000"
              className="tabular h-11 text-base"
            />
            {liveRemaining !== null && (
              <p className={cn("mt-1 text-xs", liveRemaining < 0 ? "text-destructive" : "text-muted-foreground")}>
                {liveRemaining < 0
                  ? `Sobre-asignado por ${formatCLP(-liveRemaining)} del presupuesto de ${monthName(period.month)}`
                  : `Quedan ${formatCLP(liveRemaining)} por presupuestar en ${monthName(period.month)}`}
              </p>
            )}
          </div>
        )}

        {/* Apariencia */}
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
          <Label className="mb-1 block text-xs">Color</Label>
          <div className="flex flex-wrap gap-2">
            {palette.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                aria-label={`Color ${c}`}
                aria-pressed={color === c}
                className={cn(
                  "size-9 rounded-full border-2 transition-transform",
                  color === c ? "scale-110 border-foreground" : "border-transparent hover:scale-105",
                )}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>

        {/* Descripción IA (colapsable; abierta solo si ya tiene texto) */}
        <Collapsible defaultOpen={!!description}>
          <CollapsibleTrigger className="flex w-full items-center justify-between py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground [&[data-state=open]>svg]:rotate-180">
            Descripción para la IA (opcional)
            <ChevronDown className="size-4 transition-transform" />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Ej: comida y mercadería para la casa (Jumbo, Líder, Unimarc)"
              rows={2}
              className="mt-1 resize-none text-base"
            />
            <p className="mt-1 text-xs text-muted-foreground">Ayuda a la IA a categorizar tus movimientos del banco.</p>
          </CollapsibleContent>
        </Collapsible>

        <Button onClick={save} disabled={!canSave} className="h-12 rounded-full text-base">
          {saving ? "Guardando…" : "Guardar"}
        </Button>
      </div>
    </ResponsiveModal>
  );
}
