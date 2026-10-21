import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "../../db";
import { avecReports, salesItems } from "../../db/schema";
import { todayBahia } from "../../../lib/salon-period";
import { COLS, colOf } from "./formats";
import { comandaOf, dateIso, moneyCents, normText, pctOrNull } from "./normalize";

/**
 * Comissão histórica dos itens de comanda (Lote 3), lida dos relatórios do Avec JÁ GUARDADOS (`avec_reports`, saneados): "Itens de comanda"
 * (Comissão (%) e Comissão) e "Comissão por item" (Comissão (%) e Total). Só preenche item sem comissão; nunca troca valor que já existe;
 * item que não dá para saber com certeza qual é (mesmo item duas vezes na comanda, comissões diferentes) fica de fora.
 */

type Ix = { day: number; comanda: number; item: number; value: number; pct: number; cents: number; total: number; pro: number };
const indexes = (c: string[]): Ix => ({
  day: colOf(c, ...COLS.itemDate), comanda: colOf(c, ...COLS.comanda), item: colOf(c, ...COLS.item), value: colOf(c, "valor", "valor cobrado", "valor r$"),
  pct: colOf(c, "comissao (%)"), cents: colOf(c, "comissao"), total: colOf(c, "total"), pro: colOf(c, ...COLS.professional),
});
const cellOf = (row: string[], i: number) => (i >= 0 ? (row[i] ?? "").trim() : "");
const keyOf = (day: string, comanda: string | null, item: string, value: number | null) => `${day}|${comanda ?? ""}|${normText(item)}|${value ?? ""}`;

/** Relatório com comissão por item: data, comanda, item, valor e a % ou o valor da comissão. */
export const hasItemCommission = (c: string[]) => { const ix = indexes(c); return ix.day >= 0 && ix.comanda >= 0 && ix.item >= 0 && ix.value >= 0 && (ix.pct >= 0 || ix.cents >= 0); };

/** A comissão da linha: a coluna "Comissão"; sem ela ("Comissão por item"), o "Total" só quando bate com valor × % (até 1 centavo). */
export function rowCommission(columns: string[], row: string[]): { pct: number | null; cents: number | null } {
  const ix = indexes(columns);
  const pct = pctOrNull(cellOf(row, ix.pct));
  if (ix.cents >= 0) return { pct, cents: moneyCents(cellOf(row, ix.cents)) };
  const total = moneyCents(cellOf(row, ix.total)), value = moneyCents(cellOf(row, ix.value));
  const fits = total != null && value != null && pct != null && Math.abs(total - Math.round((value * pct) / 100)) <= 1;
  return { pct, cents: fits ? total : null };
}

export type CommissionUpdate = {
  id: string; professional: string; soldOn: string; commissionPct: number | null; commissionCents: number | null;
  before: { commissionPct: number | null; commissionCents: number | null };
};
export type CommissionPlan = {
  relatorios: { id: string; title: string; linhas: number }[];
  updates: CommissionUpdate[];
  /** Linhas com comissão que não acharam o item (item escrito de outro jeito, ou não importado). */ semPar: number;
  /** Linhas iguais com comissões diferentes e nada para separar: ficam de fora. */ ambiguas: number;
  /** Itens que já tinham comissão: não mudam. */ jaTinham: number;
  /** Para conferir 2 profissionais à mão com o Avec: o que entra no último mês fechado, por profissional. */
  conferencia: { mes: string; linhas: { profissional: string; itens: number; comissaoCents: number }[] };
};
export type CommissionBackup = { criadoEm: string; itens: { id: string; commissionPct: number | null; commissionCents: number | null }[] };

const lastMonth = (now: Date) => {
  const t = todayBahia(now), y = Number(t.slice(0, 4)), m = Number(t.slice(5, 7));
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
};

