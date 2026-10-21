/** Período de repasse da profissional e o fim do último período já fechado. Datas em "YYYY-MM-DD". */
export const PAYOUT_PERIODS = ["mensal", "quinzenal", "semanal"] as const;
export type PayoutPeriod = (typeof PAYOUT_PERIODS)[number];
export const PAYOUT_PERIOD_LABEL: Record<PayoutPeriod, string> = { mensal: "Mensal", quinzenal: "Quinzenal", semanal: "Semanal (domingo a sábado)" };

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

/** O período termina no fim do dia: o dia do próprio fim ainda não está fechado em `today`. */
export function lastClosedPeriodEnd(period: PayoutPeriod, today: string): string {
  const [y, m, d] = today.split("-").map(Number);
  const prevMonthEnd = () => new Date(Date.UTC(y, m - 1, 0));
  if (period === "mensal") return iso(prevMonthEnd());
  if (period === "quinzenal") return d > 15 ? `${y}-${pad(m)}-15` : iso(prevMonthEnd());
  const t = new Date(Date.UTC(y, m - 1, d));
  const back = t.getUTCDay() === 6 ? 7 : t.getUTCDay() + 1; // sábado anterior, estritamente antes de hoje
  return iso(new Date(t.getTime() - back * 86400000));
}
