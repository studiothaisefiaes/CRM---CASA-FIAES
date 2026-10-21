import { money } from "./format";

/** Contas da comanda e do caixa (7.3), puras e em centavos. Servem ao servidor (que decide) e à tela (que mostra). */
export const PAY_METHODS = ["pix", "credito", "debito", "dinheiro", "cortesia", "credito_cliente", "outra"] as const;
export type PayMethod = (typeof PAY_METHODS)[number];
export const PAY_LABEL: Record<PayMethod, string> = {
  pix: "Pix", credito: "Crédito", debito: "Débito", dinheiro: "Dinheiro", cortesia: "Cortesia", credito_cliente: "Crédito da cliente", outra: "Outra forma",
};
/** Formas conferidas no fechamento do caixa: dinheiro pelas cédulas, as outras pelo total. Cortesia e crédito da cliente não são dinheiro que entrou. */
export const DRAWER_METHODS = ["dinheiro", "pix", "credito", "debito", "outra"] as const;
export type DrawerMethod = (typeof DRAWER_METHODS)[number];
export const isDrawerMethod = (m: string): m is DrawerMethod => (DRAWER_METHODS as readonly string[]).includes(m);

/** Bandeiras (catálogo fechado do Norte Vendas, lib/labels.ts): obrigatórias no crédito e no débito. */
export const CARD_BRANDS = ["visa", "mastercard", "elo", "amex", "hipercard", "alelo", "sodexo", "ticket", "vr", "cabal", "outro"] as const;
export type CardBrand = (typeof CARD_BRANDS)[number];
export const CARD_BRAND_LABEL: Record<CardBrand, string> = {
  visa: "Visa", mastercard: "Mastercard", elo: "Elo", amex: "Amex", hipercard: "Hipercard", alelo: "Alelo", sodexo: "Sodexo", ticket: "Ticket", vr: "VR", cabal: "Cabal", outro: "Outra",
};
export const isCardMethod = (m: string): boolean => m === "credito" || m === "debito";

/** Nota fiscal futura: produto é NFC-e; o resto (serviço, pacote, sessão) é NFS-e. */
export const fiscalKindOf = (kind: string): "servico" | "produto" => (kind === "produto" ? "produto" : "servico");

export const itemGross = (i: { qty: number; unitCents: number | null }): number | null => (i.unitCents == null ? null : Math.round(i.qty * i.unitCents));
export function itemTotal(i: { qty: number; unitCents: number | null; discountCents: number }): number | null {
  const g = itemGross(i);
  return g == null ? null : Math.max(0, g - Math.max(0, i.discountCents));
}

/** Desconto em R$ (centavos) ou em %, sobre o bruto. */
export function discountFrom(input: { cents?: number | null; percent?: number | null }, gross: number): number {
  if (input.percent != null) return Math.round((gross * input.percent) / 100);
  return Math.max(0, Math.round(input.cents ?? 0));
}

/** Desconto da comanda rateado pelos itens, proporcional ao total de cada um; a sobra do arredondamento vai para o maior item. */
export function splitDiscount(totals: { id: string; total: number }[], discountCents: number): Map<string, number> {
  const out = new Map(totals.map((t) => [t.id, 0]));
  const sum = totals.reduce((a, t) => a + t.total, 0);
  if (!discountCents || !sum) return out;
  let given = 0;
  for (const t of totals) { const part = Math.floor((discountCents * t.total) / sum); out.set(t.id, part); given += part; }
  const largest = [...totals].sort((a, b) => b.total - a.total)[0];
  out.set(largest.id, out.get(largest.id)! + (discountCents - given));
  return out;
}

/**
 * A cortesia da comanda rateada pelos itens (QA r58, C-3), como o desconto: proporcional ao líquido de cada um (já sem o desconto). Ela não
 * é faturamento: sai da base da comissão e do faturamento por profissional e serviço. Nunca passa do líquido do item.
 */
