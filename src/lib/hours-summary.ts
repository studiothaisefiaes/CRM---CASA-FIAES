import type { BusinessHours } from "./business-hours";

const NAMES = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const ORDER = [1, 2, 3, 4, 5, 6, 0];
const hour = (hhmm: string) => { const [h, m] = hhmm.split(":"); return m === "00" ? `${Number(h)}` : `${Number(h)}h${m}`; };
const range = (w: [string, string]) => (w[0] === "00:00" && w[1] === "24:00" ? "24 horas" : `${hour(w[0])}–${hour(w[1])}`);

/** "seg–sex 8–20, sáb 8–17": junta dias seguidos com o mesmo horário; dias fechados ficam de fora. */
export function summarizeHours(hours: BusinessHours): string {
  const parts: string[] = [];
  let i = 0;
  while (i < ORDER.length) {
    const w = hours[String(ORDER[i]) as keyof BusinessHours];
    if (!w) { i++; continue; }
    let j = i;
    while (j + 1 < ORDER.length) {
      const n = hours[String(ORDER[j + 1]) as keyof BusinessHours];
      if (n && n[0] === w[0] && n[1] === w[1]) j++; else break;
    }
    parts.push(`${j > i ? `${NAMES[ORDER[i]]}–${NAMES[ORDER[j]]}` : NAMES[ORDER[i]]} ${range(w)}`);
    i = j + 1;
  }
  return parts.length ? parts.join(", ") : "sempre fechado";
}
