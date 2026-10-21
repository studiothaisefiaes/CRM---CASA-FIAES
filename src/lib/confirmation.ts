/**
 * A confirmação padrão que a Casa manda depois de marcar ("Confirmado agendamento, aqui na Casa Fiaes, … para dia 17/10 (SÁBADO) às 9h").
 * Puro: o servidor lê nas mensagens ENVIADAS para marcar Agendado com o dia e a hora sozinho. Horário de Salvador (UTC-3, sem horário de verão).
 */
const OFFSET_MS = 3 * 3_600_000;
const TRIGGER = /confirmad[oa]\s+(?:o\s+)?agendamento/i;
// "dia 17/10" ou, no desenho de WhatsApp (21/10), "quinta-feira, 22/10" / "*sábado, 24/10*"; "às 9h", "às *14h*", "*às 14h*".
const DAY = /(?:\bdia\s+|(?:feira|s[áa]bado|domingo)\*?,?\s+)(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?/i;
const HOUR = /(?:^|[\s*_])[àa]s\s+\*?(\d{1,2})(?:\s*[:h]\s*(\d{2}))?\s*h?(?![\d])/i;

export function parseConfirmation(body: string | null | undefined, sentAtMs: number): Date | null {
  if (!body) return null;
  const t = TRIGGER.exec(body);
  if (!t) return null;
  const rest = body.slice(t.index + t[0].length);
  const d = DAY.exec(rest);
  if (!d) return null;
  const h = HOUR.exec(rest.slice(d.index + d[0].length));
  if (!h) return null;
  const day = Number(d[1]), month = Number(d[2]), hour = Number(h[1]), minute = Number(h[2] ?? 0);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  const sentYear = new Date(sentAtMs - OFFSET_MS).getUTCFullYear();
  const build = (y: number) => {
    const ms = Date.UTC(y, month - 1, day, hour, minute) + OFFSET_MS;
    const check = new Date(ms - OFFSET_MS);
    return check.getUTCDate() === day && check.getUTCMonth() === month - 1 ? ms : null; // 31/02 não existe
  };
  let year = d[3] ? (d[3].length === 2 ? 2000 + Number(d[3]) : Number(d[3])) : sentYear;
  let ms = build(year);
  if (ms == null) return null;
  // Sem ano e já passou (mais de 1 dia antes da mensagem): é do ano que vem ("dia 05/01" mandado em outubro).
  if (!d[3] && ms < sentAtMs - 86_400_000) { year += 1; ms = build(year); if (ms == null) return null; }
  return new Date(ms);
}