export function courtesyShares(nets: { id: string; total: number }[], courtesyCents: number): Map<string, number> {
  const priced = nets.map((n) => ({ id: n.id, total: Math.max(0, n.total) }));
  const out = splitDiscount(priced, Math.min(Math.max(0, courtesyCents), priced.reduce((a, n) => a + n.total, 0)));
  for (const n of priced) out.set(n.id, Math.min(out.get(n.id) ?? 0, n.total));
  return out;
}

/** `kind` "divida" (quitação de dívida, Fase A): fica fora do desconto da comanda (a quitação é sempre o valor cheio do item). */
export type MathItem = { id: string; label: string; qty: number; unitCents: number | null; discountCents: number; kind?: string };
export type ComandaTotals = {
  subtotalCents: number; discountCents: number; totalCents: number; missingPrice: string[]; shares: Map<string, number>;
  /** O que aceita desconto e cortesia: tudo menos os itens de dívida. */ discountableCents: number;
};

export function comandaTotals(items: MathItem[], comandaDiscountCents: number): ComandaTotals {
  const priced = items.flatMap((i) => { const t = itemTotal(i); return t == null ? [] : [{ id: i.id, total: t, debt: i.kind === "divida" }]; });
  const subtotalCents = priced.reduce((a, t) => a + t.total, 0);
  const sales = priced.filter((t) => !t.debt);
  const discountableCents = sales.reduce((a, t) => a + t.total, 0);
  const discountCents = Math.min(Math.max(0, comandaDiscountCents), discountableCents);
  const shares = splitDiscount(sales, discountCents);
  for (const t of priced) if (t.debt) shares.set(t.id, 0);
  return { subtotalCents, discountCents, totalCents: subtotalCents - discountCents, missingPrice: items.filter((i) => i.unitCents == null).map((i) => i.label), shares, discountableCents };
}

/** Comissão: base × bp / 10000, meio centavo para cima. */
export const commissionCents = (baseCents: number, bp: number): number => Math.floor((baseCents * bp + 5000) / 10000);

export type PaymentLine = { method: PayMethod | string; valueCents: number };
const sumOf = (pays: PaymentLine[], pick: (p: PaymentLine) => boolean) => pays.filter(pick).reduce((a, p) => a + p.valueCents, 0);

/** Troco (Norte, calculateChangeForMethods): sobre o que o dinheiro precisava cobrir (total − o que as outras formas pagaram), nunca sobre o total cheio. */
export function changeFor(pays: PaymentLine[], totalCents: number): number {
  const cash = sumOf(pays, (p) => p.method === "dinheiro");
  const owedInCash = Math.max(0, totalCents - sumOf(pays, (p) => p.method !== "dinheiro"));
  return Math.max(0, cash - owedInCash);
}

/** Um pagamento novo pode entrar? Outra forma nunca passa do restante; o dinheiro passa (a diferença vira troco). Null = pode. */
export function checkNewPayment(i: { totalCents: number; paidCents: number; method: PayMethod | string; valueCents: number }): string | null {
  const remaining = i.totalCents - i.paidCents;
  if (remaining <= 0) return "Essa comanda já está paga.";
  if (i.method !== "dinheiro" && i.valueCents > remaining) return `Passa do que falta (${money(remaining)}). Só o dinheiro pode passar e virar troco.`;
  return null;
}

/** A soma bate com o total; as outras formas não passam do total; o troco sai só do dinheiro (changeFor). */
export function checkPayments(totalCents: number, pays: PaymentLine[]): { ok: true; paidCents: number; changeCents: number } | { ok: false; error: string } {
  const paidCents = pays.reduce((a, p) => a + p.valueCents, 0);
  if (paidCents < totalCents) return { ok: false, error: `Faltam ${money(totalCents - paidCents)} para fechar.` };
  if (sumOf(pays, (p) => p.method !== "dinheiro") > totalCents) return { ok: false, error: "Só o dinheiro pode passar do total." };
  return { ok: true, paidCents, changeCents: changeFor(pays, totalCents) };
}

