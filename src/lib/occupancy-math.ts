/** Contas de ocupação em minutos do dia (0 a 1440). Funções puras: servem ao relatório de Ocupação. */
export type MinRange = [number, number];

/** Une faixas que se tocam ou se sobrepõem; descarta as vazias. */
export function mergeRanges(list: MinRange[]): MinRange[] {
  const sorted = list.filter(([a, b]) => b > a).map(([a, b]) => [a, b] as MinRange).sort((x, y) => x[0] - y[0]);
  const out: MinRange[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]); else out.push(r);
  }
  return out;
}

/** As faixas sem os trechos dos bloqueios. */
export function subtractRanges(ranges: MinRange[], blocks: MinRange[]): MinRange[] {
  const bs = mergeRanges(blocks);
  const out: MinRange[] = [];
  for (const [s, e] of mergeRanges(ranges)) {
    let cur = s;
    for (const [bs0, be] of bs) {
      if (be <= cur || bs0 >= e) continue;
      if (bs0 > cur) out.push([cur, bs0]);
      cur = Math.max(cur, be);
    }
    if (cur < e) out.push([cur, e]);
  }
  return out;
}

const total = (list: MinRange[]) => list.reduce((t, [a, b]) => t + (b - a), 0);

/** Minutos disponíveis: faixas de trabalho menos a união dos bloqueios. */
export const availableMinutes = (ranges: MinRange[], blocks: MinRange[]): number => total(subtractRanges(ranges, blocks));

/** Minutos agendados dentro das faixas; horários sobrepostos contam uma vez só. */
export function clippedMinutes(busy: MinRange[], ranges: MinRange[]): number {
  const a = mergeRanges(busy), b = mergeRanges(ranges);
  let t = 0;
  for (const [s1, e1] of a) for (const [s2, e2] of b) t += Math.max(0, Math.min(e1, e2) - Math.max(s1, s2));
  return t;
}
