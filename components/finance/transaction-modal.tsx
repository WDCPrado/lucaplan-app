"use client";

import * as React from "react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ResponsiveModal } from "@/components/ui/responsive-modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useMoneyInput } from "@/hooks/use-money-input";
import { CategoryIcon } from "./category-icons";
import { formatCLP } from "@/lib/finance-format";
import type { CurrencyCode } from "@/arch/v1/domain/finance/money";
import type { TransactionDTO, CategoryDTO } from "@/arch/v1/application/finance-use-cases/finance-read";

const STATUS_LABEL: Record<string, string> = {
  confirmed: "Confirmado",
  pending: "Pendiente",
  reversed: "Reversado",
  duplicated: "Duplicado",
};

const fullDate = (iso: string) =>
  new Date(iso).toLocaleDateString("es-CL", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

// Movimiento manual → editable (form tipo crear + eliminar). Movimiento de Fintoc → solo lectura.
export function TransactionModal({
  tx,
  categories,
  onOpenChange,
}: {
  tx: TransactionDTO | null;
  categories: CategoryDTO[];
  onOpenChange: (o: boolean) => void;
}) {
  return (
    <ResponsiveModal open={tx !== null} onOpenChange={onOpenChange} title={tx?.editable ? "Editar movimiento" : "Movimiento del banco"}>
      {tx &&
        (tx.editable ? (
          <EditForm key={tx.id} tx={tx} categories={categories} onClose={() => onOpenChange(false)} />
        ) : (
          <ConnectedDetail key={tx.id} tx={tx} categories={categories} onClose={() => onOpenChange(false)} />
        ))}
    </ResponsiveModal>
  );
}

function EditForm({ tx, categories, onClose }: { tx: TransactionDTO; categories: CategoryDTO[]; onClose: () => void }) {
  const router = useRouter();
  const [description, setDescription] = useState(tx.description);
  const [direction, setDirection] = useState<"debit" | "credit">(tx.direction === "credit" ? "credit" : "debit");
  const [categoryId, setCategoryId] = useState<string | null>(tx.categoryId);
  const [date, setDate] = useState(tx.date.slice(0, 10));
  const money = useMoneyInput(tx.currency as CurrencyCode, Math.abs(tx.amount));
  const [busy, setBusy] = useState<null | "save" | "delete">(null);

  const canSave = money.value > 0 && description.trim() !== "" && busy === null;

  // Categorías filtradas por el lado elegido (gasto/ingreso); al cambiar de lado se limpia si no calza.
  const visibleCategories = categories.filter((c) => c.type === (direction === "credit" ? "income" : "expense"));

  function changeDirection(d: "debit" | "credit") {
    setDirection(d);
    const t = d === "credit" ? "income" : "expense";
    if (categoryId && categories.find((c) => c.id === categoryId)?.type !== t) setCategoryId(null);
  }

  async function save() {
    if (!canSave) return;
    setBusy("save");
    const res = await fetch(`/api/transactions/${tx.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: description.trim(), amount: money.value, direction, categoryId, date }),
    });
    setBusy(null);
    if (res.ok) {
      onClose();
      router.refresh();
    }
  }

  async function remove() {
    setBusy("delete");
    const res = await fetch(`/api/transactions/${tx.id}`, { method: "DELETE" });
    setBusy(null);
    if (res.ok) {
      onClose();
      router.refresh();
    }
  }

  return (
    <div className="flex flex-col gap-5 px-4 pb-6">
      <Input
        placeholder="Descripción"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        className="h-12 border-0 bg-transparent px-0 text-2xl font-bold shadow-none focus-visible:ring-0"
      />
      <div className="flex items-center gap-3">
        <div className="flex overflow-hidden rounded-full border">
          <button type="button" onClick={() => changeDirection("debit")} className={cn("size-11 text-xl", direction === "debit" && "bg-destructive text-destructive-foreground")}>
            −
          </button>
          <button type="button" onClick={() => changeDirection("credit")} className={cn("size-11 text-xl", direction === "credit" && "bg-success text-success-foreground")}>
            +
          </button>
        </div>
        <Input
          inputMode="numeric"
          value={money.display}
          onChange={(e) => money.onChange(e.target.value)}
          className={cn(
            "tabular h-12 border-0 bg-transparent px-0 text-3xl font-bold shadow-none focus-visible:ring-0",
            direction === "debit" ? "text-destructive" : "text-success",
          )}
        />
      </div>

      <div>
        <Label className="mb-1 block text-xs">Fecha</Label>
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-11" />
      </div>

      <div>
        <Label className="mb-1 block text-xs">Categoría</Label>
        {visibleCategories.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin categorías de {direction === "credit" ? "ingreso" : "gasto"}.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {visibleCategories.map((c) => (
              <Chip key={c.id} active={c.id === categoryId} onClick={() => setCategoryId(c.id === categoryId ? null : c.id)}>
                <CategoryIcon icon={c.icon} size={16} color={c.color ?? undefined} /> {c.name}
              </Chip>
            ))}
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <Button variant="outline" onClick={remove} disabled={busy !== null} className="h-12 flex-1 rounded-full text-destructive hover:text-destructive">
          {busy === "delete" ? "Borrando…" : "Eliminar"}
        </Button>
        <Button onClick={save} disabled={!canSave} className="h-12 flex-2 rounded-full text-base">
          {busy === "save" ? "Guardando…" : "Guardar"}
        </Button>
      </div>
    </div>
  );
}

// Movimiento del banco (fintoc): datos de solo lectura, pero SÍ se puede asignar/cambiar la categoría.
function ConnectedDetail({ tx, categories, onClose }: { tx: TransactionDTO; categories: CategoryDTO[]; onClose: () => void }) {
  const router = useRouter();
  const income = tx.direction === "credit";
  const [categoryId, setCategoryId] = useState<string | null>(tx.categoryId);
  const [saving, setSaving] = useState(false);
  const changed = categoryId !== tx.categoryId;
  // Solo categorías del mismo lado del movimiento (ingreso ↔ credit, gasto ↔ debit).
  const visibleCategories = categories.filter((c) => c.type === (income ? "income" : "expense"));

  async function saveCategory() {
    setSaving(true);
    const res = await fetch(`/api/transactions/${tx.id}/category`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categoryId }),
    });
    setSaving(false);
    if (res.ok) {
      onClose();
      router.refresh();
    }
  }

  return (
    <div className="flex flex-col gap-6 px-4 pb-6">
      <div className="flex flex-col items-center gap-1 pt-2 text-center">
        <div className={`tabular text-4xl font-bold ${income ? "text-success" : "text-foreground"}`}>
          {income ? "+" : "−"}
          {formatCLP(Math.abs(tx.amount))}
        </div>
        <div className="text-sm text-balance text-muted-foreground">{tx.description}</div>
      </div>

      <dl className="flex flex-col">
        <Row label="Fecha" value={fullDate(tx.date)} />
        <Row label="Tipo" value={income ? "Ingreso" : "Gasto"} />
        <Row label="Estado" value={STATUS_LABEL[tx.status] ?? tx.status} />
      </dl>

      <div>
        <Label className="mb-2 block text-xs">Categoría</Label>
        {visibleCategories.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Sin categorías de {income ? "ingreso" : "gasto"}. Crea una para clasificar este movimiento.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {visibleCategories.map((c) => (
              <Chip key={c.id} active={c.id === categoryId} onClick={() => setCategoryId(c.id === categoryId ? null : c.id)}>
                <CategoryIcon icon={c.icon} size={16} color={c.color ?? undefined} /> {c.name}
              </Chip>
            ))}
          </div>
        )}
      </div>

      <Button onClick={saveCategory} disabled={!changed || saving} className="h-12 rounded-full text-base">
        {saving ? "Guardando…" : "Guardar categoría"}
      </Button>

      <p className="text-center text-xs text-muted-foreground">Movimiento del banco · solo se puede categorizar</p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/50 py-3 last:border-0">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-right text-sm font-medium">{value}</dd>
    </div>
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
