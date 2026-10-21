import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { auditLog, cashSessions, comandaItems, comandaPayments, comandas } from "../../db/schema";
import { resetDb } from "../../../../test/db";
import { NOW, setSetting } from "../../../../test/agenda-fixtures";
import { setupCaixa } from "../../../../test/caixa-fixtures";
import { money } from "@/lib/format";
import { addMovement, cashSummary, closeCash, getOpenCashTx, openCash, reopenCash, userHasPerm } from "./cash";
import { assertCaixaOn, getCaixaRules, saveCaixaRules, saveCaixaSettings } from "./mode";

let s: Awaited<ReturnType<typeof setupCaixa>>;
beforeEach(async () => { await resetDb(); s = await setupCaixa({ estoque: false }); });

let n = 0;
/** Uma comanda com os pagamentos dados, cada um no caixa indicado (atalho de teste: a Tarefa 4 recebe de verdade). */
async function recebido(pays: { session: string | null; method: string; valueCents: number; changeCents?: number; brand?: string }[], status = "fechada") {
  const [c] = await db.insert(comandas).values({ day: "2026-10-15", number: ++n, status, openedBy: s.cati.id }).returning();
  if (pays.length) await db.insert(comandaPayments).values(pays.map((p) => ({ comandaId: c.id, method: p.method, valueCents: p.valueCents, changeCents: p.changeCents ?? 0, cashSessionId: p.session,
    brand: p.brand ?? (p.method === "credito" || p.method === "debito" ? "visa" : null), createdBy: s.cati.id })));
  return c;
}
const zeros = { pix: 0, credito: 0, debito: 0, outra: 0 };

describe("modo e regras", () => {
  it("modo avec recusa com 'O caixa ainda é no Avec.'; sem regra gravada, os padrões do fechamento", async () => {
    await setSetting("caixa_modo", "avec");
    await expect(assertCaixaOn()).rejects.toThrow("O caixa ainda é no Avec.");
    await expect(openCash({ openingCents: 0 }, s.caixaRecepcao, NOW)).rejects.toThrow("O caixa ainda é no Avec.");
    // QA r58, I-1: a contagem cega nasce ligada.
    expect(await getCaixaRules()).toEqual({ exigeCaixaAberto: false, toleranciaCents: 500, contagemCega: true, sangriaGrandeCents: 20000, aprovacaoDescontoBp: null, notaPadrao: "perguntar" });
  });

  it("salvar o modo não apaga as regras do fechamento, e salvar as regras não apaga 'exigir caixa aberto'", async () => {
    await saveCaixaRules({ toleranciaCents: 1000, contagemCega: true, sangriaGrandeCents: 50000 }, s.gestora.id);
    await saveCaixaSettings({ mode: "crm", exigeCaixaAberto: true }, s.gestora.id);
    expect(await getCaixaRules()).toEqual({ exigeCaixaAberto: true, toleranciaCents: 1000, contagemCega: true, sangriaGrandeCents: 50000, aprovacaoDescontoBp: null, notaPadrao: "perguntar" });
    await saveCaixaRules({ toleranciaCents: 0, contagemCega: false, sangriaGrandeCents: 20000 }, s.gestora.id);
    expect((await getCaixaRules()).exigeCaixaAberto).toBe(true);
    expect(await db.select().from(auditLog).where(eq(auditLog.action, "caixa_regras"))).toHaveLength(2);
    await expect(saveCaixaRules({ toleranciaCents: -1, contagemCega: false, sangriaGrandeCents: 0 }, s.gestora.id)).rejects.toThrow("Digite a tolerância (pode ser zero).");
  });
});

