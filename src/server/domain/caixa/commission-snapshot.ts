import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { Tx } from "../../db";
import { clientPackages, comandaItemAssistants, comandaItems, lists, professionals, professionalServices, type Comanda, type ComandaItem, type ComandaPayment } from "../../db/schema";
import { courtesyShares, feeCents, itemTotal, type ComandaTotals } from "@/lib/comanda-math";
import { allocateByNet, itemCommission } from "@/lib/commission-math";
import { effectiveRules, readProCommissionRules, type CommissionRules } from "@/lib/commission-rules";
import { getCommissionRules } from "./commission-rules";
import { getCaixaRecursos } from "./recursos";

/**
 * O retrato da comissão no Finalizar (Fase A, itens 1 e 3): para cada serviço e sessão de pacote grava a base, o %, a comissão sem
 * descontos, cada desconto (taxa do cartão, antecipação, custo, assistentes) e o que fica para a principal; para cada assistente, a base,
 * o % e a comissão dela. Mudar regra, taxa ou % depois não mexe no que fechou; reabrir apaga e o próximo Finalizar refaz.
 *
 * - Base (a de sempre): total do item − a parte dele no desconto da comanda − a parte dele na cortesia; sessão de pacote = valor da sessão × qtd.
 * - Taxa do cartão = Σ `fee_cents` gravados nos pagamentos (o retrato de cada pagamento, nunca a taxa de hoje); antecipação = % × Σ crédito.
 *   As duas são rateadas pelos itens pelo líquido de cada um (sessão de pacote vale 0), decisão 5.
 * - Custo = custo do serviço × quantidade. Regra = a da Casa com a própria da profissional por cima.
 * - Liga/desliga lido aqui, dentro da transação: "Assistente na comanda" desligado ignora as assistentes; "Comissão com taxa, antecipação e
 *   custo" desligado trata os três como "não descontar" (as assistentes seguem a própria chave).
 */
const COMMISSIONED = ["servico", "pacote_sessao"];
const NO_DEDUCTIONS = { cartao: "nao", antecipacao: "nao", custo: "nao" } as const;

