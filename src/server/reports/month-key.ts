/** "AAAA-MM" do mês anterior a `now`, no horário de Salvador (UTC-3 fixo). */
export function previousMonthKey(now: Date): string {
  const l = new Date(now.getTime() - 3 * 3_600_000);
  const y = l.getUTCFullYear(), m = l.getUTCMonth(); // 0-11 do mês atual
  const py = m === 0 ? y - 1 : y, pm = m === 0 ? 12 : m;
  return `${py}-${String(pm).padStart(2, "0")}`;
}
