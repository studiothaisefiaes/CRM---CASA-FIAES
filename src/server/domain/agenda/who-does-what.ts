import { and, count, eq, gte, isNotNull } from "drizzle-orm";
import { db, type Db, type Tx } from "../../db";
import { auditLog, avecReports, lists, professionals, professionalServices, salesItems } from "../../db/schema";
import { ImportCtx } from "../avec/context";
import { COLS, colOf } from "../avec/formats";
import { clean, dateIso, normText } from "../avec/normalize";
import { todayBahia } from "../../../lib/agenda";

/**
 * Quem faz o quê sugerido pelo histórico do Avec (spec §5.5): o relatório "Serviços por profissional" (6f695f67, guardado em
 * `avec_reports.rows`, já sem CPF) e, como reforço, as vendas de serviço com profissional (`sales_items`). O serviço casa pelo nome
 * normalizado com o cadastro (ativo); a profissional, pelo apelido ou nome completo, como a importação. Vira sugestão quem fez o
 * serviço 2 vezes ou mais nos últimos 12 meses. Só profissionais ativas e pares ainda não ligados. Nada é gravado sem um toque.
 */
export const SERVICES_BY_PRO_SIGNATURE = "6f695f67";

export type WhoSuggestion = { professionalId: string; professionalName: string; serviceId: string; serviceLabel: string; count: number };
export type WhoUnmatched = { kind: "servico" | "profissional"; name: string; count: number };

const oneYearBefore = (day: string) => `${Number(day.slice(0, 4)) - 1}${day.slice(4)}`;

type Occurrence = { pro: string; proRaw: string; svc: string; svcRaw: string; count: number };

/** Atendimentos do relatório, sem repetir o mesmo (profissional, dia, comanda, serviço) que aparece em mais de um arquivo. */
async function reportOccurrences(tx: Tx | Db, since: string): Promise<Occurrence[]> {
  const reports = await tx.select({ columns: avecReports.columns, rows: avecReports.rows }).from(avecReports).where(eq(avecReports.signature, SERVICES_BY_PRO_SIGNATURE));
  const best = new Map<string, Occurrence>();
  for (const rep of reports) {
    const ix = { pro: colOf(rep.columns, "profissional"), day: colOf(rep.columns, "data comanda", "data"), svc: colOf(rep.columns, "servico"), comanda: colOf(rep.columns, ...COLS.comanda) };
    if (ix.pro < 0 || ix.day < 0 || ix.svc < 0) continue;
    const local = new Map<string, Occurrence>();
    for (const row of rep.rows) {
      const day = dateIso(row[ix.day]);
      const proRaw = clean(row[ix.pro]), svcRaw = clean(row[ix.svc]);
      if (!day || day < since || !proRaw || !svcRaw) continue;
      const pro = normText(proRaw), svc = normText(svcRaw);
      const key = JSON.stringify([pro, day, ix.comanda >= 0 ? normText(row[ix.comanda]) : "", svc]);
      const o = local.get(key) ?? { pro, proRaw, svc, svcRaw, count: 0 };
      o.count++;
      local.set(key, o);
    }
    for (const [key, o] of local) if (o.count > (best.get(key)?.count ?? 0)) best.set(key, o);
  }
  return [...best.values()];
}

