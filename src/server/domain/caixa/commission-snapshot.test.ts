import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import { db } from "../../db";
import { comandaItemAssistants, comandaItems, professionals, settings } from "../../db/schema";
import { resetDb } from "../../../../test/db";
import { NOW, setSetting } from "../../../../test/agenda-fixtures";
import { setupCaixa } from "../../../../test/caixa-fixtures";
import { comandaFechada } from "../../../../test/comanda-fixtures";
import type { CommissionRules } from "@/lib/commission-rules";
import { updateService } from "../services";
import { addItem, addPayment, closeComanda, openWalkInComanda, reopenComanda } from "./comandas";
import { commissionReport, setCommission } from "./commission";
import { commissionLinesPort } from "../agenda/ports";
import { financeItens } from "../../reports/financeiro/itens";
import { saveCommissionRules, saveProfessionalCommissionRules, setAssistantCommission } from "./commission-rules";
import { savePaymentFee } from "./payment-fees";

/** As regras da Casa (migration 0063). */
const CASA: CommissionRules = { cartao: "antes", antecipacao: "antes", antecipacaoBp: 700, custo: "depois", doisAssistentes: "metade", assistenteSaiDaPrincipalBp: 10000, divida: "quitacao" };

let s: Awaited<ReturnType<typeof setupCaixa>>;
let sidney: { id: string };
beforeEach(async () => {
  await resetDb(); s = await setupCaixa({ estoque: false });
  [sidney] = await db.insert(professionals).values({ name: "Sidney", fullName: "Sidney Souza", assistantOf: s.ana.id, agendaPosition: 3 }).returning();
  await setCommission({ professionalId: s.ana.id, serviceId: s.corte.id, bp: 4000 }, s.caixaGestao); // Ana 40% no Corte
  await setAssistantCommission({ professionalId: s.ana.id, serviceId: s.corte.id, bp: 1000 }, s.caixaGestao); // % da assistente 10%
  await updateService(s.corte.id, { costCents: 1000 }, s.gestora.id); // custo R$ 10
  await savePaymentFee({ method: "credito", brand: "visa", parcelado: false, feeBp: 243 }, s.caixaGestao); // Visa à vista 2,43%
  await saveCommissionRules(CASA, s.caixaGestao);
});

const corte200 = () => comandaFechada(s, { items: [{ serviceId: s.corte.id, professionalId: s.ana.id, unitCents: 20000 }], pays: [{ method: "credito", valueCents: 20000, brand: "visa" }] });
const itemsOf = (comandaId: string) => db.select().from(comandaItems).where(eq(comandaItems.comandaId, comandaId)).orderBy(asc(comandaItems.createdAt));
const retrato = (it: typeof comandaItems.$inferSelect) => [it.commissionBaseCents, it.commissionGrossCents, it.commissionDeductions, it.commissionCents];
const assistentes = async () => (await db.select().from(comandaItemAssistants).orderBy(asc(comandaItemAssistants.position))).map((a) => [a.baseCents, a.bp, a.commissionCents]);

/*
 * A conta do Corte de R$ 200 no crédito Visa à vista, com as regras da Casa:
 *   bruta = 40% × 20000 = 8000
 *   taxa do cartão = 2,43% × 20000 = 486 ("antes": tira 486 × 40% = 194 da comissão)
 *   antecipação = 7% × 20000 = 1400 ("antes": tira 1400 × 40% = 560)
 *   custo = 1000 ("depois": tira 1000 inteiro)
 *   base da assistente = 20000 − 486 − 1400 = 18114 (o custo "depois" não sai da base); Sidney 10% = 1811; sai 100% da Ana
 *   Ana = 8000 − 194 − 560 − 1000 − 1811 = 4435
 */
