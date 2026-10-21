import { z } from "zod";
import { windowOf, type BusinessHours } from "./business-hours";

/**
 * Horário de trabalho de cada profissional (`professionals.work_hours`). Função pura: serve ao servidor (motor de horários livres)
 * e à tela (Configurações › Profissionais). Dias "0" (domingo) a "6" (sábado); cada dia é null (não trabalha) ou 1 a 2 faixas
 * ["HH:MM", "HH:MM"] de Salvador — o "intervalo" é o buraco entre as duas. Sem horário próprio, vale o da Casa.
 */
export type DayKey = "0" | "1" | "2" | "3" | "4" | "5" | "6";
export type WorkRange = [string, string];
export type WorkHours = Record<DayKey, WorkRange[] | null>;

export const DAY_KEYS: DayKey[] = ["0", "1", "2", "3", "4", "5", "6"];
export const WEEKDAY_LONG = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const SHORT = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
/** A semana da Casa começa na segunda. */
export const WEEK_ORDER: DayKey[] = ["1", "2", "3", "4", "5", "6", "0"];

const MIN_START = 6 * 60, MAX_END = 24 * 60;

/** "HH:MM" → minuto do dia (0 a 1440); null se não for hora. */
export function hmMin(v: unknown): number | null {
  const m = typeof v === "string" ? /^(\d{2}):(\d{2})$/.exec(v) : null;
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  if (mi > 59 || h > 24 || (h === 24 && mi > 0)) return null;
  return h * 60 + mi;
}

const fillDays = (v: unknown) =>
  v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(DAY_KEYS.map((k) => [k, (v as Record<string, unknown>)[k] ?? null])) : v;

/** Valida o horário próprio. Os erros dizem o dia e a faixa ("Terça, 2ª faixa: o fim precisa ser depois do início."). */
export const workHoursSchema = z.preprocess(fillDays, z.record(z.enum(["0", "1", "2", "3", "4", "5", "6"]), z.array(z.tuple([z.string(), z.string()])).nullable()))
  .superRefine((h, ctx) => {
    for (const k of DAY_KEYS) {
      const list = h[k];
      if (!list?.length) continue;
      const day = WEEKDAY_LONG[Number(k)];
      const issue = (message: string) => ctx.addIssue({ code: "custom", message, path: [k] });
      if (list.length > 2) { issue(`${day}: no máximo 2 faixas (use o intervalo para o almoço).`); continue; }
      const mins: [number, number][] = [];
      list.forEach(([a, b], i) => {
        const s = hmMin(a), e = hmMin(b);
        if (s == null || e == null || s < MIN_START || e > MAX_END) issue(`${day}, ${i + 1}ª faixa: use horários entre 06:00 e 24:00.`);
        else if (e <= s) issue(`${day}, ${i + 1}ª faixa: o fim precisa ser depois do início.`);
        else mins.push([s, e]);
      });
      if (mins.length === 2) {
        const [x, y] = mins.sort((p, q) => p[0] - q[0]);
        if (y[0] < x[1]) issue(`${day}: as faixas se sobrepõem.`);
      }
    }
  })
  .transform((h) => Object.fromEntries(DAY_KEYS.map((k) => {
    const list = h[k];
    return [k, list?.length ? [...list].sort((a, b) => (hmMin(a[0]) ?? 0) - (hmMin(b[0]) ?? 0)) : null];
  })) as WorkHours);

/** As faixas do dia ("AAAA-MM-DD"), em minutos: o horário próprio vence o da Casa (mesmo num dia em que a Casa fecha). */
export function effectiveRanges(day: string, pro: WorkHours | null | undefined, casa: BusinessHours): [number, number][] {
  const k = String(new Date(`${day}T00:00:00Z`).getUTCDay()) as DayKey;
  const dayMs = Date.parse(`${day}T00:00:00Z`);
  const win = windowOf(dayMs, casa);
  const list: WorkRange[] = pro ? (pro[k] ?? []) : win ? [win] : [];
  const ranges = list.flatMap(([a, b]) => {
    const s = hmMin(a), e = hmMin(b);
    return s != null && e != null && e > s ? [[s, e] as [number, number]] : [];
  });
  // Dia especial (feriado, horário reduzido) vale também para quem tem horário próprio: fechado = nada; reduzido = só dentro da janela.
  if (pro && casa.especiais && Object.hasOwn(casa.especiais, day)) {
    if (!win) return [];
    const ws = hmMin(win[0]) ?? 0, we = hmMin(win[1]) ?? 0;
    return ranges.flatMap(([s, e]) => (Math.min(e, we) > Math.max(s, ws) ? [[Math.max(s, ws), Math.min(e, we)] as [number, number]] : []));
  }
  return ranges;
}

/** O horário da Casa no formato do horário de trabalho (para descrever e para começar um horário próprio a partir dele). */
export const casaAsWorkHours = (casa: BusinessHours): WorkHours =>
  Object.fromEntries(DAY_KEYS.map((k) => [k, casa[k] ? [[casa[k]![0], casa[k]![1]]] : null])) as WorkHours;

/** "09:00" → "9h", "09:30" → "9h30". */
const hourText = (hhmm: string) => { const [h, m] = hhmm.split(":"); return `${Number(h)}h${m === "00" ? "" : m}`; };
const sameRanges = (a: WorkRange[] | null, b: WorkRange[] | null) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** "ter–sáb, 9h–18h"; com intervalo e dias diferentes: "ter–qua, 9h–12h e 13h–18h; sáb, 9h30–14h". Nenhum dia: "não trabalha". */
export function summarizeWorkHours(h: WorkHours): string {
  const parts: string[] = [];
  for (let i = 0; i < WEEK_ORDER.length;) {
    const r = h[WEEK_ORDER[i]];
    if (!r?.length) { i++; continue; }
    let j = i;
    while (j + 1 < WEEK_ORDER.length && h[WEEK_ORDER[j + 1]]?.length && sameRanges(h[WEEK_ORDER[j + 1]], r)) j++;
    const days = j > i ? `${SHORT[Number(WEEK_ORDER[i])]}–${SHORT[Number(WEEK_ORDER[j])]}` : SHORT[Number(WEEK_ORDER[i])];
    parts.push(`${days}, ${r.map(([a, b]) => `${hourText(a)}–${hourText(b)}`).join(" e ")}`);
    i = j + 1;
  }
  return parts.length ? parts.join("; ") : "não trabalha";
}

/** O horário dela: o próprio, ou o da Casa com "· igual ao da Casa". */
export const describeWorkHours = (pro: WorkHours | null | undefined, casa: BusinessHours): string =>
  pro ? summarizeWorkHours(pro) : `${summarizeWorkHours(casaAsWorkHours(casa))} · igual ao da Casa`;

/** Dias em que ela trabalha e a Casa não abre ("segunda"): a tela pergunta antes de salvar. */
export const daysOutsideCasa = (pro: WorkHours, casa: BusinessHours): string[] =>
  WEEK_ORDER.filter((k) => pro[k]?.length && !casa[k]).map((k) => WEEKDAY_LONG[Number(k)].toLowerCase());

/** Folga do dia inteiro: nenhuma faixa de trabalho, ou todas cobertas por bloqueios (a coluna da agenda mostra "Folga"). */
export function dayOff(ranges: [number, number][], blocks: [number, number][]): boolean {
  const sorted = [...blocks].sort((a, b) => a[0] - b[0]);
  return ranges.every(([a, b]) => {
    let reach = a;
    for (const [s, e] of sorted) { if (s > reach) break; reach = Math.max(reach, e); }
    return reach >= b;
  });
}