export async function suggestProfessionalServices(o: { since?: string; minCount?: number; now?: Date } = {}, tx: Tx | Db = db): Promise<{ suggestions: WhoSuggestion[]; unmatched: WhoUnmatched[] }> {
  const since = o.since ?? oneYearBefore(todayBahia(o.now ?? new Date()));
  const minCount = o.minCount ?? 2;
  // Uma consulta de cada vez: dentro de uma transação (acceptSuggestions) a conexão é uma só.
  const pros = await tx.select({ id: professionals.id, name: professionals.name, active: professionals.active, position: professionals.agendaPosition }).from(professionals);
  const services = await tx.select({ id: lists.id, label: lists.label }).from(lists).where(and(eq(lists.kind, "service"), eq(lists.active, true)));
  const links = await tx.select({ professionalId: professionalServices.professionalId, serviceId: professionalServices.serviceId }).from(professionalServices);
  const occurrences = await reportOccurrences(tx, since);
  const sales = await tx.select({ professionalId: salesItems.professionalId, item: salesItems.item, n: count() }).from(salesItems)
    .where(and(eq(salesItems.kind, "servico"), isNotNull(salesItems.professionalId), gte(salesItems.soldOn, since)))
    .groupBy(salesItems.professionalId, salesItems.item);
  const proById = new Map(pros.map((p) => [p.id, p]));
  const serviceByName = new Map(services.map((s) => [normText(s.label), s]));
  const linked = new Set(links.map((l) => `${l.professionalId}|${l.serviceId}`));
  const ctx = new ImportCtx(tx as Tx, [], [], []); // mesmo casamento de profissional da importação (apelido ou nome completo), sem cadastrar

  const fromReport = new Map<string, number>(), fromSales = new Map<string, number>();
  const unmatched = new Map<string, WhoUnmatched>();
  const miss = (kind: WhoUnmatched["kind"], key: string, name: string, n: number) => {
    const u = unmatched.get(`${kind}|${key}`) ?? { kind, name, count: 0 };
    u.count += n;
    unmatched.set(`${kind}|${key}`, u);
  };
  for (const oc of occurrences) {
    const service = serviceByName.get(oc.svc);
    if (!service) { miss("servico", oc.svc, oc.svcRaw, oc.count); continue; }
    const proId = await ctx.professionalId(oc.proRaw);
    if (!proId) { miss("profissional", oc.pro, oc.proRaw, oc.count); continue; }
    const pair = `${proId}|${service.id}`;
    fromReport.set(pair, (fromReport.get(pair) ?? 0) + oc.count);
  }
  for (const s of sales) {
    const service = serviceByName.get(normText(s.item));
    if (!service || !s.professionalId) continue;
    const pair = `${s.professionalId}|${service.id}`;
    fromSales.set(pair, (fromSales.get(pair) ?? 0) + Number(s.n));
  }

  const suggestions: WhoSuggestion[] = [];
  for (const pair of new Set([...fromReport.keys(), ...fromSales.keys()])) {
    // O relatório e as vendas contam os MESMOS atendimentos: vale a maior contagem, nunca a soma.
    const n = Math.max(fromReport.get(pair) ?? 0, fromSales.get(pair) ?? 0);
    const [professionalId, serviceId] = pair.split("|");
    const pro = proById.get(professionalId);
    if (n < minCount || linked.has(pair) || !pro?.active) continue;
    suggestions.push({ professionalId, professionalName: pro.name, serviceId, serviceLabel: services.find((s) => s.id === serviceId)!.label, count: n });
  }
  const pos = (id: string) => proById.get(id)?.position ?? Number.MAX_SAFE_INTEGER;
  suggestions.sort((a, b) => pos(a.professionalId) - pos(b.professionalId) || a.professionalName.localeCompare(b.professionalName, "pt-BR")
    || b.count - a.count || a.serviceLabel.localeCompare(b.serviceLabel, "pt-BR"));
  return { suggestions, unmatched: [...unmatched.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "pt-BR")) };
}

/**
 * Grava as sugestões (todas, as de uma profissional ou só os pares escolhidos que ainda são sugestão) como `avec_historico`.
 * Rodar duas vezes não duplica (chave primária) e nunca tira nem troca um vínculo feito à mão.
 */
export async function acceptSuggestions(o: { professionalId?: string | null; pairs?: { professionalId: string; serviceId: string }[]; now?: Date }, userId: string | null): Promise<{ added: number }> {
  return db.transaction(async (tx) => {
    const { suggestions } = await suggestProfessionalServices({ now: o.now }, tx);
    const wanted = o.pairs ? new Set(o.pairs.map((p) => `${p.professionalId}|${p.serviceId}`)) : null;
    const chosen = suggestions.filter((s) => (!o.professionalId || s.professionalId === o.professionalId) && (!wanted || wanted.has(`${s.professionalId}|${s.serviceId}`)));
    if (!chosen.length) return { added: 0 };
    const added = await tx.insert(professionalServices)
      .values(chosen.map((s) => ({ professionalId: s.professionalId, serviceId: s.serviceId, source: "avec_historico", createdBy: userId })))
      .onConflictDoNothing().returning({ professionalId: professionalServices.professionalId });
    if (added.length) {
      await tx.insert(auditLog).values({ userId, action: "aceitou_sugestoes", entity: "professional_services", entityId: o.professionalId ?? null,
        data: { pares: chosen.map((s) => ({ profissional: s.professionalName, servico: s.serviceLabel, vezes: s.count })) } });
    }
    return { added: added.length };
  });
}
