/**
 * Ganhos da profissional (Lote 7A, seção 8.4.7): monta hoje e o mês a partir das linhas do relatório de comissão do 6C
 * (`CommissionLine` de src/server/domain/caixa/commission.ts). Puro. Nunca soma linha sem regra, sessão sem valor nem a retida pela dívida.
 */
import { firstName } from "./authorship";

/** O formato de `CommissionLine` (6C): uma linha de comanda fechada, com a comissão congelada no fechamento. */
export type CommissionLineLike = {
  itemId: string; day: string; clientName: string; label: string; kind: string;
  baseCents: number | null; bp: number | null; commissionCents: number | null; status: "ok" | "sem_regra" | "sem_valor_sessao" | "aguardando_quitacao";
  /** Fase A: a linha da assistente vem com o rótulo "{serviço} (assistente de {principal})" e o retrato dela (base, %, comissão). */
  role?: "principal" | "assistente"; principalName?: string | null;
};
export type EarningLine = { id: string; day: string; client: string; label: string; pct: string | null; commissionCents: number | null; serviceCents: number | null; why: string | null };
export type EarningsPeriod = { totalCents: number; lines: EarningLine[] };
export type EarningsWaiting = { id: string; day: string; client: string; service: string };
/** Os recibos de pagamento da comissão dela (Fase A, Tarefa 9), do mais novo; os desfeitos não entram. */
export type EarningsReceipt = { id: string; number: number; paidAt: string; netCents: number };
export type Earnings = { configured: boolean; today: EarningsPeriod; month: EarningsPeriod; waiting: EarningsWaiting[]; receipts: EarningsReceipt[] };

const pctText = (bp: number) => `${(bp / 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
const total = (lines: EarningLine[]) => lines.reduce((s, l) => s + (l.commissionCents ?? 0), 0);

export function buildEarnings(i: { lines: CommissionLineLike[]; today: string; configured: boolean; waiting: EarningsWaiting[]; showServiceValue: boolean; receipts?: EarningsReceipt[] }): Earnings {
  const lines = i.lines.map((r, k) => ({ r, k })).sort((a, b) => (a.r.day === b.r.day ? a.k - b.k : a.r.day < b.r.day ? 1 : -1)).map(({ r }): EarningLine => ({
    id: r.itemId, day: r.day, client: firstName(r.clientName) ?? "Cliente", label: r.label,
    pct: r.status === "ok" && r.bp != null ? pctText(r.bp) : null,
    commissionCents: r.status === "ok" ? r.commissionCents : null,
    // O valor do serviço (a base da comissão, já com desconto) só com "Mostrar o valor do serviço".
    serviceCents: i.showServiceValue ? r.baseCents : null,
    why: r.status === "sem_regra" ? `Comissão ainda não configurada para ${r.label}. Fale com a gestão.` : r.status === "sem_valor_sessao" ? "Valor da sessão não definido. Fale com a gestão."
      : r.status === "aguardando_quitacao" ? "Espera a cliente quitar a dívida da comanda." : null,
  }));
  const todays = lines.filter((l) => l.day === i.today);
  return { configured: i.configured, today: { totalCents: total(todays), lines: todays }, month: { totalCents: total(lines), lines }, waiting: i.waiting, receipts: i.receipts ?? [] };
}