export async function planCommissionBackfill(now = new Date()): Promise<CommissionPlan> {
  // Primeiro só os cabeçalhos (são 200+ relatórios guardados); as linhas, só dos que trazem comissão por item.
  const heads = (await db.select({ id: avecReports.id, title: avecReports.title, columns: avecReports.columns, importedAt: avecReports.importedAt }).from(avecReports))
    .filter((r) => hasItemCommission(r.columns))
    // Quem traz o valor da comissão ("Itens de comanda") decide primeiro; no mesmo tipo, o envio mais novo.
    .sort((a, b) => Number(indexes(b.columns).cents >= 0) - Number(indexes(a.columns).cents >= 0) || b.importedAt.getTime() - a.importedAt.getTime());
  const reports: (typeof heads[number] & { rows: string[][] })[] = [];
  for (const h of heads) reports.push({ ...h, rows: (await db.select({ rows: avecReports.rows }).from(avecReports).where(eq(avecReports.id, h.id)))[0]?.rows ?? [] });
  const mes = lastMonth(now);
  const relatorios = reports.map((r) => ({ id: r.id, title: r.title, linhas: r.rows.length }));
  const empty: CommissionPlan = { relatorios, updates: [], semPar: 0, ambiguas: 0, jaTinham: 0, conferencia: { mes, linhas: [] } };
  const days = reports.flatMap((r) => r.rows.map((row) => dateIso(cellOf(row, indexes(r.columns).day)))).filter((d): d is string => !!d).sort();
  if (!days.length) return empty;

  const items = await db.select({
    id: salesItems.id, soldOn: salesItems.soldOn, comanda: salesItems.comanda, item: salesItems.item, valueCents: salesItems.valueCents, totalCents: salesItems.totalCents,
    professionalName: salesItems.professionalName, commissionPct: salesItems.commissionPct, commissionCents: salesItems.commissionCents,
  }).from(salesItems).where(and(gte(salesItems.soldOn, days[0]), lte(salesItems.soldOn, days[days.length - 1]))).orderBy(asc(salesItems.id));
  const byKey = new Map<string, typeof items>();
  for (const it of items) { const k = keyOf(it.soldOn, it.comanda, it.item, it.valueCents ?? it.totalCents); byKey.set(k, [...(byKey.get(k) ?? []), it]); }

  type Line = { pro: string; pct: number | null; cents: number | null };
  const decided = new Map<string, Line>();
  let semPar = 0, ambiguas = 0;
  for (const r of reports) {
    const ix = indexes(r.columns);
    const groups = new Map<string, Line[]>();
    for (const row of r.rows) {
      const day = dateIso(cellOf(row, ix.day)), item = cellOf(row, ix.item);
      if (!day || !item) continue;
      const c = rowCommission(r.columns, row);
      if (c.pct == null && c.cents == null) continue;
      const k = keyOf(day, comandaOf(cellOf(row, ix.comanda)), item, moneyCents(cellOf(row, ix.value)));
      groups.set(k, [...(groups.get(k) ?? []), { pro: normText(cellOf(row, ix.pro)), ...c }]);
    }
    for (const [k, lines] of groups) {
      const all = byKey.get(k) ?? [];
      if (!all.length) { semPar += lines.length; continue; }
      const left = all.filter((it) => !decided.has(it.id));
      if (!left.length) continue; // outro relatório já decidiu estes itens
      const rest: Line[] = [];
      for (const l of lines) {
        const i = l.pro ? left.findIndex((it) => normText(it.professionalName) === l.pro) : -1;
        if (i >= 0) decided.set(left.splice(i, 1)[0].id, l); else rest.push(l);
      }
      if (!rest.length || !left.length) continue;
      const same = rest.every((l) => l.pct === rest[0].pct && l.cents === rest[0].cents);
      if (same && left.length === rest.length) for (const it of left) decided.set(it.id, rest[0]);
      else ambiguas += rest.length;
    }
  }

  const byId = new Map(items.map((i) => [i.id, i]));
  const updates: CommissionUpdate[] = [];
  let jaTinham = 0;
  for (const [id, l] of decided) {
    const it = byId.get(id)!;
    if (it.commissionPct != null || it.commissionCents != null) { jaTinham++; continue; }
    updates.push({ id, professional: it.professionalName ?? "Sem profissional", soldOn: it.soldOn, commissionPct: l.pct, commissionCents: l.cents, before: { commissionPct: null, commissionCents: null } });
  }
  const byPro = new Map<string, { itens: number; comissaoCents: number }>();
  for (const u of updates.filter((x) => x.soldOn.startsWith(mes) && x.commissionCents != null)) {
    const cur = byPro.get(u.professional) ?? { itens: 0, comissaoCents: 0 };
    byPro.set(u.professional, { itens: cur.itens + 1, comissaoCents: cur.comissaoCents + u.commissionCents! });
  }
  return {
    relatorios, updates, semPar, ambiguas, jaTinham,
    conferencia: { mes, linhas: [...byPro].map(([profissional, v]) => ({ profissional, ...v })).sort((a, b) => b.comissaoCents - a.comissaoCents) },
  };
}

