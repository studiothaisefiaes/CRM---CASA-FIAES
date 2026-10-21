import { commissionCents, splitDiscount } from "./comanda-math";
import type { CommissionRules, DeductMode } from "./commission-rules";

/** Conta da comissão de um item (decisões 3 e 4 do plano). Pura, em centavos. */
export type Deductions = { cartao: number; antecipacao: number; custo: number; assistentes: number };
export type ItemCommissionInput = {
  baseCents: number;
  bp: number | null;
  cardFeeCents: number;
  anticipationCents: number;
  costCents: number;
  assistants: { professionalId: string; bp: number | null }[];
};
export type ItemCommission = {
  grossCents: number | null;
  deductions: Deductions;
  commissionCents: number | null;
  assistants: { professionalId: string; baseCents: number; bp: number | null; commissionCents: number | null }[];
};

export function itemCommission(i: ItemCommissionInput, r: CommissionRules): ItemCommission {
  const parts: [DeductMode, number][] = [[r.cartao, i.cardFeeCents], [r.antecipacao, i.anticipationCents], [r.custo, i.costCents]];
  const antes = parts.reduce((a, [m, v]) => a + (m === "antes" ? v : 0), 0);
  const net = Math.max(0, i.baseCents - antes);
  const gross = i.bp == null ? null : commissionCents(i.baseCents, i.bp);
  const effect = (m: DeductMode, v: number) => (m === "nao" ? 0 : m === "depois" ? v : i.bp == null ? 0 : commissionCents(v, i.bp));

  const two = i.assistants.length === 2 && r.doisAssistentes === "metade";
  const assistants = i.assistants.map((a, idx) => {
    const baseCents = two ? (idx === 0 ? Math.floor(net / 2) : net - Math.floor(net / 2)) : net;
    return { professionalId: a.professionalId, baseCents, bp: a.bp, commissionCents: a.bp == null ? null : commissionCents(baseCents, a.bp) };
  });
  const assistentes = Math.round((assistants.reduce((a, x) => a + (x.commissionCents ?? 0), 0) * r.assistenteSaiDaPrincipalBp) / 10000);
  const deductions: Deductions = {
    cartao: effect(r.cartao, i.cardFeeCents), antecipacao: effect(r.antecipacao, i.anticipationCents), custo: effect(r.custo, i.costCents), assistentes,
  };
  const total = deductions.cartao + deductions.antecipacao + deductions.custo + deductions.assistentes;
  return { grossCents: gross, deductions, commissionCents: gross == null ? null : Math.max(0, gross - total), assistants };
}

/** Rateio de um valor da comanda pelos itens, proporcional ao líquido de cada um (negativo conta 0). */
export function allocateByNet(nets: { id: string; total: number }[], amountCents: number): Map<string, number> {
  return splitDiscount(nets.map((n) => ({ id: n.id, total: Math.max(0, n.total) })), amountCents);
}
