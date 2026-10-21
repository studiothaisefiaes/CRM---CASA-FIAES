/**
 * Período do painel Salão (Relatórios): datas locais de Salvador ("AAAA-MM-DD", inclusivas), o período anterior para comparar e o
 * tamanho das barras. Puro: servidor e navegador. Datas tortas na URL (invertidas, inexistentes, ano 4676) são corrigidas, nunca erro.
 */
export const SALON_PRESETS = ["hoje", "7d", "mes", "mes-passado", "ano", "livre"] as const;
export type SalonPreset = (typeof SALON_PRESETS)[number];
export const SALON_PRESET_LABEL: Record<SalonPreset, string> = {
  hoje: "Hoje", "7d": "7 dias", mes: "Este mês", "mes-passado": "Mês passado", ano: "Este ano", livre: "Escolher datas",
};
export type SalonRange = {
  preset: SalonPreset; from: string; to: string; prevFrom: string; prevTo: string; days: number;
  /** Barras por dia (até 62 dias) ou por mês. */ grain: "dia" | "mes";
  label: string; prevLabel: string;
};

/** O Avec da Casa começa em 2020; antes disso a data é engano. Período livre de até 3 anos (1098 dias). */
export const SALON_MIN_DATE = "2015-01-01";
export const SALON_MAX_DAYS = 1098;
const BAHIA_OFFSET_MS = 3 * 3_600_000; // America/Bahia, UTC-3, sem horário de verão
const DAY_MS = 86_400_000;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

const toMs = (d: string) => Date.parse(`${d}T00:00:00Z`);
const toIso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => toIso(toMs(d) + n * DAY_MS);
const daysBetween = (a: string, b: string) => Math.round((toMs(b) - toMs(a)) / DAY_MS) + 1;
const lastDay = (y: number, m0: number) => new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
/** Data real no formato AAAA-MM-DD (2026-02-30 não passa). */
const valid = (d: unknown): d is string => typeof d === "string" && ISO.test(d) && !Number.isNaN(toMs(d)) && toIso(toMs(d)) === d;

export const todayBahia = (now: Date) => toIso(now.getTime() - BAHIA_OFFSET_MS);
export const brDay = (d: string) => { const [y, m, dd] = d.split("-"); return `${dd}/${m}/${y}`; };
export function rangeLabel(from: string, to: string): string {
  if (from === to) return brDay(from);
  return from.slice(0, 4) === to.slice(0, 4) ? `${brDay(from).slice(0, 5)} a ${brDay(to)}` : `${brDay(from)} a ${brDay(to)}`;
}

export function salonRange(p: { periodo?: string | null; de?: string | null; ate?: string | null }, now: Date): SalonRange {
  const today = todayBahia(now);
  const y = Number(today.slice(0, 4)), m0 = Number(today.slice(5, 7)) - 1, d = Number(today.slice(8, 10));
  const prevMonth = (yy: number, mm0: number) => (mm0 === 0 ? { y: yy - 1, m0: 11 } : { y: yy, m0: mm0 - 1 });
  const sameLength = (f: string, t: string): [string, string] => { const n = daysBetween(f, t); return [addDays(f, -n), addDays(f, -1)]; };
  let preset: SalonPreset = (SALON_PRESETS as readonly string[]).includes(p.periodo ?? "") ? (p.periodo as SalonPreset) : "mes";
  if (valid(p.de) || valid(p.ate)) preset = "livre";
  let from: string, to: string, prevFrom: string, prevTo: string;
  switch (preset) {
    case "hoje": from = to = today; [prevFrom, prevTo] = sameLength(from, to); break;
    case "7d": from = addDays(today, -6); to = today; [prevFrom, prevTo] = sameLength(from, to); break;
    case "mes": {
      const pm = prevMonth(y, m0);
      from = toIso(Date.UTC(y, m0, 1)); to = today;
      prevFrom = toIso(Date.UTC(pm.y, pm.m0, 1)); prevTo = toIso(Date.UTC(pm.y, pm.m0, Math.min(d, lastDay(pm.y, pm.m0))));
      break;
    }
    case "mes-passado": {
      const pm = prevMonth(y, m0), qm = prevMonth(pm.y, pm.m0);
      from = toIso(Date.UTC(pm.y, pm.m0, 1)); to = toIso(Date.UTC(pm.y, pm.m0, lastDay(pm.y, pm.m0)));
      prevFrom = toIso(Date.UTC(qm.y, qm.m0, 1)); prevTo = toIso(Date.UTC(qm.y, qm.m0, lastDay(qm.y, qm.m0)));
      break;
    }
    case "ano":
      from = `${y}-01-01`; to = today;
      prevFrom = `${y - 1}-01-01`; prevTo = toIso(Date.UTC(y - 1, m0, Math.min(d, lastDay(y - 1, m0))));
      break;
    default: {
      let f = valid(p.de) ? p.de : valid(p.ate) ? p.ate : toIso(Date.UTC(y, m0, 1));
      let t = valid(p.ate) ? p.ate : today;
      if (f > t) [f, t] = [t, f];
      if (f < SALON_MIN_DATE) f = SALON_MIN_DATE;
      const maxTo = addDays(today, 366);
      if (t > maxTo) t = maxTo;
      if (f > t) f = t;
      if (daysBetween(f, t) > SALON_MAX_DAYS) f = addDays(t, -(SALON_MAX_DAYS - 1));
      from = f; to = t; [prevFrom, prevTo] = sameLength(from, to);
    }
  }
  const days = daysBetween(from, to);
  const span = rangeLabel(from, to);
  return { preset, from, to, prevFrom, prevTo, days, grain: days <= 62 ? "dia" : "mes", label: preset === "livre" ? span : `${SALON_PRESET_LABEL[preset]} (${span})`, prevLabel: rangeLabel(prevFrom, prevTo) };
}

/** As chaves das barras: cada dia ("AAAA-MM-DD") ou cada mês ("AAAA-MM") do período, em ordem e sem buracos. */
export function salonBuckets(r: Pick<SalonRange, "from" | "to" | "grain">): string[] {
  const out: string[] = [];
  if (r.grain === "dia") { for (let k = r.from; k <= r.to; k = addDays(k, 1)) out.push(k); return out; }
  let yy = Number(r.from.slice(0, 4)), mm = Number(r.from.slice(5, 7));
  const end = r.to.slice(0, 7);
  for (;;) {
    const k = `${yy}-${String(mm).padStart(2, "0")}`;
    out.push(k);
    if (k >= end) break;
    mm++; if (mm > 12) { mm = 1; yy++; }
  }
  return out;
}

/** "28/09" para dia; "set. de 26" para mês. */
export const bucketLabel = (k: string) =>
  k.length === 10 ? brDay(k).slice(0, 5) : new Date(`${k}-15T12:00:00Z`).toLocaleDateString("pt-BR", { month: "short", year: "2-digit", timeZone: "UTC" });

/** Query string do período (sem o `?`): atalho em `periodo`, período livre em `de` e `ate`. `aba`: Salão ou Financeiro (mesmo período). */
export function salonQuery(r: Pick<SalonRange, "preset" | "from" | "to">, aba: "salao" | "financeiro" = "salao", vista?: string | null): string {
  const q = new URLSearchParams({ aba });
  if (vista && vista !== "entradas" && vista !== "resumo") q.set("vista", vista);
  if (r.preset === "livre") { q.set("de", r.from); q.set("ate", r.to); } else q.set("periodo", r.preset);
  return q.toString();
}