describe("caixa por pessoa", () => {
  // Estes testes conferem o que a equipe vê com a contagem cega desligada (ela nasce ligada: QA r58, I-1).
  beforeEach(() => setSetting("caixa_regras", { contagemCega: false }));
  it("cada pessoa abre o seu; a mesma pessoa não abre dois", async () => {
    const a = await openCash({ openingCents: 10000 }, s.caixaRecepcao, NOW);
    const b = await openCash({ openingCents: 0 }, s.caixaGestao, NOW);
    expect((await getOpenCashTx(db, s.cati.id))?.id).toBe(a.id);
    expect((await getOpenCashTx(db, s.gestora.id))?.id).toBe(b.id);
    await expect(openCash({ openingCents: 0 }, s.caixaRecepcao, NOW)).rejects.toThrow("Seu caixa já está aberto (desde 09:00).");
  });

  it("o esperado vem dos pagamentos que entraram em cada caixa (dinheiro líquido do troco); estornado não conta", async () => {
    const a = await openCash({ openingCents: 10000 }, s.caixaRecepcao, NOW);
    const b = await openCash({ openingCents: 0 }, s.caixaGestao, NOW);
    await recebido([{ session: a.id, method: "dinheiro", valueCents: 7000, changeCents: 1000 }, { session: a.id, method: "pix", valueCents: 5000 }, { session: b.id, method: "debito", valueCents: 3000, brand: "elo" }]);
    await recebido([{ session: a.id, method: "cortesia", valueCents: 2000 }, { session: a.id, method: "credito", valueCents: 4000, brand: "visa" }], "aberta"); // parcial: já entrou
    const [estornado] = await db.insert(comandaPayments).values({ comandaId: (await recebido([]))!.id, method: "pix", valueCents: 999, cashSessionId: a.id, createdBy: s.cati.id, cancelledAt: NOW }).returning();
    expect(estornado.cancelledAt).not.toBeNull();
    const sa = await cashSummary(a.id);
    expect(sa.expected).toEqual({ dinheiro: 16000, pix: 5000, credito: 4000, debito: 0, outra: 0 });
    expect(sa.byBrand).toEqual([{ method: "credito", brand: "visa", valueCents: 4000 }]);
    expect((await cashSummary(b.id)).expected).toEqual({ dinheiro: 0, pix: 0, credito: 0, debito: 3000, outra: 0 });
  });

  it("sangria e suprimento no caixa da própria pessoa; sangria grande vai para a auditoria", async () => {
    await expect(addMovement({ kind: "suprimento", valueCents: 1000, reason: "troco" }, s.caixaRecepcao, NOW)).rejects.toThrow("Abra o seu caixa primeiro.");
    const a = await openCash({ openingCents: 50000 }, s.caixaRecepcao, NOW);
    await expect(addMovement({ kind: "sangria", valueCents: 60000, reason: "banco" }, s.caixaRecepcao, NOW)).rejects.toThrow(`No caixa há ${money(50000)} em dinheiro.`);
    await expect(addMovement({ kind: "suprimento", valueCents: 1000, reason: " " }, s.caixaRecepcao, NOW)).rejects.toThrow("Escreva o motivo.");
    await addMovement({ kind: "sangria", valueCents: 1000, reason: "café" }, s.caixaRecepcao, NOW);
    expect(await db.select().from(auditLog).where(eq(auditLog.action, "caixa_sangria_grande"))).toHaveLength(0);
    await addMovement({ kind: "sangria", valueCents: 20000, reason: "banco" }, s.caixaRecepcao, NOW);
    const [grande] = await db.select().from(auditLog).where(eq(auditLog.action, "caixa_sangria_grande"));
    expect(grande).toMatchObject({ entityId: a.id, userId: s.cati.id, data: { valor: 20000, motivo: "banco" } });
    expect((await cashSummary(a.id)).expected.dinheiro).toBe(29000);
  });
});

