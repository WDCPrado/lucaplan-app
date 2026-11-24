// El color depende solo del gasto real / tope, nunca de lo reservado ni del ritmo diario.
export function spendingColors(spent: number, limit: number) {
  const ratio =
    limit > 0 ? Math.max(0, spent) / limit : spent > 0 ? Infinity : 0
  if (ratio <= 1 / 3)
    return { bar: "bg-success", text: "text-success", stroke: "var(--success)" }
  if (ratio <= 2 / 3)
    return {
      bar: "bg-warning-bar",
      text: "text-warning",
      stroke: "var(--warning-bar)",
    }
  return {
    bar: "bg-spent-high",
    text: "text-spent-high",
    stroke: "var(--spent-high)",
  }
}
