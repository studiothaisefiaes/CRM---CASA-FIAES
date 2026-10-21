import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, type Tx } from "../../db";
import { auditLog, clientPackages, comandaItems, comandaPayments, professionals } from "../../db/schema";
import { comandaTotals } from "@/lib/comanda-math";
import { shiftDay, todayBahia } from "@/lib/agenda";
import type { Actor } from "../agenda/actor";
import { UserFacingError } from "../errors";
import { lockComandaTx, toMath } from "./comandas";
import { snapshotCommissionsTx } from "./commission-snapshot";
import { getCaixaRecursos } from "./recursos";

/**
 * Regra de comissão que faltava ou mudou (psico r68 #19). A comissão é um retrato gravado no Finalizar: quem criou ou mudou a regra
 * depois via a conta continuar "Sem regra". Aqui a gestão vê o que falta e aplica a regra de HOJE às comandas já fechadas do período,
 * só nos itens ainda não pagos em recibo e não retidos pela dívida; nada além do item é regravado (o rateio da taxa continua o da comanda).
 */
const DEFAULT_DAYS = 120;

export type MissingRule = { professionalId: string; professionalName: string; serviceId: string | null; serviceLabel: string; items: number; baseCents: number; hasRuleNow: boolean };
export type ReapplyPreview = { items: number; comandas: number; byProfessional: { professionalId: string; name: string; items: number; beforeCents: number; afterCents: number }[] };

/** Itens fechados, vivos, não pagos em recibo e não retidos; com `commission_bp` diferente da regra atual da profissional no serviço (null-safe). */
const candidatesSql = (range: { from: string; to: string }, desde: string | null | undefined) => sql`
  c.status = 'fechada' and c.day >= ${desde && desde > range.from ? desde : range.from} and c.day <= ${range.to}
  and ci.cancelled_at is null and ci.kind in ('servico', 'pacote_sessao') and ci.professional_id is not null and ci.payout_id is null and ci.commission_held = false`;

async function defaultRange(): Promise<{ from: string; to: string }> {
  const today = todayBahia(new Date());
  return { from: shiftDay(today, -DEFAULT_DAYS), to: today };
}

/** Quem está "Sem regra": itens fechados do período sem % (por profissional e serviço), com o aviso de que a regra já existe hoje. */
export async function missingRules(range?: { from: string; to: string }): Promise<MissingRule[]> {
  const r = range ?? await defaultRange();
  const desde = (await getCaixaRecursos()).pagarComissaoDesde;
  const rows = (await db.execute(sql`
    select ci.professional_id as pro, p.name as pro_name, ci.service_id as service_id, coalesce(l.label, max(ci.label)) as service_label,
      count(*)::int as items, coalesce(sum(ci.commission_base_cents), 0)::int as base, bool_or(ps.commission_bp is not null) as has_rule
    from comanda_items ci join comandas c on c.id = ci.comanda_id join professionals p on p.id = ci.professional_id
      left join lists l on l.id = ci.service_id
      left join professional_services ps on ps.professional_id = ci.professional_id and ps.service_id = ci.service_id
    where ${candidatesSql(r, desde)} and ci.commission_bp is null and (ci.kind = 'servico' or ci.commission_base_cents is not null)
    group by ci.professional_id, p.name, ci.service_id, l.label
    order by p.name, 4`)).rows as { pro: string; pro_name: string; service_id: string | null; service_label: string; items: number; base: number; has_rule: boolean }[];
  return rows.map((x) => ({ professionalId: x.pro, professionalName: x.pro_name, serviceId: x.service_id, serviceLabel: x.service_label, items: x.items, baseCents: x.base, hasRuleNow: !!x.has_rule }));
}

type Cand = { id: string; comandaId: string; professionalId: string; before: number };