describe("fechar o caixa", () => {
  // Estes testes conferem o que a equipe vê com a contagem cega desligada (ela nasce ligada: QA r58, I-1).
  beforeEach(() => setSetting("caixa_regras", { contagemCega: false }));
  it("dinheiro pelas cédulas, cartão e Pix pelo total; dentro da tolerância fecha e grava a contagem", async () => {
    const a = await openCash({ openingCents: 10000 }, s.caixaRecepcao, NOW);
    await recebido([{ session: a.id, method: "dinheiro", valueCents: 7000, changeCents: 1000 }, { session: a.id, method: "pix", valueCents: 5000 }]);
    const [aberta] = await db.insert(comandas).values({ day: "2026-10-15", number: 99, status: "aberta", openedBy: s.cati.id }).returning();
    await db.insert(comandaItems).values({ comandaId: aberta.id, kind: "produto", label: "Kit", unitCents: 1000, addedBy: s.cati.id });
    await db.insert(comandas).values({ day: "2026-10-15", number: 98, status: "aberta", openedBy: s.cati.id }); // vazia: não é pendência (QA r58, I-8)
    const r = await closeCash({ cashBreakdown: { "10000": 1, "5000": 1, "200": 4, "100": 2 }, counted: { pix: 5000 } }, s.caixaRecepcao, NOW);
    expect(r).toMatchObject({ status: "fechado", differenceCents: 0, openComandas: 1, warning: "1 comanda aberta fica para o próximo caixa." });
    const [c] = await db.select().from(cashSessions).where(eq(cashSessions.id, a.id));
    expect(c).toMatchObject({ status: "fechado", differenceCents: 0, expected: { dinheiro: 16000, pix: 5000, credito: 0, debito: 0, outra: 0 }, counted: { dinheiro: 16000, pix: 5000, ...{ credito: 0, debito: 0, outra: 0 } },
      countedBreakdown: { "10000": 1, "5000": 1, "200": 4, "100": 2 }, blind: false, approvedBy: null });
    expect(await getOpenCashTx(db, s.cati.id)).toBeNull();
  });

  it("caixa no escuro por perfil: com a contagem cega desligada, sem caixa.dinheiro não vê a diferença e a sessão grava blind; com caixa.dinheiro vê", async () => {
    const sem = { id: s.cati.id, perms: ["caixa.operar"] };
    const a = await openCash({ openingCents: 10000 }, sem, NOW);
    const input = { cashBreakdown: { "5000": 1 }, counted: {} }; // 50 contados, 100 esperados: falta 50
    expect(await closeCash(input, sem, NOW)).toEqual({ status: "precisa_aprovacao", differenceCents: null, differences: null });
    const r = await closeCash({ ...input, approverId: s.gestora.id }, sem, NOW);
    expect(r).toMatchObject({ status: "fechado", differenceCents: -5000 });
    expect((await db.select().from(cashSessions).where(eq(cashSessions.id, a.id)))[0]).toMatchObject({ blind: true });
    const com = { id: s.cati.id, perms: ["caixa.operar", "caixa.dinheiro"] };
    const b = await openCash({ openingCents: 10000 }, com, NOW);
    expect(await closeCash(input, com, NOW)).toMatchObject({ status: "precisa_aprovacao", differenceCents: -5000, differences: expect.objectContaining({ dinheiro: -5000 }) });
    await closeCash({ ...input, approverId: s.gestora.id }, com, NOW);
    expect((await db.select().from(cashSessions).where(eq(cashSessions.id, b.id)))[0]).toMatchObject({ blind: false });
  });

  it("acima da tolerância pede aprovação; aprovador sem caixa.gerir não vale; a gestão aprova", async () => {
    await openCash({ openingCents: 10000 }, s.caixaRecepcao, NOW);
    const input = { cashBreakdown: { "5000": 1, "2000": 2 }, counted: zeros }; // 9.000 contra 10.000
    expect(await closeCash(input, s.caixaRecepcao, NOW)).toEqual({ status: "precisa_aprovacao", differenceCents: -1000, differences: { dinheiro: -1000, pix: 0, credito: 0, debito: 0, outra: 0 } });
    expect(await closeCash({ ...input, approverId: s.cati.id }, s.caixaRecepcao, NOW)).toMatchObject({ status: "precisa_aprovacao", differenceCents: -1000 });
    const r = await closeCash({ ...input, approverId: s.gestora.id }, s.caixaRecepcao, NOW);
    expect(r).toMatchObject({ status: "fechado", differenceCents: -1000 });
    const [c] = await db.select().from(cashSessions);
    expect(c).toMatchObject({ approvedBy: s.gestora.id, differenceCents: -1000 });
    const [log] = await db.select().from(auditLog).where(eq(auditLog.action, "caixa_fechado"));
    expect(log.data).toMatchObject({ diferenca: -1000, aprovadoPor: s.gestora.id });
  });

  it("compara forma por forma (QA r58, C-1): falta de R$ 100 no dinheiro e sobra de R$ 100 no Pix são duas diferenças e pedem a gestão", async () => {
    const a = await openCash({ openingCents: 10000 }, s.caixaRecepcao, NOW);
    await recebido([{ session: a.id, method: "dinheiro", valueCents: 14000 }, { session: a.id, method: "pix", valueCents: 9000 }, { session: a.id, method: "debito", valueCents: 3000, brand: "visa" }]);
    // Esperado: dinheiro 24.000, Pix 9.000, débito 3.000. Contado: dinheiro 14.000 (falta 100), Pix 19.000 (sobra 100), débito certo.
    const input = { cashBreakdown: { "10000": 1, "2000": 2 }, counted: { ...zeros, pix: 19000, debito: 3000 }, notes: "Pix lançado no lugar do dinheiro" };
    const r = await closeCash(input, s.caixaRecepcao, NOW);
    expect(r).toEqual({ status: "precisa_aprovacao", differenceCents: 0, differences: { dinheiro: -10000, pix: 10000, credito: 0, debito: 0, outra: 0 } });
    const [recusa] = await db.select().from(auditLog).where(eq(auditLog.action, "caixa_contagem_recusada"));
    expect(recusa.data).toMatchObject({ diferenca: 0, diferencas: { dinheiro: -10000, pix: 10000, credito: 0, debito: 0, outra: 0 }, motivo: "Pix lançado no lugar do dinheiro" });
    const ok = await closeCash({ ...input, approverId: s.gestora.id }, s.caixaRecepcao, NOW);
    expect(ok).toMatchObject({ status: "fechado", differenceCents: 0, differences: { dinheiro: -10000, pix: 10000 } });
    expect((await db.select().from(cashSessions))[0]).toMatchObject({ approvedBy: s.gestora.id, counted: { dinheiro: 14000, pix: 19000 } });
  });

  it("a tolerância vale para cada forma: R$ 4 a menos no dinheiro e R$ 4 a mais no Pix fecham sem a gestão", async () => {
    const a = await openCash({ openingCents: 0 }, s.caixaRecepcao, NOW);
    await recebido([{ session: a.id, method: "dinheiro", valueCents: 1000 }, { session: a.id, method: "pix", valueCents: 1000 }]);
    const r = await closeCash({ cashBreakdown: { "200": 3 }, counted: { ...zeros, pix: 1400 } }, s.caixaRecepcao, NOW);
    expect(r).toMatchObject({ status: "fechado", differenceCents: 0, differences: { dinheiro: -400, pix: 400 } });
  });

  it("contagem cega: quem não é gestão não vê a diferença nem no pedido de aprovação; o fechamento fica marcado", async () => {
    await setSetting("caixa_regras", { contagemCega: true });
    await openCash({ openingCents: 10000 }, s.caixaRecepcao, NOW);
    expect(await closeCash({ cashBreakdown: { "5000": 1 }, counted: zeros }, s.caixaRecepcao, NOW)).toEqual({ status: "precisa_aprovacao", differenceCents: null, differences: null });
    // Recontar depois do pedido de aprovação não dispensa a gestão (revisão final).
    expect(await closeCash({ cashBreakdown: { "10000": 1 }, counted: zeros }, s.caixaRecepcao, NOW)).toEqual({ status: "precisa_aprovacao", differenceCents: null, differences: null });
    expect(await closeCash({ cashBreakdown: { "10000": 1 }, counted: zeros, approverId: s.gestora.id }, s.caixaRecepcao, NOW)).toMatchObject({ status: "fechado", differenceCents: 0 });
    expect((await db.select().from(cashSessions))[0].blind).toBe(true);
  });

  it("a gestão fecha o caixa de outra pessoa; a equipe não", async () => {
    const a = await openCash({ openingCents: 0 }, s.caixaRecepcao, NOW);
    const b = await openCash({ openingCents: 0 }, s.caixaGestao, NOW);
    await expect(closeCash({ sessionId: b.id, cashBreakdown: {}, counted: zeros }, s.caixaRecepcao, NOW)).rejects.toThrow("Só a gestão fecha o caixa de outra pessoa.");
    expect(await closeCash({ sessionId: a.id, cashBreakdown: {}, counted: zeros }, s.caixaGestao, NOW)).toMatchObject({ status: "fechado" });
    expect((await db.select().from(cashSessions).where(eq(cashSessions.id, a.id)))[0]).toMatchObject({ status: "fechado", closedBy: s.gestora.id });
    await expect(closeCash({ cashBreakdown: {}, counted: zeros }, s.caixaRecepcao, NOW)).rejects.toThrow("Seu caixa não está aberto.");
  });

  it("reabrir (gestão): recusa se a dona já abriu outro; fica registrado", async () => {
    const { id } = await openCash({ openingCents: 0 }, s.caixaRecepcao, NOW);
    await closeCash({ cashBreakdown: {}, counted: zeros }, s.caixaRecepcao, NOW);
    await openCash({ openingCents: 0 }, s.caixaRecepcao, NOW);
    await openCash({ openingCents: 0 }, s.caixaGestao, NOW); // o da gestão aberto não atrapalha
    await expect(reopenCash(id, { reason: "contei errado" }, s.caixaGestao, NOW)).rejects.toThrow("Cati já tem um caixa aberto.");
    await closeCash({ cashBreakdown: {}, counted: zeros }, s.caixaRecepcao, NOW);
    // QA r58, I-2: reabrir pede o motivo e ele vai para a auditoria.
    await expect(reopenCash(id, { reason: "  " }, s.caixaGestao, NOW)).rejects.toThrow("Escreva o motivo da reabertura.");
    await reopenCash(id, { reason: "estorno de um Pix lançado em dobro" }, s.caixaGestao, NOW);
    expect((await db.select().from(cashSessions).where(eq(cashSessions.id, id)))[0]).toMatchObject({ status: "aberto", reopenedBy: s.gestora.id });
    const logs = await db.select().from(auditLog).where(eq(auditLog.action, "caixa_reaberto"));
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ userId: s.gestora.id, entityId: id, data: { motivo: "estorno de um Pix lançado em dobro" } });
  });

  it("permissão pelo perfil de quem aprova", async () => {
    expect(await userHasPerm(s.gestora.id, "caixa.gerir")).toBe(true);
    expect(await userHasPerm(s.cati.id, "caixa.gerir")).toBe(false);
    expect(await userHasPerm(s.cati.id, "caixa.operar")).toBe(true);
  });
});

