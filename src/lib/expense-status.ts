export type ExpenseStatus = "paga" | "atrasada" | "vence_7d" | "em_aberto";
export const EXPENSE_STATUS_LABEL: Record<ExpenseStatus, string> = { paga: "Paga", atrasada: "Atrasada", vence_7d: "Vence em até 7 dias", em_aberto: "Em aberto" };
/** Rótulo com a janela configurada (Configurações › Financeiro › "Vence em até N dias"). */
export const expenseStatusLabel = (s: ExpenseStatus, venceEmDias: number): string => (s === "vence_7d" ? `Vence em até ${venceEmDias} dias` : EXPENSE_STATUS_LABEL[s]);

const utc = (iso: string) => { const [y, m, d] = iso.split("-").map(Number); return Date.UTC(y, m - 1, d); };

/** Paga vence tudo; atrasada é antes de hoje; "vence_7d" é de hoje até N dias à frente (N = venceEmDias, padrão 7); o resto, em aberto. */
export function expenseStatus(e: { dueOn: string; paidOn: string | null }, today: string, venceEmDias = 7): ExpenseStatus {
  if (e.paidOn) return "paga";
  const diff = Math.round((utc(e.dueOn) - utc(today)) / 86_400_000);
  if (diff < 0) return "atrasada";
  return diff <= venceEmDias ? "vence_7d" : "em_aberto";
}

/** n vencimentos mensais a partir do primeiro: mantém o dia e cai no último dia do mês quando o mês é mais curto. */
export function monthlyDueDates(firstDue: string, n: number): string[] {
  const [y, m, d] = firstDue.split("-").map(Number);
  return Array.from({ length: n }, (_, i) => {
    const total = (m - 1) + i, yy = y + Math.floor(total / 12), mm = (total % 12) + 1;
    const last = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
    return `${yy}-${String(mm).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
  });
}
