import { and, eq, isNotNull, sql } from "drizzle-orm";
import { lists, professionals, salesItems } from "../../db/schema";
import { clean, durationMin, moneyCents, normText } from "./normalize";
import type { ImportCtx } from "./context";

/**
 * Profissionais e serviços. Profissional entra pelo apelido (nome de tela), com nome completo, cargo e ID do Avec; nunca CPF/banco.
 * Quem já existe (pelo ID do Avec, apelido ou nome completo) só tem os vazios completados: o nome de tela nunca é trocado.
 */
export async function importProfessionals(ctx: ImportCtx) {
  const ix = { id: ctx.col("id"), nick: ctx.col("apelido"), name: ctx.col("nome", "profissional"), role: ctx.col("cargo") };
  const pros = await ctx.professionals();
  // Só o cadastro de profissionais (com contratação / grupo de acesso) diz quem é da equipe hoje. Relatórios de comissão e afins listam
  // todo mundo que já trabalhou no salão desde 2020: completam dados, mas quem entra por eles fica inativa.
  const registry = ctx.col("contratacao", "grupo de acesso") >= 0;
  for (const row of ctx.rows) {
    const nick = clean(ctx.cell(row, ix.nick)), full = clean(ctx.cell(row, ix.name));
    const name = nick ?? full;
    if (!name) continue;
    const avecId = clean(ctx.cell(row, ix.id)), role = clean(ctx.cell(row, ix.role));
    const fullName = full && normText(full) !== normText(name) ? full : null;
    const match = (avecId && pros.find((p) => p.avecId === avecId))
      || pros.find((p) => normText(p.name) === normText(name))
      || (fullName && pros.find((p) => normText(p.name) === normText(fullName) || normText(p.fullName) === normText(fullName)));
    if (!match) {
      const [p] = await ctx.tx.insert(professionals).values({ name, fullName, role, avecId, active: registry }).returning();
      pros.push({ id: p.id, name: p.name, fullName: p.fullName, role: p.role, avecId: p.avecId, active: registry });
      ctx.summary.profissionais++;
      continue;
    }
    const patch: Partial<typeof professionals.$inferInsert> = {};
    // Está no cadastro de profissionais do Avec: é da equipe (mesmo que tenha entrado antes, inativa, por um relatório de histórico).
    if (registry && match.active === false) patch.active = true;
    if (!match.fullName && fullName) patch.fullName = fullName;
    if (!match.role && role) patch.role = role;
    if (!match.avecId && avecId) patch.avecId = avecId;
    if (!Object.keys(patch).length) continue;
    await ctx.tx.update(professionals).set(patch).where(eq(professionals.id, match.id));
    Object.assign(match, patch);
    ctx.summary.profissionais++;
  }
}

/**
 * Catálogo de serviços: cria os que faltam e completa categoria, preço (só da coluna "Valor" do cadastro de serviços) e duração
 * ("Tempo"). Faturamento e valor médio NÃO viram preço.
 */
export async function importServices(ctx: ImportCtx) {
  const ix = { label: ctx.col("servico"), category: ctx.col("categoria"), price: ctx.col("valor"), time: ctx.col("tempo") };
  for (const row of ctx.rows) {
    const label = clean(ctx.cell(row, ix.label));
    if (!label) continue;
    const category = clean(ctx.cell(row, ix.category));
    const id = await ctx.serviceId(label, { create: true, category });
    if (!id) continue;
    const s = (await ctx.serviceMap()).get(normText(label))!;
    const patch: Partial<typeof lists.$inferInsert> = {};
    const price = moneyCents(ctx.cell(row, ix.price)), minutes = durationMin(ctx.cell(row, ix.time));
    if (s.priceCents == null && price != null && price > 0) patch.priceCents = price;
    if (s.durationMin == null && minutes != null) patch.durationMin = minutes;
    if (!Object.keys(patch).length) continue;
    await ctx.tx.update(lists).set(patch).where(eq(lists.id, id));
    Object.assign(s, patch);
    ctx.summary.servicos++;
  }
}

/**
 * Preço do serviço sem preço: o valor que mais se repete nas comandas (só quando há um vencedor claro; empate = continua sem preço).
 */
export async function derivePricesFromSales(ctx: ImportCtx) {
  const map = await ctx.serviceMap();
  const missing = [...map.entries()].filter(([, s]) => s.priceCents == null);
  if (!missing.length) return;
  const sold = await ctx.tx.select({ item: salesItems.item, value: salesItems.valueCents, n: sql<number>`count(*)::int` }).from(salesItems)
    .where(and(eq(salesItems.kind, "servico"), isNotNull(salesItems.valueCents), sql`${salesItems.valueCents} > 0`))
    .groupBy(salesItems.item, salesItems.valueCents);
  const counts = new Map<string, Map<number, number>>();
  for (const r of sold) {
    const k = normText(r.item);
    const m = counts.get(k) ?? new Map<number, number>();
    m.set(r.value!, (m.get(r.value!) ?? 0) + r.n);
    counts.set(k, m);
  }
  for (const [k, s] of missing) {
    const m = counts.get(k);
    if (!m) continue;
    const ranked = [...m.entries()].sort((a, b) => b[1] - a[1]);
    if (ranked.length > 1 && ranked[0][1] === ranked[1][1]) continue;
    await ctx.tx.update(lists).set({ priceCents: ranked[0][0] }).where(eq(lists.id, s.id));
    s.priceCents = ranked[0][0];
    ctx.summary.servicos++;
  }
}