describe("retrato da comissão no Finalizar", () => {
  it("Corte R$ 200 no crédito Visa: o retrato guarda bruta, cada desconto, a assistente e o que fica para a Ana", async () => {
    const { comandaId } = await corte200();
    const [it] = await itemsOf(comandaId);
    expect(retrato(it)).toEqual([20000, 8000, { cartao: 194, antecipacao: 560, custo: 1000, assistentes: 1811 }, 4435]);
    expect(await assistentes()).toEqual([[18114, 1000, 1811]]);
    expect((await db.select().from(comandaItemAssistants))[0].professionalId).toBe(sidney.id);
  });

  it("taxa e antecipação da comanda são rateadas pelo líquido de cada item (o produto leva a parte dele)", async () => {
    // Corte 20000 + Kit 10000 no crédito Visa 30000: taxa 729 → 486 / 243; antecipação 2100 → 1400 / 700. A Ana fica igual.
    const w = await openWalkInComanda({ requestKey: randomUUID() }, s.caixaRecepcao, NOW);
    await addItem(w.comandaId, { kind: "servico", serviceId: s.corte.id, professionalId: s.ana.id, unitCents: 20000, reason: "preço combinado" }, s.caixaRecepcao, NOW);
    await addItem(w.comandaId, { kind: "produto", label: "Kit", unitCents: 10000 }, s.caixaRecepcao, NOW);
    await addPayment(w.comandaId, { method: "credito", valueCents: 30000, brand: "visa" }, s.caixaRecepcao, NOW);
    await closeComanda(w.comandaId, {}, s.caixaRecepcao, NOW);
    const [corte, kit] = await itemsOf(w.comandaId);
    expect(retrato(corte)).toEqual([20000, 8000, { cartao: 194, antecipacao: 560, custo: 1000, assistentes: 1811 }, 4435]);
    expect(retrato(kit)).toEqual([null, null, null, null]);
  });

  it("duas assistentes com \"metade\": cada uma sobre metade da base, e as duas saem da Ana", async () => {
    await db.insert(professionals).values({ name: "Roberta", fullName: "Roberta Lima", assistantOf: s.ana.id, agendaPosition: 4 });
    const { comandaId } = await corte200();
    const [it] = await itemsOf(comandaId);
    // 18114 / 2 = 9057 para cada; 10% = 906 cada; 8000 − 194 − 560 − 1000 − 1812 = 4434
    expect(await assistentes()).toEqual([[9057, 1000, 906], [9057, 1000, 906]]);
    expect(retrato(it)).toEqual([20000, 8000, { cartao: 194, antecipacao: 560, custo: 1000, assistentes: 1812 }, 4434]);
  });

  it("regra própria da profissional vale só para ela; com as regras neutras o resultado é o de antes", async () => {
    await setCommission({ professionalId: s.bia.id, serviceId: s.corte.id, bp: 4000 }, s.caixaGestao);
    await saveProfessionalCommissionRules(s.bia.id, { custo: "nao" }, s.caixaGestao);
    const { comandaId } = await comandaFechada(s, {
      items: [{ serviceId: s.corte.id, professionalId: s.ana.id, unitCents: 20000 }, { serviceId: s.corte.id, professionalId: s.bia.id, unitCents: 20000 }],
      pays: [{ method: "credito", valueCents: 40000, brand: "visa" }],
    });
    const [ana, bia] = await itemsOf(comandaId);
    expect(retrato(ana)).toEqual([20000, 8000, { cartao: 194, antecipacao: 560, custo: 1000, assistentes: 1811 }, 4435]);
    // Bia: sem custo e sem assistente: 8000 − 194 − 560 = 7246
    expect(retrato(bia)).toEqual([20000, 8000, { cartao: 194, antecipacao: 560, custo: 0, assistentes: 0 }, 7246]);

    // Sem a linha comissao_regras (como nos testes antigos): neutro, nada descontado, a Ana fica com os 40% de R$ 120.
    await db.delete(settings).where(eq(settings.key, "comissao_regras"));
    const neutro = await comandaFechada(s, { items: [{ serviceId: s.corte.id, professionalId: s.ana.id }], pays: [{ method: "credito", valueCents: 12000, brand: "visa" }] });
    const [n] = await itemsOf(neutro.comandaId);
    expect(retrato(n)).toEqual([12000, 4800, { cartao: 0, antecipacao: 0, custo: 0, assistentes: 0 }, 4800]);
  });

  it("reabrir apaga o retrato (inclusive das assistentes); fechar de novo refaz igual, mesmo com a taxa Visa mudada depois", async () => {
    const { comandaId } = await corte200();
    await reopenComanda(comandaId, { reason: "conferir" }, s.caixaRecepcao, NOW);
    const [aberto] = await itemsOf(comandaId);
    expect([aberto.totalCents, aberto.commissionBp, aberto.commissionHeld, ...retrato(aberto)]).toEqual([null, null, false, null, null, null, null]);
    expect(await assistentes()).toEqual([[null, null, null]]);
    // A taxa é o retrato do pagamento: mudar a Visa agora não mexe no que a comanda já recebeu.
    await savePaymentFee({ method: "credito", brand: "visa", parcelado: false, feeBp: 500 }, s.caixaGestao);
    await closeComanda(comandaId, {}, s.caixaRecepcao, NOW);
    const [it] = await itemsOf(comandaId);
    expect(retrato(it)).toEqual([20000, 8000, { cartao: 194, antecipacao: 560, custo: 1000, assistentes: 1811 }, 4435]);
    expect(await assistentes()).toEqual([[18114, 1000, 1811]]);
  });
});

