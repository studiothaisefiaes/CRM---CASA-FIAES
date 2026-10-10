/** Próxima ação: atalhos de data e o texto de "quando". Puro (servidor e navegador), sempre no relógio de Salvador. */
const OFFSET_MS = 3 * 3_600_000; // America/Bahia, UTC-3, sem horário de verão
const DAY_MS = 86_400_000;
const pad = (n: number) => String(n).padStart(2, "0");
const WEEKDAY_SHORT = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

/** O instante em que o relógio de Salvador marca `hour`:`minute`, `dayOffset` dias depois do dia de `ms`. */
export function bahiaAt(ms: number, dayOffset: number, hour: number, minute = 0): Date {
  const local = new Date(ms - OFFSET_MS);
  const dayStart = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  return new Date(dayStart + dayOffset * DAY_MS + (hour * 60 + minute) * 60_000 + OFFSET_MS);
}

export type DatePreset = { key: "hoje" | "amanha" | "3dias"; label: string; at: Date };

/** Hoje 18h, Amanhã 10h, Em 3 dias (10h). "Hoje 18h" some depois das 18h: não oferece um horário que já passou. */
export function nextActionPresets(now: number): DatePreset[] {
  const hoje = bahiaAt(now, 0, 18);
  return [
    ...(hoje.getTime() > now ? [{ key: "hoje" as const, label: "Hoje 18h", at: hoje }] : []),
    { key: "amanha", label: "Amanhã 10h", at: bahiaAt(now, 1, 10) },
    { key: "3dias", label: "Em 3 dias", at: bahiaAt(now, 3, 10) },
  ];
}

const wall = (ms: number) => { const d = new Date(ms - OFFSET_MS); return { day: Math.floor((ms - OFFSET_MS) / DAY_MS), wd: d.getUTCDay(), dd: d.getUTCDate(), mm: d.getUTCMonth() + 1, hm: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}` }; };

/** "hoje 18:00", "amanhã 10:00", "ontem 09:00", "ter 14/10 10:00". Passou de hoje: o chamador coloca "atrasada" na frente. */
export function dueLabel(dueMs: number, nowMs: number): string {
  const d = wall(dueMs), n = wall(nowMs);
  const diff = d.day - n.day;
  if (diff === 0) return `hoje ${d.hm}`;
  if (diff === 1) return `amanhã ${d.hm}`;
  if (diff === -1) return `ontem ${d.hm}`;
  return `${WEEKDAY_SHORT[d.wd]} ${pad(d.dd)}/${pad(d.mm)} ${d.hm}`;
}