export async function snapshotCommissionsTx(tx: Tx, o: {
  comanda: Comanda; items: ComandaItem[]; pays: ComandaPayment[]; totals: ComandaTotals; pkgs: Map<string, typeof clientPackages.$inferSelect>; held: boolean;
  /** Só estes itens são regravados (aplicar a regra nova às fechadas, psico r68 #19); o rateio ainda conta a comanda toda. */
  only?: ReadonlySet<string>;
}): Promise<void> {
  const { items, pays, totals, pkgs } = o;
  const rec = await getCaixaRecursos(tx);
  const casa = await getCommissionRules(tx);
  const ruleOf = new Map<string, CommissionRules>();
  const proIds = [...new Set(items.map((i) => i.professionalId).filter((x): x is string => !!x))];
  for (const p of proIds.length ? await tx.select({ id: professionals.id, rules: professionals.commissionRules }).from(professionals).where(inArray(professionals.id, proIds)) : []) {
    const r = effectiveRules(casa, readProCommissionRules(p.rules));
    ruleOf.set(p.id, rec.comissaoComDescontos ? r : { ...r, ...NO_DEDUCTIONS });
  }
  const serviceIds = [...new Set(items.map((i) => i.serviceId).filter((x): x is string => !!x))];
  const rates = new Map<string, { bp: number | null; assistantBp: number | null }>();
  if (proIds.length && serviceIds.length) {
    for (const r of await tx.select().from(professionalServices).where(and(inArray(professionalServices.professionalId, proIds), inArray(professionalServices.serviceId, serviceIds)))) {
      rates.set(`${r.professionalId}:${r.serviceId}`, { bp: r.commissionBp, assistantBp: r.assistantBp });
    }
  }
  const costs = new Map(serviceIds.length ? (await tx.select({ id: lists.id, cost: lists.costCents }).from(lists).where(inArray(lists.id, serviceIds))).map((l) => [l.id, l.cost]) : []);
  const itemIds = items.map((i) => i.id);
  const assistantRows = rec.assistentes && itemIds.length
    ? await tx.select().from(comandaItemAssistants).where(inArray(comandaItemAssistants.comandaItemId, itemIds)).orderBy(asc(comandaItemAssistants.position)) : [];

  // Líquido de cada item (a base da comissão) e o rateio da taxa e da antecipação da comanda por ele.
  const totalOf = (i: ComandaItem) => itemTotal({ qty: Number(i.qty), unitCents: i.unitCents, discountCents: i.discountCents }) ?? 0;
  // O item de dívida (quitação) fica fora do rateio da cortesia, da taxa e da antecipação: não é venda.
  const courtesy = courtesyShares(items.map((i) => ({ id: i.id, total: i.kind === "divida" ? 0 : totalOf(i) - (totals.shares.get(i.id) ?? 0) })),
    pays.filter((p) => p.method === "cortesia").reduce((a, p) => a + p.valueCents, 0));
  const netOf = (i: ComandaItem) => Math.max(0, totalOf(i) - (totals.shares.get(i.id) ?? 0) - (courtesy.get(i.id) ?? 0));
  const nets = items.map((i) => ({ id: i.id, total: i.kind === "pacote_sessao" || i.kind === "divida" ? 0 : netOf(i) }));
  const cardFees = allocateByNet(nets, pays.reduce((a, p) => a + (p.feeCents ?? 0), 0));
  const creditCents = pays.filter((p) => p.method === "credito").reduce((a, p) => a + p.valueCents, 0);
  const anticipation = allocateByNet(nets, casa.antecipacaoBp ? feeCents(creditCents, casa.antecipacaoBp) : 0);

  // Retrato fiscal (Fase D): o CNPJ da profissional só vale para quem é parceira (salão-parceiro, Lei 13.352/2016); net_cents = valor do item na nota.
  const partnerCnpjs = new Map((proIds.length ? await tx.select({ id: professionals.id, cnpj: professionals.cnpj }).from(professionals)
    .where(and(inArray(professionals.id, proIds), eq(professionals.bond, "parceira"))) : []).map((p) => [p.id, p.cnpj]));

  for (const it of items) {
    if (o.only && !o.only.has(it.id)) continue;
    const set: Partial<typeof comandaItems.$inferInsert> = {
      totalCents: totalOf(it), netCents: netOf(it), partnerCnpj: it.professionalId ? partnerCnpjs.get(it.professionalId) ?? null : null, commissionBaseCents: null, commissionBp: null, commissionCents: null, commissionGrossCents: null, commissionDeductions: null, commissionHeld: false,
    };
    if (COMMISSIONED.includes(it.kind) && it.professionalId) {
      const pkg = it.kind === "pacote_sessao" ? pkgs.get(it.clientPackageId ?? "") : undefined;
      const base = it.kind === "pacote_sessao" ? (pkg?.unitCents != null ? pkg.unitCents * Number(it.qty) : null) : netOf(it);
      const rate = it.serviceId ? rates.get(`${it.professionalId}:${it.serviceId}`) : undefined;
      const mine = assistantRows.filter((a) => a.comandaItemId === it.id);
      set.commissionBaseCents = base;
      set.commissionBp = rate?.bp ?? null;
      set.commissionHeld = o.held;
      if (base != null) {
        const cost = it.serviceId ? costs.get(it.serviceId) ?? null : null;
        const r = itemCommission({
          baseCents: base, bp: rate?.bp ?? null, cardFeeCents: cardFees.get(it.id) ?? 0, anticipationCents: anticipation.get(it.id) ?? 0,
          costCents: cost == null ? 0 : Math.round(cost * Number(it.qty)), assistants: mine.map((a) => ({ professionalId: a.professionalId, bp: rate?.assistantBp ?? null })),
        }, ruleOf.get(it.professionalId)!);
        Object.assign(set, { commissionGrossCents: r.grossCents, commissionDeductions: r.deductions, commissionCents: r.commissionCents });
        for (const [k, a] of mine.entries()) {
          await tx.update(comandaItemAssistants).set({ baseCents: r.assistants[k].baseCents, bp: r.assistants[k].bp, commissionCents: r.assistants[k].commissionCents })
            .where(eq(comandaItemAssistants.id, a.id));
        }
      }
    }
    await tx.update(comandaItems).set(set).where(eq(comandaItems.id, it.id));
  }
}

/** Reabrir ou cancelar a fechada: apaga o retrato dos itens vivos e das assistentes deles (o próximo Finalizar refaz). */
export async function clearCommissionSnapshotTx(tx: Tx, comandaId: string): Promise<void> {
  const ids = (await tx.select({ id: comandaItems.id }).from(comandaItems).where(and(eq(comandaItems.comandaId, comandaId), isNull(comandaItems.cancelledAt)))).map((r) => r.id);
  if (!ids.length) return;
  await tx.update(comandaItems).set({ totalCents: null, netCents: null, partnerCnpj: null, commissionBp: null, commissionBaseCents: null, commissionCents: null, commissionGrossCents: null, commissionDeductions: null, commissionHeld: false })
    .where(inArray(comandaItems.id, ids));
  await tx.update(comandaItemAssistants).set({ baseCents: null, bp: null, commissionCents: null }).where(inArray(comandaItemAssistants.comandaItemId, ids));
}