describe("sangria que vira vale (decisão 12)", () => {
  const SENHA = "ana-12345";
  async function anaComApp() {
    const { hashPassword } = await import("../../auth/password");
    const { users, professionals } = await import("../../db/schema");
    const [u] = await db.insert(users).values({ name: "Ana Lima", email: "ana@casa.test", passwordHash: await hashPassword(SENHA), role: "atendente" }).returning();
    await db.update(professionals).set({ userId: u.id }).where(eq(professionals.id, s.ana.id));
    return u;
  }
  const vale = (professionalId: string, password: string) => ({ kind: "sangria" as const, valueCents: 5000, reason: "vale", vale: { professionalId, password } });
  beforeEach(async () => {
    const { resetLimit } = await import("../../auth/rate-limit");
    for (const pid of [s.ana.id, s.bia.id]) resetLimit(`vale-senha:${s.caixaRecepcao.id}:${pid}`);
    await openCash({ openingCents: 20000 }, s.caixaRecepcao, NOW);
    await anaComApp();
  });

  it("senha errada recusa; certa cria o vale ligado à sangria; sem acesso ao app não deixa", async () => {
    const { professionalAdjustments } = await import("../../db/schema");
    await expect(addMovement(vale(s.ana.id, "errada"), s.caixaRecepcao, NOW)).rejects.toThrow("A senha de Ana não confere.");
    expect(await db.select().from(professionalAdjustments)).toHaveLength(0);
    const m = await addMovement(vale(s.ana.id, SENHA), s.caixaRecepcao, NOW);
    const [adj] = await db.select().from(professionalAdjustments);
    expect(adj).toMatchObject({ kind: "vale", valueCents: 5000, professionalId: s.ana.id, cashMovementId: m.id, createdBy: s.cati.id, day: "2026-10-15" });
    expect((await db.select().from(auditLog).where(eq(auditLog.action, "vale_pela_sangria")))).toHaveLength(1);
    await expect(addMovement(vale(s.bia.id, "x"), s.caixaRecepcao, NOW)).rejects.toThrow("Bia ainda não tem acesso ao app. Cadastre em Configurações › Profissionais.");
  });

  it("cancelar a sangria cancela o vale (e o dinheiro volta ao esperado); vale já pago trava", async () => {
    const { professionalAdjustments } = await import("../../db/schema");
    const { cancelMovement } = await import("./cash");
    const m = await addMovement(vale(s.ana.id, SENHA), s.caixaRecepcao, NOW);
    await cancelMovement(m.id, { reason: "Contei errado" }, s.caixaRecepcao, NOW);
    const [adj] = await db.select().from(professionalAdjustments);
    expect(adj.cancelledAt).not.toBeNull();
    expect(adj.cancelReason).toBe("Sangria cancelada: Contei errado");
    const open = await getOpenCashTx(db, s.cati.id);
    expect((await cashSummary(open!.id)).expected.dinheiro).toBe(20000);
  });

  it("vale que já entrou num pagamento trava o cancelamento da sangria", async () => {
    const { professionalAdjustments, commissionPayouts } = await import("../../db/schema");
    const { cancelMovement } = await import("./cash");
    const m = await addMovement(vale(s.ana.id, SENHA), s.caixaRecepcao, NOW);
    const [p] = await db.insert(commissionPayouts).values({ professionalId: s.ana.id, untilDay: "2026-10-31", paidBy: s.gestora.id }).returning();
    await db.update(professionalAdjustments).set({ payoutId: p.id });
    await expect(cancelMovement(m.id, { reason: "x" }, s.caixaRecepcao, NOW)).rejects.toThrow("Desfaça o pagamento em Comissão antes.");
  });

  it("limite de tentativas vem de Configurações: com 2, a 3ª errada é barrada", async () => {
    await setSetting("caixa_recursos", { valeSenhaTentativas: 2 });
    await expect(addMovement(vale(s.ana.id, "a"), s.caixaRecepcao, NOW)).rejects.toThrow("A senha de Ana não confere.");
    await expect(addMovement(vale(s.ana.id, "b"), s.caixaRecepcao, NOW)).rejects.toThrow("A senha de Ana não confere.");
    await expect(addMovement(vale(s.ana.id, "c"), s.caixaRecepcao, NOW)).rejects.toThrow("Muitas tentativas. Espere alguns minutos.");
    await expect(addMovement(vale(s.ana.id, SENHA), s.caixaRecepcao, NOW)).rejects.toThrow("Muitas tentativas. Espere alguns minutos.");
  });

  it("o limite conta só a senha errada: 3 vales certos seguidos passam com limite 2; erro, erro, erro barra na 3ª", async () => {
    await setSetting("caixa_recursos", { valeSenhaTentativas: 2 });
    for (let i = 0; i < 3; i++) await expect(addMovement(vale(s.ana.id, SENHA), s.caixaRecepcao, NOW)).resolves.toBeTruthy();
    await expect(addMovement(vale(s.ana.id, "a"), s.caixaRecepcao, NOW)).rejects.toThrow("não confere");
    await expect(addMovement(vale(s.ana.id, "b"), s.caixaRecepcao, NOW)).rejects.toThrow("não confere");
    await expect(addMovement(vale(s.ana.id, "c"), s.caixaRecepcao, NOW)).rejects.toThrow("Muitas tentativas. Espere alguns minutos.");
  });

  it("o acerto na Bia não zera os erros contra a Ana (limite por operadora e profissional)", async () => {
    const { hashPassword } = await import("../../auth/password");
    const { users, professionals } = await import("../../db/schema");
    const [ub] = await db.insert(users).values({ name: "Bia Santos", email: "bia@casa.test", passwordHash: await hashPassword("bia-12345"), role: "atendente" }).returning();
    await db.update(professionals).set({ userId: ub.id }).where(eq(professionals.id, s.bia.id));
    await setSetting("caixa_recursos", { valeSenhaTentativas: 2 });
    await expect(addMovement(vale(s.ana.id, "a"), s.caixaRecepcao, NOW)).rejects.toThrow("não confere");
    await expect(addMovement(vale(s.ana.id, "b"), s.caixaRecepcao, NOW)).rejects.toThrow("não confere");
    await expect(addMovement(vale(s.bia.id, "bia-12345"), s.caixaRecepcao, NOW)).resolves.toBeTruthy();
    await expect(addMovement(vale(s.ana.id, "c"), s.caixaRecepcao, NOW)).rejects.toThrow("Muitas tentativas. Espere alguns minutos.");
  });

  it("liga/desliga: 'valePelaSangria' desligado recusa a sangria com vale; sem vale segue igual; sem caixa.vale recusa", async () => {
    await setSetting("caixa_recursos", { valePelaSangria: false });
    await expect(addMovement(vale(s.ana.id, SENHA), s.caixaRecepcao, NOW)).rejects.toThrow("Sangria vira vale está desligado em Configurações › Caixa.");
    await expect(addMovement({ kind: "sangria", valueCents: 1000, reason: "banco" }, s.caixaRecepcao, NOW)).resolves.toBeTruthy();
    await setSetting("caixa_recursos", {});
    const semVale = { ...s.caixaRecepcao, perms: s.caixaRecepcao.perms.filter((p) => p !== "caixa.vale") };
    await expect(addMovement(vale(s.ana.id, SENHA), semVale, NOW)).rejects.toThrow("Você não tem permissão para isso.");
  });
});