async function candidatesTx(tx: Tx, range: { from: string; to: string }, professionalId?: string | null): Promise<Cand[]> {
  const desde = (await getCaixaRecursos(tx)).pagarComissaoDesde;
  const rows = (await tx.execute(sql`
    select ci.id, ci.comanda_id, ci.professional_id, coalesce(ci.commission_cents, 0)::int as before
    from comanda_items ci join comandas c on c.id = ci.comanda_id
      join professional_services ps on ps.professional_id = ci.professional_id and ps.service_id = ci.service_id
    where ${candidatesSql(range, desde)} and ps.commission_bp is not null and ci.commission_bp is distinct from ps.commission_bp
      ${professionalId ? sql`and ci.professional_id = ${professionalId}` : sql``}
    order by c.day, c.number`)).rows as { id: string; comanda_id: string; professional_id: string; before: number }[];
  return rows.map((r) => ({ id: r.id, comandaId: r.comanda_id, professionalId: r.professional_id, before: r.before }));
}

class Rollback extends Error { constructor(readonly preview: ReapplyPreview) { super("prévia"); } }

/**
 * Aplica (ou só mostra, com `dryRun`) a regra de hoje às comandas já fechadas do período. A prévia roda tudo numa transação e desfaz,
 * então o número mostrado é o mesmo que a confirmação grava.
 */
export async function reapplyRules(range: { from: string; to: string }, o: { dryRun: boolean; professionalId?: string | null }, actor: Actor): Promise<ReapplyPreview> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(range.from) || !/^\d{4}-\d{2}-\d{2}$/.test(range.to) || range.from > range.to) throw new UserFacingError("Confira o período.");
  try {
    return await db.transaction(async (tx) => {
      const cands = await candidatesTx(tx, range, o.professionalId);
      const byComanda = new Map<string, Cand[]>();
      for (const c of cands) byComanda.set(c.comandaId, [...(byComanda.get(c.comandaId) ?? []), c]);
      const names = new Map((await tx.select({ id: professionals.id, name: professionals.name }).from(professionals)).map((p) => [p.id, p.name]));
      const agg = new Map<string, { professionalId: string; name: string; items: number; beforeCents: number; afterCents: number }>();
      for (const [comandaId, mine] of [...byComanda].sort(([a], [b]) => a.localeCompare(b))) {
        const c = await lockComandaTx(tx, comandaId);
        if (c.status !== "fechada") continue;
        const items = await tx.select().from(comandaItems).where(and(eq(comandaItems.comandaId, c.id), isNull(comandaItems.cancelledAt))).orderBy(asc(comandaItems.createdAt));
        const pays = await tx.select().from(comandaPayments).where(and(eq(comandaPayments.comandaId, c.id), isNull(comandaPayments.cancelledAt))).orderBy(asc(comandaPayments.createdAt));
        const totals = comandaTotals(items.map(toMath), c.discountCents);
        const pkgIds = [...new Set(items.map((i) => i.clientPackageId).filter((x): x is string => !!x))];
        const pkgs = new Map((pkgIds.length ? await tx.select().from(clientPackages).where(inArray(clientPackages.id, pkgIds)) : []).map((p) => [p.id, p]));
        const only = new Set(mine.map((m) => m.id));
        await snapshotCommissionsTx(tx, { comanda: c, items, pays, totals, pkgs, held: false, only });
        const after = await tx.select({ id: comandaItems.id, cents: comandaItems.commissionCents }).from(comandaItems).where(inArray(comandaItems.id, [...only]));
        for (const m of mine) {
          const a = agg.get(m.professionalId) ?? { professionalId: m.professionalId, name: names.get(m.professionalId) ?? "Profissional", items: 0, beforeCents: 0, afterCents: 0 };
          a.items++; a.beforeCents += m.before; a.afterCents += after.find((x) => x.id === m.id)?.cents ?? 0;
          agg.set(m.professionalId, a);
        }
      }
      const preview: ReapplyPreview = { items: cands.length, comandas: byComanda.size, byProfessional: [...agg.values()].sort((a, b) => a.name.localeCompare(b.name, "pt-BR")) };
      if (o.dryRun) throw new Rollback(preview);
      if (cands.length) await tx.insert(auditLog).values({ userId: actor.id, action: "comissao_aplicada_fechadas", entity: "comissao", entityId: range.from, data: { de: range.from, ate: range.to, itens: preview.items, comandas: preview.comandas } });
      return preview;
    });
  } catch (e) {
    if (e instanceof Rollback) return e.preview;
    throw e;
  }
}
