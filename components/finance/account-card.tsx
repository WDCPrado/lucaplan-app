import type { AccountDTO } from "@/arch/v1/application/finance-use-cases/finance-read";
import { formatCLP } from "@/lib/finance-format";

const TYPE_LABEL: Record<string, string> = {
  checking: "Débito",
  savings: "Ahorro",
  credit_card: "Crédito",
  credit_line: "Línea",
  wallet: "Billetera",
  investment: "Inversión",
};

export function AccountCard({ account, hidden }: { account: AccountDTO; hidden?: boolean }) {
  return (
    <div
      className="relative flex h-44 w-72 shrink-0 snap-start flex-col justify-between overflow-hidden rounded-2xl p-5 text-white shadow-lg"
      style={{ background: account.color ?? "var(--primary)" }}
    >
      <div className="text-lg font-semibold tracking-tight">{account.bankName || account.name}</div>
      <div>
        <div className="text-xs text-white/70">Saldo {account.currency}</div>
        <div className="tabular text-3xl font-semibold">{hidden ? "••••••" : formatCLP(account.balance)}</div>
      </div>
      <div className="flex items-center justify-between text-sm text-white/80">
        <span className="tabular tracking-widest">•••• {account.id.slice(-4)}</span>
        <span>{TYPE_LABEL[account.accountType] ?? account.accountType}</span>
      </div>
    </div>
  );
}