/** Grava (backup antes, numa transação). Só preenche o que ainda está vazio: se alguém importou de novo no meio, o que chegou fica. */
export async function applyCommissionBackfill(plan: CommissionPlan, writeBackup: (b: CommissionBackup) => Promise<void>): Promise<{ updated: number }> {
  if (!plan.updates.length) return { updated: 0 };
  await writeBackup({ criadoEm: new Date().toISOString(), itens: plan.updates.map((u) => ({ id: u.id, ...u.before })) });
  return db.transaction(async (tx) => {
    let updated = 0;
    for (let i = 0; i < plan.updates.length; i += 500) {
      const values = sql.join(plan.updates.slice(i, i + 500).map((u) => sql`(${u.id}::uuid, ${u.commissionPct}::numeric, ${u.commissionCents}::int)`), sql`, `);
      const r = await tx.execute(sql`update sales_items si set commission_pct = v.pct, commission_cents = v.cents
        from (values ${values}) as v(id, pct, cents) where si.id = v.id and si.commission_pct is null and si.commission_cents is null`);
      updated += r.rowCount ?? 0;
    }
    return { updated };
  });
}

/** Volta os itens ao que estava no backup. */
export async function restoreCommissionBackfill(b: CommissionBackup): Promise<number> {
  return db.transaction(async (tx) => {
    let n = 0;
    for (let i = 0; i < b.itens.length; i += 500) {
      const values = sql.join(b.itens.slice(i, i + 500).map((x) => sql`(${x.id}::uuid, ${x.commissionPct}::numeric, ${x.commissionCents}::int)`), sql`, `);
      const r = await tx.execute(sql`update sales_items si set commission_pct = v.pct, commission_cents = v.cents from (values ${values}) as v(id, pct, cents) where si.id = v.id`);
      n += r.rowCount ?? 0;
    }
    return n;
  });
}

/** Conferência depois de aplicar: comissão por profissional no mês (para bater 2 profissionais com o relatório do Avec). */
export async function commissionByProfessional(month: string): Promise<{ profissional: string; itens: number; comissaoCents: number }[]> {
  const r = await db.execute(sql`
    select coalesce(p.name, nullif(trim(si.professional_name), ''), 'Sem profissional') as profissional, count(*)::int as itens,
      coalesce(sum(si.commission_cents), 0)::float8 as "comissaoCents"
    from sales_items si left join professionals p on p.id = si.professional_id
    where to_char(si.sold_on, 'YYYY-MM') = ${month} and si.commission_cents is not null group by 1 order by 3 desc`);
  return (r.rows as { profissional: string; itens: number; comissaoCents: number }[]).map((x) => ({ ...x, comissaoCents: Number(x.comissaoCents) }));
}