export const expectedCash = (o: { openingCents: number; cashInCents: number; changeOutCents: number; suprimentosCents: number; sangriasCents: number }): number =>
  o.openingCents + o.cashInCents - o.changeOutCents + o.suprimentosCents - o.sangriasCents;

/** O esperado do caixa por forma. `received` já vem líquido do troco (o dinheiro devolvido não fica na gaveta). */
export function expectedByMethod(o: { openingCents: number; received: PaymentLine[]; suprimentosCents: number; sangriasCents: number }): Record<DrawerMethod, number> {
  const sum = (m: DrawerMethod) => sumOf(o.received, (p) => p.method === m);
  return {
    dinheiro: expectedCash({ openingCents: o.openingCents, cashInCents: sum("dinheiro"), changeOutCents: 0, suprimentosCents: o.suprimentosCents, sangriasCents: o.sangriasCents }),
    pix: sum("pix"), credito: sum("credito"), debito: sum("debito"), outra: sum("outra"),
  };
}

/** Contado − esperado, por forma. O que não foi contado vale zero (contado em branco é "não tinha nada"). */
export function cashDifference(expected: Record<string, number>, counted: Record<string, number | null | undefined>): { byMethod: Record<string, number>; totalCents: number } {
  const byMethod = Object.fromEntries(Object.entries(expected).map(([m, e]) => [m, (counted[m] ?? 0) - e]));
  return { byMethod, totalCents: Object.values(byMethod).reduce((a, d) => a + d, 0) };
}

/** Diferença do fechamento que pede aprovação da gestão (acima da tolerância, para mais ou para menos). */
export const needsApproval = (differenceCents: number, toleranciaCents: number): boolean => Math.abs(differenceCents) > Math.max(0, toleranciaCents);
/**
 * A tolerância vale para CADA forma (QA r58, C-1): falta no dinheiro com sobra no Pix são duas diferenças, nunca uma soma zero.
 * Pede a gestão se qualquer forma passar dela.
 */
export const needsApprovalByMethod = (byMethod: Record<string, number>, toleranciaCents: number): boolean =>
  Object.values(byMethod).some((d) => needsApproval(d, toleranciaCents));
/** As formas com diferença, na ordem do fechamento: "Dinheiro -R$ 100 · Pix R$ 100". Vazio quando bate tudo. */
export function differencesOf(expected: Record<string, number> | null | undefined, counted: Record<string, number | null | undefined> | null | undefined): { method: DrawerMethod; cents: number }[] {
  if (!expected || !counted) return [];
  const { byMethod } = cashDifference(expected, counted);
  return DRAWER_METHODS.map((m) => ({ method: m, cents: byMethod[m] ?? 0 })).filter((d) => d.cents !== 0);
}
export const differencesText = (list: { method: DrawerMethod; cents: number }[]): string => list.map((d) => `${PAY_LABEL[d.method]} ${money(d.cents)}`).join(" · ");
/** As formas com diferença a partir do contado − esperado por forma (o que o fechamento devolve). */
export const nonZeroDifferences = (byMethod: Partial<Record<string, number>> | null | undefined): { method: DrawerMethod; cents: number }[] =>
  byMethod ? DRAWER_METHODS.map((m) => ({ method: m, cents: byMethod[m] ?? 0 })).filter((d) => d.cents !== 0) : [];

/** "40" → 4000; "12,5" → 1250. Fora de 0 a 100, ou texto, é null. */
export function percentToBp(text: string): number | null {
  const t = text.trim().replace(",", ".");
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(t)) return null;
  const bp = Math.round(Number(t) * 100);
  return bp >= 0 && bp <= 10000 ? bp : null;
}
export const bpToPercent = (bp: number | null): string => (bp == null ? "" : String(bp / 100).replace(".", ","));

/** Taxa do cartão: valor × bp / 10000, meio centavo para cima (igual à comissão). */
export const feeCents = (valueCents: number, bp: number): number => commissionCents(valueCents, bp);