describe("liga/desliga no retrato (Configurações › Caixa)", () => {
  const fecharCom = async (recursos: Record<string, unknown>) => {
    const w = await openWalkInComanda({ requestKey: randomUUID() }, s.caixaRecepcao, NOW);
    await addItem(w.comandaId, { kind: "servico", serviceId: s.corte.id, professionalId: s.ana.id, unitCents: 20000, reason: "preço combinado" }, s.caixaRecepcao, NOW);
    await addPayment(w.comandaId, { method: "credito", valueCents: 20000, brand: "visa" }, s.caixaRecepcao, NOW);
    await setSetting("caixa_recursos", recursos); // desligado depois de lançar: vale o que está no Finalizar
    await closeComanda(w.comandaId, {}, s.caixaRecepcao, NOW);
    return (await itemsOf(w.comandaId))[0];
  };

  it("\"Assistente na comanda\" desligado: o retrato ignora a assistente", async () => {
    const it = await fecharCom({ assistentes: false });
    // 8000 − 194 − 560 − 1000 = 6246 (a Sidney continua no item, sem base nem comissão)
    expect(retrato(it)).toEqual([20000, 8000, { cartao: 194, antecipacao: 560, custo: 1000, assistentes: 0 }, 6246]);
    expect(await assistentes()).toEqual([[null, null, null]]);
    // Ignorada também na leitura: nada de linha "sem regra" na Sidney, nem pendência no relatório, no Financeiro ou no app dela.
    const rep = await commissionReport({ from: "2026-10-01", to: "2026-10-31" });
    expect([rep.rows.map((r) => r.name), rep.pending]).toEqual([["Ana"], 0]);
    expect((await financeItens({ from: "2026-10-01", to: "2026-10-31" })).commission).toMatchObject({ crmCents: 6246, crmPending: 0 });
    expect(await commissionLinesPort({ from: "2026-10-01", to: "2026-10-31", professionalId: sidney.id })).toEqual([]);
  });

  it("\"Comissão com taxa, antecipação e custo\" desligado: nada de taxa, antecipação e custo; a assistente segue", async () => {
    const it = await fecharCom({ comissaoComDescontos: false });
    // Sem nada "antes", a base da assistente é 20000: Sidney 10% = 2000, que sai da Ana: 8000 − 2000 = 6000
    expect(retrato(it)).toEqual([20000, 8000, { cartao: 0, antecipacao: 0, custo: 0, assistentes: 2000 }, 6000]);
    expect(await assistentes()).toEqual([[20000, 1000, 2000]]);
  });
});
