import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { aiSuggestions, appointments, contactNotes, contacts, dealEvents, deals, lists, messages, outbox, packageDefs, professionals, professionalServices, settings, tasks, users } from "../db/schema";
import { updateDeal } from "../domain/updates";
import { resetDb } from "../../../test/db";
import { recordInbound, recordOutbound } from "../domain/deals";
import { bookingFromSuggestion, claimSuggestion, fillSuggestion, generateForDeal, markSuggestion, pendingClientTexts, resolveHorario, suggestionState, type Caller } from "./suggest";
import { AI_SETTING, aiSpend, saveAiSettings } from "./settings";
import { AiError } from "./client";
import { vaiVerificar } from "./pos";
import { saveAiManual } from "./manual";
import { emptyManual } from "@/lib/ai-manual";
import { resumeFromSuggestion, RETOMADA_IA_MOTIVO } from "../domain/retomada";

const T0 = new Date("2026-10-20T13:00:00Z"); // terça 10:00 em Salvador
const plus = (s: number) => new Date(T0.getTime() + s * 1000);
const good = { resumo: "Quer saber o preço da escova.", sugestao: "Paula, a escova fica R$ 80. Quer marcar?", precisa_humano: false, motivo: "" };
const usage = { inputTokens: 900, cachedTokens: 3000, cacheWriteTokens: 0, outputTokens: 120 };
let calls: { system: string; user: string }[] = [];
const caller = (data = good): Caller => async (input) => { calls.push(input); return { data, usage, costMicros: 90 + 30 + 60, model: "claude-haiku-5-5" }; };
let dealId = "", sara = "";
const ligar = (extra: Partial<{ monthlyLimitUsd: number; dailyCalls: number }> = {}) => saveAiSettings({ enabled: true, monthlyLimitUsd: 40, dailyCalls: 1500, ...extra }, sara);
const rows = () => db.select().from(aiSuggestions);
const pronta = async (now = plus(200)) => { const s = await suggestionState(dealId, now); return s.state === "pronta" ? s.suggestion : null; };

beforeEach(async () => {
  await resetDb();
  calls = [];
  vi.stubEnv("ANTHROPIC_API_KEY", "sk-teste-falsa");
  vi.stubEnv("AI_MODEL", "");
  vi.stubEnv("AI_BASE_URL", "http://127.0.0.1:9/v1/messages"); // nunca a Anthropic de verdade
  [{ id: sara }] = await db.insert(users).values({ name: "Sara Lima", email: "sara@teste.local", role: "atendente", passwordHash: "x" }).returning();
  await db.update(lists).set({ priceCents: 8000, category: "Cabelo", durationMin: 45 }).where(eq(lists.kind, "service"));
  const r = await recordInbound({ channelId: null, externalId: "A1", phoneRaw: "71999990071", pushName: "PAULA souza", body: "Oi! meu cpf é 123.456.789-09", at: T0, now: T0 });
  if (!("dealId" in r)) throw new Error("sem conversa");
  dealId = r.dealId;
  await recordOutbound({ dealId, channelId: null, body: "*SARA - CASA FIAES:*\nOi, Paula! Tudo bem? Como posso ajudar? 😊", userId: sara, at: plus(30) });
  await recordInbound({ channelId: null, externalId: "A2", phoneRaw: "71999990071", body: "Quanto custa a escova?", at: plus(60), now: plus(60) });
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("assistente (17/10): para a cliente quem atende é a principal", () => {
  it("o próximo horário com o Sidney (assistente de Thaise) vai para a IA como 'com Thaise'", async () => {
    await ligar();
    const [thaise] = await db.insert(professionals).values({ name: "THAISE" }).returning();
    const [sidney] = await db.insert(professionals).values({ name: "SIDNEY", assistantOf: thaise.id }).returning();
    const [d] = await db.select({ contactId: deals.contactId }).from(deals).where(eq(deals.id, dealId));
    await db.insert(appointments).values({ contactId: d.contactId, professionalId: sidney.id, serviceLabel: "Coloração", startsAt: new Date("2026-10-23T12:00:00Z"), durationMin: 60, status: "agendado", origin: "crm", externalKey: "assist-1" });
    await generateForDeal(dealId, { now: plus(120), caller: caller() });
    expect(calls[0].user).toContain("Coloração com THAISE"); // o nome vai como está no cadastro
    expect(calls[0].user).not.toMatch(/sidney/i);
  });
});

describe("gerar sugestão sob demanda (a IA nunca envia nada)", () => {
  it("desligada (o padrão): não reserva, não chama e a tela não mostra nada", async () => {
    expect(await generateForDeal(dealId, { now: plus(120), caller: caller() })).toEqual({ status: "pulada", motivo: "desligada" });
    expect(await suggestionState(dealId)).toEqual({ state: "nada" });
    expect(calls).toHaveLength(0);
  });

  it("ligada: grava a sugestão para a última mensagem da cliente, com tokens e custo; nada vai para a fila de envio", async () => {
    await ligar();
    expect(await suggestionState(dealId, plus(100))).toEqual({ state: "pode_pedir" });
    const outBefore = (await db.select().from(messages).where(eq(messages.direction, "out"))).length;
    const r = await generateForDeal(dealId, { now: plus(120), caller: caller() });
    expect(r.status).toBe("gerada");
    const [s] = await rows();
    const [last] = await db.select().from(messages).where(eq(messages.externalId, "A2"));
    expect(s).toMatchObject({ dealId, lastMessageId: last.id, resumo: good.resumo, sugestao: good.sugestao, precisaHumano: false, motivo: null, model: "claude-haiku-5-5",
      inputTokens: 900, cachedTokens: 3000, outputTokens: 120, costUsdMicros: 180, origin: "auto", usedAt: null, dismissedAt: null });
    expect((await db.select().from(messages).where(eq(messages.direction, "out"))).length).toBe(outBefore);
    expect(await db.select().from(outbox)).toHaveLength(0);
    // O que foi para a IA: bloco fixo com preço; conversa com primeiro nome, exemplo da equipe e sem CPF/telefone/sobrenome.
    expect(calls[0].system).toMatch(/Cabelo: .*R\$ 80,00 \(45 min\)/);
    expect(calls[0].system).toContain("R$ 80,00");
    expect(calls[0].user).toContain("Cliente: Paula.");
    expect(calls[0].user).toContain("- Oi, Paula! Tudo bem? Como posso ajudar? 😊");
    expect(calls[0].user).toContain("Cliente: Quanto custa a escova?");
    expect(calls[0].user).not.toMatch(/123\.456|71999990071|99999-?0071|souza/i);
    expect(await pronta()).toMatchObject({ sugestao: good.sugestao });
  });

  it("o bloco fixo leva o Manual da Casa salvo e a descrição curta dos serviços", async () => {
    await ligar();
    await saveAiManual({ ...emptyManual(), regras: "Tolerância de atraso: 15 minutos." }, sara);
    await db.update(lists).set({ description: "Inclui lavagem." }).where(eq(lists.label, "Corte"));
    expect((await generateForDeal(dealId, { now: plus(120), caller: caller() })).status).toBe("gerada");
    expect(calls[0].system).toContain("Tolerância de atraso: 15 minutos.");
    expect(calls[0].system).toMatch(/Corte R\$ 80,00 \(45 min\): Inclui lavagem\./);
  });
  it("o bloco fixo leva os pacotes ativos (aba Serviços › Pacotes) com preço e sessões; o desativado fica de fora", async () => {
    await ligar();
    const [corte] = await db.select().from(lists).where(eq(lists.label, "Corte"));
    await db.insert(packageDefs).values([
      { name: "Combo 4 Cortes", priceCents: 28_000, validityDays: 90, description: "Um corte por mês.", items: [{ serviceId: corte.id, sessions: 4, unitCents: null }] },
      { name: "Combo antigo", priceCents: 1_000, validityDays: null, items: [{ serviceId: corte.id, sessions: 2, unitCents: null }], active: false },
    ]);
    expect((await generateForDeal(dealId, { now: plus(120), caller: caller() })).status).toBe("gerada");
    expect(calls[0].system).toMatch(/- Combo 4 Cortes: R\$\s280,00 por 4 sessões \(R\$\s70,00 cada\) de Corte; vale 90 dias: Um corte por mês\./);
    expect(calls[0].system).not.toContain("Combo antigo");
  });
  it("uma vez só por mensagem: a 2ª pessoa abrindo reaproveita a guardada; duas ao mesmo tempo reservam uma só", async () => {
    await ligar();
    const [a, b] = await Promise.all([claimSuggestion(dealId, { now: plus(120) }), claimSuggestion(dealId, { now: plus(120) })]);
    expect([a.status, b.status].sort()).toEqual(["pulada", "reservada"]);
    expect(await suggestionState(dealId, plus(121))).toEqual({ state: "escrevendo" });
    const claim = a.status === "reservada" ? a.claim : b.status === "reservada" ? b.claim : null;
    await fillSuggestion(claim!, { caller: caller(), now: plus(122) });
    expect(await generateForDeal(dealId, { now: plus(130), caller: caller() })).toEqual({ status: "pulada", motivo: "ja_tem" });
    expect(calls).toHaveLength(1);
    expect(await rows()).toHaveLength(1);
  });

  it("a Casa respondeu: a sugestão some e o botão continua (gera a continuação); mensagem nova da cliente: pode pedir de novo", async () => {
    await ligar();
    await generateForDeal(dealId, { now: plus(120), caller: caller() });
    await recordOutbound({ dealId, channelId: null, body: "A escova é R$ 80", userId: sara, at: plus(140) });
    expect(await suggestionState(dealId)).toEqual({ state: "pode_pedir" });
    // Ao abrir (automático) nada é gerado com a Casa por último.
    expect(await claimSuggestion(dealId, { requireWaiting: true, now: plus(145) })).toEqual({ status: "pulada", motivo: "ultima_da_casa" });
    calls = [];
    await recordInbound({ channelId: null, externalId: "A3", phoneRaw: "71999990071", body: "E a hidratação?", at: plus(160), now: plus(160) });
    expect(await suggestionState(dealId, plus(170))).toEqual({ state: "pode_pedir" });
    expect((await generateForDeal(dealId, { now: plus(200), caller: caller() })).status).toBe("gerada");
    // O resumo da anterior vai no lugar do histórico longo.
    expect(calls[0].user).toContain("Resumo de uma sugestão anterior (pode estar desatualizado; a conversa abaixo vale mais): Quer saber o preço da escova.");
  });

  it("Equipe pode pedir (a Cati testa pelo número dela); não gasta com Não é cliente, conversa resolvida nem 'Obrigada!' depois da resposta", async () => {
    await ligar();
    const [d] = await db.select().from(deals).where(eq(deals.id, dealId));
    const abrir = () => generateForDeal(dealId, { requireWaiting: true, now: plus(120), caller: caller() });
    await db.update(contacts).set({ isTeam: true }).where(eq(contacts.id, d.contactId));
    expect((await abrir()).status).not.toBe("pulada");
    await db.delete(aiSuggestions).where(eq(aiSuggestions.dealId, dealId));
    calls = [];
    await db.update(contacts).set({ isTeam: false, ignored: true }).where(eq(contacts.id, d.contactId));
    expect(await abrir()).toEqual({ status: "pulada", motivo: "nao_e_cliente" });
    await db.update(contacts).set({ ignored: false }).where(eq(contacts.id, d.contactId));
    await db.update(deals).set({ conversationArchivedAt: plus(100) }).where(eq(deals.id, dealId));
    expect(await abrir()).toEqual({ status: "pulada", motivo: "conversa_fechada" });
    await db.update(deals).set({ conversationArchivedAt: null }).where(eq(deals.id, dealId));
    await recordOutbound({ dealId, channelId: null, body: "R$ 80", userId: sara, at: plus(100) });
    await recordInbound({ channelId: null, externalId: "A4", phoneRaw: "71999990071", body: "Obrigada!", at: plus(110), now: plus(110) });
    expect(await abrir()).toEqual({ status: "pulada", motivo: "nao_espera_resposta" });
    expect(calls).toHaveLength(0);
  });

  it("sem chave da API: não gera nem mostra", async () => {
    await ligar();
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    expect(await generateForDeal(dealId, { now: plus(120), caller: caller() })).toEqual({ status: "pulada", motivo: "sem_chave" });
    expect(await suggestionState(dealId)).toEqual({ state: "nada" });
  });

  it("precisa de alguém: guarda o motivo", async () => {
    await ligar();
    await generateForDeal(dealId, { now: plus(120), caller: caller({ ...good, precisa_humano: true, motivo: "Pediu desconto." }) });
    expect(await pronta()).toMatchObject({ precisaHumano: true, motivo: "Pediu desconto." });
  });

  it("'Outra': gera na hora, manda as anteriores para não repetir, e a nova é a que aparece", async () => {
    await ligar();
    await generateForDeal(dealId, { now: plus(120), caller: caller() });
    const r = await generateForDeal(dealId, { origin: "outra", userId: sara, now: plus(125), caller: caller({ ...good, sugestao: "Paula, escova: R$ 80." }) });
    expect(r.status).toBe("gerada");
    expect(calls[1].user).toContain(`- ${good.sugestao}`);
    expect(await pronta()).toMatchObject({ sugestao: "Paula, escova: R$ 80." });
    expect((await rows()).find((x) => x.origin === "outra")?.requestedBy).toBe(sara);
  });

  it("Usar e fechar (X) marcam e tiram da tela; fechar a nova não traz a antiga de volta", async () => {
    await ligar();
    await generateForDeal(dealId, { now: plus(120), caller: caller() });
    const a = (await pronta())!;
    await markSuggestion(a.id, dealId, "usada", plus(130));
    expect(await suggestionState(dealId)).toEqual({ state: "pode_pedir", again: true }); // o botão continua (gera pelo "Outra")
    expect((await rows())[0].usedAt).toEqual(plus(130));
    await generateForDeal(dealId, { origin: "outra", now: plus(140), caller: caller() });
    const b = (await pronta())!;
    await markSuggestion(b.id, dealId, "fechada", plus(150));
    expect(await suggestionState(dealId)).toEqual({ state: "pode_pedir", again: true });
  });

  it("desligar esconde a sugestão que já existe", async () => {
    await ligar();
    await generateForDeal(dealId, { now: plus(120), caller: caller() });
    await db.update(settings).set({ value: { enabled: false } }).where(eq(settings.key, AI_SETTING));
    expect(await suggestionState(dealId)).toEqual({ state: "nada" });
  });

  it("falha cobrada (fora do formato duas vezes: a 2ª é a nova tentativa do texto ilegível) conta no teto e não repete sozinha (só no clique); falha não cobrada libera para tentar de novo", async () => {
    await ligar();
    const bad: Caller = async () => { throw new AiError("formato", "x", 200, usage); };
    expect((await generateForDeal(dealId, { now: plus(120), caller: bad })).status).toBe("falhou");
    expect(await suggestionState(dealId)).toEqual({ state: "pode_pedir", again: true }); // a atendente pode tentar de novo pelo botão
    expect((await aiSpend(plus(130))).monthMicros).toBe(360); // as duas chamadas
    expect(await claimSuggestion(dealId, { requireWaiting: true, now: plus(130) })).toEqual({ status: "pulada", motivo: "ja_tem" });
    // A atendente tocou de novo: gera outra (e conta no teto).
    expect((await generateForDeal(dealId, { now: plus(130), caller: caller() })).status).toBe("gerada");
    await recordInbound({ channelId: null, externalId: "A5", phoneRaw: "71999990071", body: "Oi?", at: plus(140), now: plus(140) });
    const net: Caller = async () => { throw new AiError("timeout", "x"); };
    expect((await generateForDeal(dealId, { now: plus(200), caller: net })).status).toBe("falhou");
    expect(await rows()).toHaveLength(2);
    expect(await suggestionState(dealId, plus(210))).toEqual({ state: "pode_pedir" });
  });

  it("pediu horário: vai a linha de horários livres da agenda; se a sugestão oferece horário, a tela avisa para conferir", async () => {
    await ligar();
    const [corte] = await db.select().from(lists).where(eq(lists.label, "Corte"));
    const [p] = await db.insert(professionals).values({ name: "THAISE" }).returning();
    await db.insert(professionalServices).values({ professionalId: p.id, serviceId: corte.id });
    // Sem pedir horário: nada de agenda no prompt. (Agora: terça 10:03; hoje só a partir de agora.)
    await generateForDeal(dealId, { now: plus(120), caller: caller() });
    expect(calls[0].user).not.toContain("Horários livres");
    await recordInbound({ channelId: null, externalId: "A3", phoneRaw: "71999990071", body: "Tem horário amanhã pra corte?", at: plus(180), now: plus(180) });
    await generateForDeal(dealId, { now: plus(200), caller: caller({ ...good, sugestao: "Tenho amanhã às 8h ou 12h com a Thaise, qual prefere? Posso verificar e confirmar pra você 😊" }) });
    // Pediu "amanhã": só as opções de amanhã (qua 21/10), mais delas.
    expect(calls[1].user).toMatch(/^Horários livres \(Corte, 45 min\) para qua 21\/10: qua 21\/10 Thaise 8h \(h1\), 9h \(h2\), /m);
    expect(calls[1].system).toContain("## Horários");
    const s = await pronta(plus(210));
    expect(s?.agendaAt).toEqual(plus(200));
    expect(s?.motivo).toBeNull();
    // "Vou verificar" com horários na mão (ia-horarios2): o servidor troca pela proposta do primeiro horário compatível, com o aviso.
    await generateForDeal(dealId, { origin: "outra", now: plus(220), caller: caller({ ...good, sugestao: "Vou verificar a agenda e já te falo!" }) });
    expect(await pronta(plus(230))).toMatchObject({ agendaAt: plus(220), sugestao: "Tenho quarta, 21/10, às 8h com nossa Diretora Técnica, Thaise Fiaes. Posso reservar pra você?", horario: { id: "h1" } });
  });

  it("a Casa respondeu 'vou conferir' sem horário: a pergunta da cliente ainda pede a agenda; resposta com horário encerra", () => {
    const at = new Date();
    const m = (direction: "in" | "out", body: string) => ({ direction, kind: "text", body, transcript: null, at });
    expect(pendingClientTexts([m("in", "Quais horários livres na terça à tarde?"), m("out", "*SARA - CASA FIAES:*\nVou conferir e já te retorno!")]))
      .toEqual(["Quais horários livres na terça à tarde?"]);
    expect(pendingClientTexts([m("in", "tem terça?"), m("out", "Tenho terça às 15h"), m("in", "Obrigada!")])).toEqual(["Obrigada!"]);
  });

  it("pediu horário e a Casa só disse 'vou conferir': a linha de horários vai no pedido", async () => {
    await ligar();
    const [corte] = await db.select().from(lists).where(eq(lists.label, "Corte"));
    const [p] = await db.insert(professionals).values({ name: "MAIARA SOUZA" }).returning();
    await db.insert(professionalServices).values({ professionalId: p.id, serviceId: corte.id });
    await recordInbound({ channelId: null, externalId: "A3", phoneRaw: "71999990071", body: "Quais horários livres na quinta à tarde pra corte?", at: plus(180), now: plus(180) });
    await recordOutbound({ dealId, channelId: null, body: "*SARA - CASA FIAES:*\nVou conferir e já te retorno!", userId: sara, at: plus(190) });
    await recordInbound({ channelId: null, externalId: "A4", phoneRaw: "71999990071", body: "ok", at: plus(200), now: plus(200) });
    await generateForDeal(dealId, { now: plus(210), caller: caller() });
    expect(calls[0].user).toMatch(/^Horários livres \(Corte, 45 min\) para qui 22\/10 à tarde: qui 22\/10 Maiara 12h \(h1\), 13h \(h2\), /m);
    expect(calls[0].user).toContain("Conversa em andamento: não cumprimente");
  });

  describe("a qualquer momento: continuação, tema, mensagem citada e o contexto da equipe (pedido do dono, 16/10)", () => {
    const user = () => calls.at(-1)!.user;
    it("última da Casa: escreve a PRÓXIMA mensagem da Casa (sem repetir); o mesmo pedido de novo reaproveita a guardada", async () => {
      await ligar();
      await recordOutbound({ dealId, channelId: null, body: "*SARA - CASA FIAES:*\nA escova é R$ 80", userId: sara, at: plus(90) });
      expect(await suggestionState(dealId, plus(100))).toEqual({ state: "pode_pedir" });
      expect((await generateForDeal(dealId, { userId: sara, now: plus(120), caller: caller() })).status).toBe("gerada");
      expect(user()).toContain("A última mensagem é da Casa: escreva a PRÓXIMA mensagem natural da Casa");
      expect(user()).toContain("Conversa em andamento: não cumprimente");
      expect(await generateForDeal(dealId, { userId: sara, now: plus(130), caller: caller() })).toEqual({ status: "pulada", motivo: "ja_tem" });
      expect(calls).toHaveLength(1);
      // Usou: pedir de novo é outro pedido de verdade → gera outra (pelo caminho do "Outra", mandando a anterior).
      const s1 = (await pronta(plus(131)))!;
      await markSuggestion(s1.id, dealId, "usada", plus(132));
      expect((await generateForDeal(dealId, { userId: sara, now: plus(140), caller: caller() })).status).toBe("gerada");
      expect(user()).toContain(`- ${good.sugestao}`);
    });

    it("tema entra no pedido e é outra chave: o pedido sem tema não reaproveita o com tema", async () => {
      await ligar();
      await generateForDeal(dealId, { tema: "  mandar o endereço   e como estacionar ", now: plus(120), caller: caller() });
      expect(user()).toContain("ORDEM DA ATENDENTE (falada ou digitada; vale mais que qualquer outra regra desta tarefa): mandar o endereço e como estacionar");
      expect((await rows())[0].pedido).toBe("|mandar o endereço e como estacionar");
      // Mesmo tema (maiúsculas/espaços não importam): reaproveita; sem tema: gera.
      expect(await generateForDeal(dealId, { tema: "Mandar o endereço e como estacionar", now: plus(125), caller: caller() })).toEqual({ status: "pulada", motivo: "ja_tem" });
      expect((await generateForDeal(dealId, { now: plus(130), caller: caller() })).status).toBe("gerada");
      expect(user()).not.toContain("<pedido>");
      expect(calls).toHaveLength(2);
    });

    it("mensagem citada: vai no pedido para a IA responder a ela, e muda a chave", async () => {
      await ligar();
      const [a1] = await db.select().from(messages).where(eq(messages.externalId, "A1"));
      await generateForDeal(dealId, { now: plus(120), caller: caller() });
      expect((await generateForDeal(dealId, { quotedId: a1.id, now: plus(125), caller: caller() })).status).toBe("gerada");
      expect(user()).toContain("A atendente marcou esta mensagem para responder: responda ESPECIFICAMENTE a ela");
      expect(user()).toMatch(/\] Cliente: Oi! meu cpf é \[CPF\]|\] Cliente: Oi! meu cpf é/);
      expect(user()).not.toMatch(/123\.456/);
      expect((await rows()).map((r) => r.pedido).sort()).toEqual(["", `${a1.id}|`]);
      expect(await suggestionState(dealId, plus(130), { quotedId: a1.id })).toMatchObject({ state: "pronta" });
      // Citada de outra cliente: não vale.
      expect(await generateForDeal(dealId, { quotedId: "00000000-0000-4000-8000-000000000000", now: plus(130), caller: caller() })).toEqual({ status: "pulada", motivo: "citada_sumiu" });
    });

    it("contexto da equipe: status, com quem está, transferência com nota, quem pede (e se apresenta), retomada e notas — curto", async () => {
      await ligar();
      const [{ id: cati }] = await db.insert(users).values({ name: "CATIANE ROCHA", email: "cati@teste.local", role: "atendente", passwordHash: "x" }).returning();
      const [d] = await db.select().from(deals).where(eq(deals.id, dealId));
      await updateDeal(dealId, { ownerId: sara }, sara);
      await updateDeal(dealId, { ownerId: cati }, sara);
      // O relógio do teste é T0: a troca de dona e as notas "acontecem" logo antes.
      await db.update(dealEvents).set({ createdAt: plus(100) }).where(eq(dealEvents.dealId, dealId));
      await db.insert(contactNotes).values({ contactId: d.contactId, dealId, authorId: sara, body: "Cati, ela quer escova no sábado; já mandei o preço.", createdAt: plus(101) });
      await db.insert(contactNotes).values({ contactId: d.contactId, dealId, authorId: cati, body: "Cliente prefere de manhã.", createdAt: plus(110) });
      await db.insert(tasks).values({ dealId, contactId: d.contactId, kind: "proxima_acao", title: "Retomar a escova", dueAt: plus(86_400) });
      await generateForDeal(dealId, { userId: cati, now: plus(120), caller: caller() });
      const u = user();
      expect(u).toMatch(/Status: Aberto\. Com: Catiane \(transferida de Sara para Catiane .*: "Cati, ela quer escova no sábado; já mandei o preço\."\)\. Quem vai enviar: Catiane\./);
      expect(u).toMatch(/Retomada pendente .*: Retomar a escova\./);
      expect(u).toContain('Notas internas (a cliente não vê): "Cliente prefere de manhã."');
      expect(u).toContain("Catiane ainda não falou nesta conversa");
      expect(u).toContain("Aqui é Catiane, vou continuar seu atendimento");
      // ~150 tokens a mais no máximo (4 caracteres ≈ 1 token).
      const extra = u.split("\n").filter((l) => /^(Status:|Retomada|Pacote|Notas internas)|ainda não falou/.test(l)).join("\n");
      expect(extra.length / 4).toBeLessThan(150);
    });

    describe("17/10: a Cati retoma conversa em que a Sara escreveu por último ('quero continuar falando… com o contexto da conversa')", () => {
      const sarasLast = async () => {
        await recordOutbound({ dealId, channelId: null, body: "*SARA - CASA FIAES:*\nA escova fica R$ 80. Quer marcar?", userId: sara, at: plus(90) });
      };

      it("última da Casa, sem tema: retomada natural, com a conversa inteira de contexto, sem responder nem comentar a mensagem da Casa", async () => {
        await ligar();
        await sarasLast();
        expect(await suggestionState(dealId, plus(100))).toEqual({ state: "pode_pedir" });
        expect((await generateForDeal(dealId, { userId: sara, now: plus(120), caller: caller() })).status).toBe("gerada");
        const u = user();
        expect(u).toContain("A última mensagem é da Casa: escreva a PRÓXIMA mensagem natural da Casa");
        expect(u).toContain("não responda a ela, não a comente nem agradeça");
        // O histórico vai junto: a pergunta da cliente e a resposta da Sara.
        expect(u).toMatch(/Cliente: Quanto custa a escova\?[\s\S]*Casa: .*A escova fica R\$ 80/);
      });

      it("última da Casa, com tema (o que a Cati falou): escreve A PARTIR do pedido; a conversa é só contexto; ditado longo não é cortado", async () => {
        await ligar();
        await sarasLast();
        const falado = "diz pra ela que a gente abriu um horário sábado de manhã com a Thaise e que se ela quiser eu já seguro pra ela, ".repeat(4).trim();
        expect((await generateForDeal(dealId, { tema: falado, userId: sara, now: plus(120), caller: caller() })).status).toBe("gerada");
        const u = user();
        expect(u).toContain(`ORDEM DA ATENDENTE (falada ou digitada; vale mais que qualquer outra regra desta tarefa): ${falado}`);
        expect(u).toContain("Escreva EXATAMENTE a mensagem que ela pediu");
        expect(u).toContain("Não ofereça horário");
        expect(u).toContain("A conversa acima é só contexto: não responda à última mensagem");
        expect(u).not.toContain("escreva a PRÓXIMA mensagem natural da Casa");
      });

      it("conversa Resolvida e atendimento encerrado: o 'Sugerir resposta' continua valendo; só o automático (ao abrir) não gasta", async () => {
        await ligar();
        await sarasLast();
        await db.update(deals).set({ conversationArchivedAt: plus(95), closedAt: plus(95), awaitingReplySince: null }).where(eq(deals.id, dealId));
        expect(await suggestionState(dealId, plus(100))).toEqual({ state: "pode_pedir" });
        expect(await claimSuggestion(dealId, { requireWaiting: true, now: plus(110) })).toEqual({ status: "pulada", motivo: "conversa_fechada" });
        expect((await generateForDeal(dealId, { userId: sara, now: plus(120), caller: caller() })).status).toBe("gerada");
        expect(await suggestionState(dealId, plus(130))).toMatchObject({ state: "pronta" });
      });

      it("sugestão anterior usada ou fechada: o botão volta ('pode_pedir' de novo) e gera outra", async () => {
        await ligar();
        await sarasLast();
        await generateForDeal(dealId, { userId: sara, now: plus(120), caller: caller() });
        await markSuggestion((await pronta(plus(121)))!.id, dealId, "usada", plus(122));
        expect(await suggestionState(dealId, plus(123))).toEqual({ state: "pode_pedir", again: true });
        expect((await generateForDeal(dealId, { userId: sara, now: plus(130), caller: caller() })).status).toBe("gerada");
        await markSuggestion((await pronta(plus(131)))!.id, dealId, "fechada", plus(132));
        expect(await suggestionState(dealId, plus(133))).toEqual({ state: "pode_pedir", again: true });
        expect((await generateForDeal(dealId, { tema: "mandar o endereço", userId: sara, now: plus(140), caller: caller() })).status).toBe("gerada");
        expect(calls).toHaveLength(3);
      });
    });

    it("teto respeitado também com tema e citada (e com a Casa por último)", async () => {
      await ligar({ dailyCalls: 10 });
      await recordOutbound({ dealId, channelId: null, body: "R$ 80", userId: sara, at: plus(90) });
      const msg = (await db.select().from(messages).limit(1))[0].id;
      await db.insert(aiSuggestions).values(Array.from({ length: 9 }, () => ({ dealId, lastMessageId: msg, resumo: "", sugestao: "", model: "m", origin: "outra" as const, costUsdMicros: 1, createdAt: plus(-60) })));
      expect((await generateForDeal(dealId, { tema: "endereço", now: plus(120), caller: caller() })).status).toBe("gerada");
      expect(await generateForDeal(dealId, { tema: "como estacionar", now: plus(130), caller: caller() })).toEqual({ status: "pulada", motivo: "teto_dia" });
      expect(calls).toHaveLength(1);
    });
  });

  it("reserva abandonada (processo caiu) depois de 2 min pode ser refeita", async () => {
    await ligar();
    const c = await claimSuggestion(dealId, { now: plus(120) });
    expect(c.status).toBe("reservada");
    expect(await suggestionState(dealId, plus(150))).toEqual({ state: "escrevendo" });
    expect(await suggestionState(dealId, plus(260))).toEqual({ state: "pode_pedir" });
    expect((await generateForDeal(dealId, { now: plus(260), caller: caller() })).status).toBe("gerada");
    expect(await rows()).toHaveLength(1);
  });
});

describe("coerência (20/10): o histórico que vai para a IA", () => {
  it("conversa longa: as 30 últimas em ordem e o resto resumido em \"Antes das mensagens abaixo\" (sem chamar a IA de novo)", async () => {
    await ligar();
    await recordOutbound({ dealId, channelId: null, body: "*CATI - CASA FIAES:*\nSegue uma estimativa do investimento: entre R$ 16.000,00 e R$ 24.000,00.", userId: sara, at: plus(90) });
    for (let i = 0; i < 32; i++) await recordInbound({ channelId: null, externalId: `L${i}`, phoneRaw: "71999990071", body: `fala ${i}`, at: plus(100 + i), now: plus(100 + i) });
    await generateForDeal(dealId, { now: plus(200), caller: caller() });
    const u = calls[0].user;
    expect(u).toMatch(/Antes das mensagens abaixo \(resumo automático, para contexto\): 6 mensagens de 20\/10 a 20\/10: ela começou com "Oi! meu cpf é \[CPF\]"/);
    expect(u).toContain('a Casa já mandou: valor ("Segue uma estimativa do investimento: entre R$ 16.000,00 e R$ 24.000,00.")');
    expect(u).not.toContain("Cliente: fala 1\n");
    expect(u.indexOf("Cliente: fala 2\n")).toBeLessThan(u.indexOf("Cliente: fala 31\n"));
  });
  it("lembrete automático hoje e a equipe falou ontem: a cliente que responde ao lembrete pode ser cumprimentada", async () => {
    await ligar();
    await recordOutbound({ dealId, channelId: null, body: "Olá! Passando para lembrar nosso encontro hoje às 15h!", at: new Date(T0.getTime() + 86_400_000) });
    await recordInbound({ channelId: null, externalId: "R1", phoneRaw: "71999990071", body: "Olá bom dia, eu adoeci, vou precisar remarcar", at: new Date(T0.getTime() + 86_400_000 + 3_600_000), now: new Date(T0.getTime() + 86_400_000 + 3_600_000) });
    await generateForDeal(dealId, { now: new Date(T0.getTime() + 86_400_000 + 3_700_000), caller: caller({ ...good, sugestao: "Oi, Paula! Sinto muito, melhoras! Qual dia fica melhor para você?" }) });
    expect(calls[0].user).toMatch(/A Casa falou por último .*: pode cumprimentar de leve\./);
    expect(calls[0].user).toContain("Casa (mensagem automática): Olá! Passando para lembrar");
    expect(await pronta(new Date(T0.getTime() + 86_400_000 + 3_800_000))).toMatchObject({ sugestao: "Oi, Paula! Sinto muito, melhoras! Qual dia fica melhor para você?" });
  });
});

describe("teto de gasto", () => {
  it("passou do limite do mês: para de gerar (inclusive o 'Outra')", async () => {
    await ligar({ monthlyLimitUsd: 1 });
    await db.insert(aiSuggestions).values({ dealId, lastMessageId: (await db.select().from(messages).limit(1))[0].id, resumo: "", sugestao: "", model: "m", costUsdMicros: 1_000_000, createdAt: plus(-3600), dismissedAt: plus(-3600) });
    expect(await generateForDeal(dealId, { now: plus(120), caller: caller() })).toEqual({ status: "pulada", motivo: "teto_mes" });
    expect(await generateForDeal(dealId, { origin: "outra", now: plus(120), caller: caller() })).toEqual({ status: "pulada", motivo: "teto_mes" });
    expect(calls).toHaveLength(0);
  });

  it("gasto do mês passado não conta; chamadas do dia têm teto próprio", async () => {
    await ligar({ dailyCalls: 10 });
    const msg = (await db.select().from(messages).limit(1))[0].id;
    await db.insert(aiSuggestions).values({ dealId, lastMessageId: msg, resumo: "", sugestao: "", model: "m", origin: "outra", costUsdMicros: 50_000_000, createdAt: new Date("2026-09-30T12:00:00Z") });
    expect((await aiSpend(plus(120))).monthMicros).toBe(0);
    await db.insert(aiSuggestions).values(Array.from({ length: 10 }, () => ({ dealId, lastMessageId: msg, resumo: "", sugestao: "", model: "m", origin: "outra" as const, costUsdMicros: 1, createdAt: plus(-60) })));
    expect(await aiSpend(plus(120))).toMatchObject({ todayCalls: 10, monthCalls: 10 });
    expect(await generateForDeal(dealId, { now: plus(120), caller: caller() })).toEqual({ status: "pulada", motivo: "teto_dia" });
  });
});

describe("IA marca (17/10): horário concreto com id, concordância da cliente e o Marcar este horário (nada é enviado nem marcado sozinho)", () => {
  let thaise = "", corteId = "";
  const user = () => calls.at(-1)!.user;
  /** A IA falsa: propõe a opção `id` da linha (lê a hora na linha que recebeu) ou responde o texto dado. */
  const propoe = (id: string, extra: Partial<typeof good> & { horario?: string } = {}): Caller => async (input) => {
    calls.push(input);
    const h = new RegExp(`(\\d{1,2}h\\d{0,2}) \\(${id}\\)`).exec(input.user)?.[1] ?? "??";
    return { data: { ...good, sugestao: `Tenho amanhã, quarta, 21/10, às ${h} com a Thaise. Posso reservar pra você?`, horario: id, ...extra }, usage, costMicros: 180, model: "claude-haiku-5-5" };
  };
  const responde = (sugestao: string, horario = ""): Caller => async (input) => { calls.push(input); return { data: { ...good, sugestao, horario }, usage, costMicros: 180, model: "claude-haiku-5-5" }; };
  beforeEach(async () => {
    await ligar();
    [{ id: corteId }] = await db.select().from(lists).where(eq(lists.label, "Corte"));
    [{ id: thaise }] = await db.insert(professionals).values({ name: "THAISE" }).returning();
    await db.insert(professionalServices).values({ professionalId: thaise, serviceId: corteId });
    await recordInbound({ channelId: null, externalId: "A3", phoneRaw: "71999990071", body: "Tem horário amanhã pra corte?", at: plus(180), now: plus(180) });
  });

  it("a IA devolve o id (h2): o servidor guarda dia, hora, profissional, serviço e duração; nada vai para a fila de envio", async () => {
    expect((await generateForDeal(dealId, { now: plus(200), caller: propoe("h2") })).status).toBe("gerada");
    expect(user()).toContain("Agora: terça, 20/10/2026, 10:03 (Salvador).");
    expect(user()).toMatch(/\[ter\.?, 20\/10, 10:03\] Cliente: Tem horário amanhã pra corte\?/); // mensagens com data
    expect(user()).toMatch(/qua 21\/10 Thaise 8h \(h1\), 9h \(h2\)/);
    const s = await pronta(plus(210));
    expect(s?.horario).toEqual({ id: "h2", day: "2026-10-21", time: "09:00", professionalId: thaise, professionalName: "THAISE", serviceId: corteId, serviceLabel: "Corte", durationMin: 45, origem: "lista" });
    expect(await db.select().from(outbox)).toHaveLength(0);
    expect(await db.select().from(appointments)).toHaveLength(0);
  });

  it("id que não existe ou que não bate com o texto: sem horário; sem id, a hora citada no texto acha a opção", async () => {
    await generateForDeal(dealId, { now: plus(200), caller: responde("Tenho amanhã às 23h, pode ser?", "h9") });
    // ia-horarios2: 23h não é da lista nem foi pedida (hora inventada) → a frase sai e entra a proposta da lista, com o horário dela.
    expect(await pronta(plus(210))).toMatchObject({ sugestao: "Tenho quarta, 21/10, às 8h com nossa Diretora Técnica, Thaise Fiaes. Posso reservar pra você?", horario: { id: "h1" } });
    await generateForDeal(dealId, { origin: "outra", now: plus(220), caller: responde("Tenho quarta, 21/10, às 9h com a Thaise. Posso reservar?") });
    expect((await pronta(plus(230)))?.horario).toMatchObject({ id: "h2", time: "09:00" });
    // Puro: o id certo com o texto falando de outra hora não vale; a hora do texto decide.
    const opts = [{ id: "h1", day: "2026-10-21", time: "08:00", professionalId: "p", professionalName: "Thaise", serviceId: null, serviceLabel: null, durationMin: 60, origem: "lista" as const },
      { id: "h2", day: "2026-10-21", time: "09:00", professionalId: "p", professionalName: "Thaise", serviceId: null, serviceLabel: null, durationMin: 60, origem: "lista" as const }];
    expect(resolveHorario("h1", opts, null, "Tenho às 9h", "2026-10-20")?.id).toBe("h2");
    expect(resolveHorario("", opts, null, "Vou ver a agenda", "2026-10-20")).toBeNull();
  });

  it("concordância: a Casa mandou a proposta da sugestão e a cliente disse 'pode ser' → a próxima já vem com o horário e a confirmação no padrão da Casa", async () => {
    await generateForDeal(dealId, { now: plus(200), caller: propoe("h2") });
    const s = (await pronta(plus(210)))!;
    await markSuggestion(s.id, dealId, "usada", plus(215));
    await recordOutbound({ dealId, channelId: null, body: `*SARA - CASA FIAES:*\n${s.sugestao}`, userId: sara, at: plus(240) });
    await recordInbound({ channelId: null, externalId: "A4", phoneRaw: "71999990071", body: "Pode ser!", at: plus(300), now: plus(300) });
    // Mesmo que a IA devolva horario vazio, o combinado vem.
    await generateForDeal(dealId, { now: plus(320), caller: responde("Confirmado agendamento de Corte dia 21/10 às 09:00h com Thaise. Te esperamos! 💛") });
    expect(user()).toContain(`Horário combinado (hc): qua 21/10 às 9h com Thaise (Corte). A cliente aceitou: confirme com o texto entre <confirmacao> e </confirmacao>, do jeito que está (com as quebras de linha e o negrito de data e hora); pode pôr 1 frase curta e calorosa antes.\n<confirmacao>\n${["Confirmado agendamento de Corte com Thaise 💛", "", "📅 *quarta-feira, 21/10*", "⏰ às *9h*", "", "Temos tolerância de 15 minutos. Será uma alegria te receber na Casa Fiaes!"].join("\n")}\n</confirmacao>`);
    expect((await pronta(plus(330)))?.horario).toEqual({ ...s.horario!, id: "hc", origem: "combinado" });
    const b = await bookingFromSuggestion((await pronta(plus(330)))!.id, dealId, plus(330));
    // A própria sugestão já é a confirmação: é ela que vai para a caixa depois de marcar.
    expect(b).toMatchObject({ livre: true, confirm: "Confirmado agendamento de Corte dia 21/10 às 09:00h com Thaise. Te esperamos! 💛" });
    expect(await db.select().from(appointments)).toHaveLength(0);
  });

  it("concordância com o horário que a Casa digitou (sem sugestão): lê dia, hora e profissional; 'a das 15h' escolhe entre dois; 'pode ser' a dois é ambíguo", async () => {
    await recordOutbound({ dealId, channelId: null, body: "*SARA - CASA FIAES:*\nTenho quinta, 22/10, às 14h com a Thaise ou às 15h com a Thaise. Qual prefere?", userId: sara, at: plus(240) });
    await recordInbound({ channelId: null, externalId: "A4", phoneRaw: "71999990071", body: "pode ser", at: plus(300), now: plus(300) });
    await generateForDeal(dealId, { now: plus(320), caller: responde("Qual fica melhor, 14h ou 15h?") });
    expect(user()).toContain("A cliente concordou, mas a Casa ofereceu mais de um horário (14h; 15h): pergunte, curtinho, qual ela prefere");
    expect((await pronta(plus(330)))?.horario).toBeNull();
    await recordInbound({ channelId: null, externalId: "A5", phoneRaw: "71999990071", body: "a das 15h", at: plus(340), now: plus(340) });
    await generateForDeal(dealId, { now: plus(350), caller: responde("Confirmado agendamento de Corte dia 22/10 às 15:00h com Thaise.", "hc") });
    expect((await pronta(plus(360)))?.horario).toEqual({ id: "hc", day: "2026-10-22", time: "15:00", professionalId: thaise, professionalName: "THAISE", serviceId: corteId, serviceLabel: "Corte", durationMin: 45, origem: "combinado" });
  });

  it("coerência (20/10): \"Fica sim\" depois da oferta, com a mensagem automática de fora do horário no meio, é concordância com a oferta", async () => {
    await recordOutbound({ dealId, channelId: null, body: "*SARA - CASA FIAES:*\nQuinta, 22/10, às 10h com a Thaise, fica bom para você? 🤗", userId: sara, at: plus(240) });
    // Automática: sem ninguém da equipe (nem pelo CRM nem pelo celular).
    await recordOutbound({ dealId, channelId: null, body: "Agradecemos o contato! Estamos fora do horário de atendimento.", at: plus(250) });
    await recordInbound({ channelId: null, externalId: "A4", phoneRaw: "71999990071", body: "Fica sim", at: plus(300), now: plus(300) });
    await generateForDeal(dealId, { now: plus(320), caller: responde("Confirmado agendamento de Corte dia 22/10 às 10:00h com Thaise.", "hc") });
    expect(user()).toContain("Horário combinado (hc): qui 22/10 às 10h com Thaise (Corte).");
    expect(user()).toContain("Casa (mensagem automática): Agradecemos o contato!");
    expect((await pronta(plus(330)))?.horario).toMatchObject({ id: "hc", day: "2026-10-22", time: "10:00" });
  });

  it("coerência (20/10): ela cita (responde a) uma oferta antiga com horário: o combinado é o da mensagem citada", async () => {
    await recordOutbound({ dealId, channelId: null, body: "*SARA - CASA FIAES:*\nQuinta, 22/10, às 14h com a Thaise, fica bom?", userId: sara, at: plus(240) });
    await recordOutbound({ dealId, channelId: null, body: "*SARA - CASA FIAES:*\nQualquer dúvida estou por aqui.", userId: sara, at: plus(250) });
    await recordInbound({ channelId: null, externalId: "A4", phoneRaw: "71999990071", body: "Pode ser", at: plus(300), now: plus(300) });
    await db.update(messages).set({ quotedBody: "*SARA - CASA FIAES:*\nQuinta, 22/10, às 14h com a Thaise, fica bom?" }).where(eq(messages.externalId, "A4"));
    await generateForDeal(dealId, { now: plus(320), caller: responde("Confirmado agendamento de Corte dia 22/10 às 14:00h com Thaise.", "hc") });
    expect(user()).toContain('Cliente: (respondendo a: "Quinta, 22/10, às 14h com a Thaise, fica bom?") Pode ser');
    expect(user()).toContain("Horário combinado (hc): qui 22/10 às 14h com Thaise (Corte).");
  });

  it("coerência (20/10): recusa (\"não deixe esse horário reservado\") não ganha proposta de horário no fim", async () => {
    await recordInbound({ channelId: null, externalId: "A4", phoneRaw: "71999990071", body: "Vou dar mais um tempo. Não deixe esse horário reservado, vou pensar.", at: plus(190), now: plus(190) });
    const texto = "Entendo perfeitamente, Paula 💛 Vou liberar o horário. Quando decidir, é só chamar por aqui.";
    await generateForDeal(dealId, { now: plus(200), caller: responde(texto) });
    expect(await pronta(plus(210))).toMatchObject({ sugestao: texto, horario: null });
  });

  it("o horário combinado não está mais livre: a IA é avisada e recebe outros horários livres (sem horário proposto do combinado)", async () => {
    await recordOutbound({ dealId, channelId: null, body: "*SARA - CASA FIAES:*\nTenho quinta, 22/10, às 14h com a Thaise. Posso reservar?", userId: sara, at: plus(240) });
    await recordInbound({ channelId: null, externalId: "A4", phoneRaw: "71999990071", body: "Sim", at: plus(300), now: plus(300) });
    await db.insert(appointments).values({ professionalId: thaise, clientName: "Outra", serviceLabel: "Corte", startsAt: new Date("2026-10-22T14:00:00-03:00"), durationMin: 60, status: "agendado", origin: "crm", externalKey: "ocupa" });
    await generateForDeal(dealId, { now: plus(320), caller: responde("Poxa, esse horário acabou de ser preenchido. Tenho quinta às 16h com a Thaise, pode ser?") });
    expect(user()).toContain("O horário que a Casa ofereceu (qui 22/10 às 14h com Thaise (Corte)) NÃO está livre na agenda (ocupado ou fora do horário)");
    expect(user()).toMatch(/^Horários livres \(Corte, 45 min\)/m);
    expect((await pronta(plus(330)))?.horario?.origem ?? "lista").toBe("lista");
  });

  it("concordância com o horário que ELA já tem marcado: 'já está marcado' (nunca 'não está livre'), sem botão de marcar de novo", async () => {
    const [d] = await db.select({ contactId: deals.contactId }).from(deals).where(eq(deals.id, dealId));
    await db.insert(appointments).values({ contactId: d.contactId, professionalId: thaise, serviceLabel: "Corte", startsAt: new Date("2026-10-22T14:00:00-03:00"), durationMin: 45, status: "agendado", origin: "crm", externalKey: "dela" });
    await recordOutbound({ dealId, channelId: null, body: "*SARA - CASA FIAES:*\nSeu horário é quinta, 22/10, às 14h com a Thaise.", userId: sara, at: plus(240) });
    await recordInbound({ channelId: null, externalId: "A4", phoneRaw: "71999990071", body: "Obrigada", at: plus(290), now: plus(290) });
    await recordInbound({ channelId: null, externalId: "A5", phoneRaw: "71999990071", body: "Correto", at: plus(300), now: plus(300) });
    await generateForDeal(dealId, { now: plus(320), caller: responde("Isso mesmo! Te esperamos quinta às 14h 💛", "hc") });
    expect(user()).toContain("O horário qui 22/10 às 14h com Thaise (Corte) já está marcado na agenda para ela");
    expect(user()).not.toContain("NÃO está livre");
    expect((await pronta(plus(330)))?.horario).toBeNull();
  });

  it("regra do Método vale também para o que a Casa digitou: avaliação do Método oferecida com outra profissional não vira horário para marcar", async () => {
    const [aval] = await db.insert(lists).values({ kind: "service", label: "AVALIAÇÃO", durationMin: 60, position: 70 }).returning();
    const [jack] = await db.insert(professionals).values({ name: "JACKSON" }).returning();
    await db.insert(professionalServices).values([{ professionalId: thaise, serviceId: aval.id }, { professionalId: jack.id, serviceId: aval.id }]);
    await db.update(lists).set({ aiProIds: [thaise], aiProScope: "metodo" }).where(eq(lists.id, aval.id));
    await recordInbound({ channelId: null, externalId: "A4", phoneRaw: "71999990071", body: "Na verdade quero a avaliação do Método Fiaes", at: plus(200), now: plus(200) });
    await recordOutbound({ dealId, channelId: null, body: "*SARA - CASA FIAES:*\nTenho quinta, 22/10, às 14h com o Jackson. Posso reservar?", userId: sara, at: plus(240) });
    await recordInbound({ channelId: null, externalId: "A5", phoneRaw: "71999990071", body: "pode ser", at: plus(300), now: plus(300) });
    await generateForDeal(dealId, { now: plus(320), caller: responde("Para a avaliação do Método, quem atende é a Thaise. Tenho quinta às 15h com ela, pode ser?") });
    expect(user()).toContain("não segue a regra da Casa: esse serviço é só com Thaise. Não confirme");
    expect(user()).toMatch(/^Horários livres \(Avaliação, 1 h; só com Thaise\)[^\n]*Thaise/m);
    expect(user()).not.toMatch(/^Horários livres[^\n]*Jackson/m);
    expect((await pronta(plus(330)))?.horario?.professionalId ?? thaise).toBe(thaise);
  });

  it("Marcar este horário: confere de novo; ocupado depois de sugerir → livre=false; sugestão de outra conversa → nada", async () => {
    await generateForDeal(dealId, { now: plus(200), caller: propoe("h2") });
    const s = (await pronta(plus(210)))!;
    expect(await bookingFromSuggestion(s.id, dealId, plus(220))).toEqual({ slot: s.horario, livre: true, confirm: ["Confirmado agendamento de Corte com Thaise 💛", "", "📅 *quarta-feira, 21/10*", "⏰ às *9h*", "", "Temos tolerância de 15 minutos. Será uma alegria te receber na Casa Fiaes!"].join("\n") });
    await db.insert(appointments).values({ professionalId: thaise, clientName: "Outra", serviceLabel: "Corte", startsAt: new Date("2026-10-21T09:00:00-03:00"), durationMin: 60, status: "agendado", origin: "crm", externalKey: "ocupa2" });
    expect((await bookingFromSuggestion(s.id, dealId, plus(230)))?.livre).toBe(false);
    const r = await recordInbound({ channelId: null, externalId: "B1", phoneRaw: "71999990099", body: "Oi", at: plus(240), now: plus(240) });
    expect(await bookingFromSuggestion(s.id, (r as { dealId: string }).dealId, plus(250))).toBeNull();
  });
});

describe("pós-processamento e texto embaralhado (src/server/ai/pos.ts)", () => {
  const seq = (...sugs: string[]): Caller => async (input) => {
    calls.push(input);
    const sugestao = sugs[Math.min(calls.length - 1, sugs.length - 1)];
    return { data: { ...good, sugestao }, usage, costMicros: 180, model: "claude-haiku-5-5" };
  };
  it("grava o texto já corrigido: Thaise sem artigo, Método Fiaes®, sem promessa de retorno, uma pergunta só", async () => {
    await ligar();
    await generateForDeal(dealId, { now: plus(120), caller: seq("Vou ver a agenda da Thaise e já te retorno com as opções. Conhece o Método Fiaes? Prefere manhã ou tarde?") });
    expect((await rows())[0].sugestao).toBe("Vou ver a agenda de Thaise. Prefere manhã ou tarde?");
    expect(calls).toHaveLength(1);
  });
  it("embaralhado: pede de novo UMA vez e grava a segunda (custo das duas no teto)", async () => {
    await ligar();
    const r = await generateForDeal(dealId, { now: plus(120), caller: seq("xkcd brrr pfft grrr mrrr tsss", "Oi, Paula! A escova fica R$ 80,00. Quer marcar?") });
    expect(r.status).toBe("gerada");
    expect(calls).toHaveLength(2);
    const [s] = await rows();
    // A Casa já cumprimentou há 1 min: o "Oi, Paula!" de novo sai (pos.ts → semCumprimento).
    expect(s).toMatchObject({ sugestao: "A escova fica R$ 80,00. Quer marcar?", inputTokens: 1800, outputTokens: 240 });
  });
  it("embaralhado duas vezes: falha com erro amigável, a linha fica descartada com o custo", async () => {
    await ligar();
    const r = await generateForDeal(dealId, { now: plus(120), caller: seq('{"sugestao": "Oi') });
    expect(r).toMatchObject({ status: "falhou", erro: expect.stringMatching(/^ilegivel: A IA devolveu um texto embaralhado/) });
    expect(calls).toHaveLength(2);
    const [s] = await rows();
    expect(s).toMatchObject({ sugestao: "", motivo: "falhou: ilegivel", inputTokens: 1800 });
    expect(s.dismissedAt).not.toBeNull();
  });
  it("fora do formato na 1ª: tenta mais uma vez", async () => {
    await ligar();
    let n = 0;
    const r = await generateForDeal(dealId, { now: plus(120), caller: async (input) => {
      calls.push(input);
      if (n++ === 0) throw new AiError("formato", "Resposta fora do formato.", 200, usage);
      return { data: good, usage, costMicros: 180, model: "claude-haiku-5-5" };
    } });
    expect(r.status).toBe("gerada");
    expect(calls).toHaveLength(2);
    expect((await rows())[0]).toMatchObject({ sugestao: good.sugestao, inputTokens: 1800 });
  });
});

describe("IA v3.1: robô de empresa e nomes da equipe", () => {
  it("robô/propaganda: não chama a IA, pede alguém da equipe com o motivo e não oferece serviço", async () => {
    await ligar();
    await recordInbound({ channelId: null, externalId: "R1", phoneRaw: "71999990071", body: "Aguarde um momento... Vou buscar suas faturas em aberto.", at: plus(90), now: plus(90) });
    await recordInbound({ channelId: null, externalId: "R2", phoneRaw: "71999990071", body: "Pague o boleto com a linha digitável. Protocolo 123. A Claro agradece!", at: plus(95), now: plus(95) });
    const before = calls.length;
    const r = await generateForDeal(dealId, { now: plus(120), caller: caller() });
    expect(r.status).toBe("gerada");
    expect(calls.length).toBe(before);
    expect(await pronta()).toMatchObject({ precisaHumano: true, motivo: "parece mensagem automática de empresa", sugestao: "Recebido, obrigada!" });
    expect((await rows())[0].costUsdMicros).toBe(0);
  });
  it("tira o artigo antes de profissional ativa e de alguém da equipe", async () => {
    await ligar();
    await db.insert(professionals).values({ name: "MAIARA" });
    await generateForDeal(dealId, { now: plus(120), caller: caller({ ...good, sugestao: "Tenho terça às 9h com a Maiara, ou fale com a Sara. Posso reservar?" }) });
    expect((await rows())[0].sugestao).toBe("Tenho terça às 9h com Maiara, ou fale com Sara. Posso reservar?");
  });
});

describe("garantia do servidor (ia-horarios2, 17/10): pediu horário e há horário livre → a sugestão tem horário concreto e o botão", () => {
  let thaise = "", corteId = "";
  const responde = (sugestao: string, extra: Partial<typeof good> & { horario?: string } = {}): Caller => async (input) => {
    calls.push(input); return { data: { ...good, sugestao, horario: "", ...extra }, usage, costMicros: 180, model: "claude-haiku-5-5" };
  };
  beforeEach(async () => {
    await ligar();
    [{ id: corteId }] = await db.select().from(lists).where(eq(lists.label, "Corte"));
    [{ id: thaise }] = await db.insert(professionals).values({ name: "THAISE FIAES" }).returning();
    await db.insert(professionalServices).values({ professionalId: thaise, serviceId: corteId });
  });
  const pede = (body: string, ext = "G1", at = plus(180)) => recordInbound({ channelId: null, externalId: ext, phoneRaw: "71999990071", body, at, now: at });

  it.each([
    ["P1", "Sobre o corte: amanhã ainda não tenho um horário confirmado na agenda, então vou verificar e te aviso. Você tem preferência de horário?"],
    ["P2", "Entendi, imagina! Vou verificar a agenda das 12h de amanhã com a equipe. Você está vindo para a Casa?"],
    ["P3", "Entendo! Vou verificar com Thaise se consigo deixar tudo no mesmo dia para você, tudo bem?"],
  ])("%s: o 'vou verificar' vira a proposta do primeiro horário compatível, com o horário gravado (nada enviado nem marcado)", async (_p, texto) => {
    await pede("Tem horário amanhã pra corte?");
    await generateForDeal(dealId, { now: plus(200), caller: responde(texto, { precisa_humano: true, motivo: "remarcação" }) });
    const s = (await pronta(plus(210)))!;
    expect(vaiVerificar(s.sugestao)).toBe(false);
    expect(s.sugestao).toMatch(/Tenho quarta, 21\/10, às 8h com nossa Diretora Técnica, Thaise Fiaes\. Posso reservar pra você\?$/);
    expect((s.sugestao.match(/\?/g) ?? []).length).toBe(1);
    expect(s.horario).toMatchObject({ id: "h1", day: "2026-10-21", time: "08:00", professionalId: thaise, origem: "lista" });
    expect(s.agendaAt).toEqual(plus(200));
    expect(s.precisaHumano).toBe(true); // continua pedindo alguém da equipe, agora com horário para conferir
    expect(await bookingFromSuggestion(s.id, dealId, plus(220))).toMatchObject({ livre: true });
    expect(await db.select().from(outbox)).toHaveLength(0);
    expect(await db.select().from(appointments)).toHaveLength(0);
  });

  it("'sábado à tarde': a proposta é de sábado à tarde", async () => {
    await pede("Tem horário sábado à tarde pra corte?");
    await generateForDeal(dealId, { now: plus(200), caller: responde("Vou ver a agenda de sábado pra você!") });
    const s = (await pronta(plus(210)))!;
    expect(calls.at(-1)!.user).toMatch(/^Horários livres \(Corte, 45 min\) para sáb 24\/10 à tarde: /m);
    expect(s.horario?.day).toBe("2026-10-24");
    expect(s.horario!.time >= "12:00").toBe(true);
    expect(s.sugestao).toMatch(/^Tenho sábado, 24\/10, às 1\dh\d{0,2} com nossa Diretora Técnica, Thaise Fiaes\. Posso reservar pra você\?$/);
  });

  it("Método → só Thaise: a cliente pede a avaliação do Método com Jackson, a IA diz 'vou verificar com Jackson' → a proposta é com Thaise", async () => {
    const [aval] = await db.insert(lists).values({ kind: "service", label: "AVALIAÇÃO", durationMin: 60, position: 70 }).returning();
    const [jack] = await db.insert(professionals).values({ name: "JACKSON" }).returning();
    await db.insert(professionalServices).values([{ professionalId: thaise, serviceId: aval.id }, { professionalId: jack.id, serviceId: aval.id }]);
    await db.update(lists).set({ aiProIds: [thaise], aiProScope: "metodo" }).where(eq(lists.id, aval.id));
    await pede("Quero agendar a avaliação do Método Fiaes com Jackson, tem sábado?");
    await generateForDeal(dealId, { now: plus(200), caller: responde("Vou verificar com Jackson a agenda de sábado.") });
    const s = (await pronta(plus(210)))!;
    expect(calls.at(-1)!.user).not.toMatch(/^Horários livres[^\n]*Jackson/m);
    expect(s.sugestao).not.toMatch(/jackson/i);
    expect(s.sugestao).toMatch(/^Tenho sábado, 24\/10, às \d{1,2}h\d{0,2} com nossa Diretora Técnica, Thaise Fiaes\. Posso reservar pra você\?$/);
    expect(s.horario).toMatchObject({ professionalId: thaise, serviceId: aval.id });
  });

  it("assistente nunca aparece: nem na linha, nem na sugestão, nem no horário (a frase que oferece a assistente sai)", async () => {
    const [sidney] = await db.insert(professionals).values({ name: "SIDNEY SANTOS", assistantOf: thaise }).returning();
    await db.insert(professionalServices).values({ professionalId: sidney.id, serviceId: corteId });
    await pede("Tem horário amanhã pra corte com Sidney?");
    await generateForDeal(dealId, { now: plus(200), caller: responde("Tenho amanhã às 9h com Sidney. Posso reservar?") });
    const s = (await pronta(plus(210)))!;
    expect(calls.at(-1)!.user).not.toMatch(/^Horários livres[^\n]*sidney/im); // a mensagem da cliente cita, a linha não
    expect(s.sugestao).not.toMatch(/sidney/i);
    expect(s.horario?.professionalId).toBe(thaise);
  });

  it("cancelamento sem remarcar não ganha proposta; resposta com horário da lista fica como a IA escreveu", async () => {
    await pede("Infelizmente vou precisar desagendar, surgiu um imprevisto");
    const t = "Que pena! Imprevistos acontecem. Quando quiser remarcar, é só me chamar.";
    await generateForDeal(dealId, { now: plus(200), caller: responde(t) });
    expect((await pronta(plus(210)))?.sugestao).toBe(t);
    await pede("Tem horário amanhã pra corte?", "G2", plus(220));
    const p = "Tenho quarta, 21/10, às 9h com Thaise Fiaes. Posso reservar pra você?";
    await generateForDeal(dealId, { now: plus(230), caller: responde(p, { horario: "h2" }) });
    expect(await pronta(plus(240))).toMatchObject({ sugestao: p, horario: { id: "h2", time: "09:00" } });
  });
});

describe("cancelou sem nova data (Cati 17/10): a sugestão propõe quando retomar; só o toque da atendente cria o lembrete", () => {
  const responde = (sugestao: string, retomar_dias = 0): Caller => async (input) => {
    calls.push(input); return { data: { ...good, sugestao, horario: "", retomar_dias, precisa_humano: true, motivo: "cancelamento" }, usage, costMicros: 180, model: "claude-haiku-5-5" };
  };
  const pede = (body: string, ext = "C1", at = plus(180)) => recordInbound({ channelId: null, externalId: ext, phoneRaw: "71999990071", body, at, now: at });
  const lembretes = () => db.select().from(tasks).where(eq(tasks.kind, "proxima_acao"));
  const texto = "Que pena, Paula! Imprevistos acontecem. Quando quiser remarcar, é só me chamar. 💛";
  beforeEach(async () => { await ligar(); });

  it("a IA diz 15 dias: a sugestão traz a data (10h, dia aberto); nada é criado até o toque; o toque cria o lembrete pelo caminho do Retomar…", async () => {
    await pede("Oi, vou precisar desmarcar meu horário de sábado, surgiu um imprevisto");
    await generateForDeal(dealId, { now: plus(200), caller: responde(texto, 15) });
    expect(calls.at(-1)!.system).toContain("retomar_dias");
    const s = (await pronta(plus(210)))!;
    expect(s.sugestao).toBe(texto);
    expect(s.retomarEm).toEqual(new Date("2026-11-04T13:00:00Z")); // qua 04/11 10:00 em Salvador
    expect(await lembretes()).toHaveLength(0);
    expect(await db.select().from(outbox)).toHaveLength(0);
    const r = await resumeFromSuggestion(s.id, dealId, sara, plus(220));
    expect(r.dueAt).toEqual(new Date("2026-11-04T13:00:00Z"));
    expect(r.outboxId).toBeNull();
    const [t] = await lembretes();
    expect(t).toMatchObject({ title: RETOMADA_IA_MOTIVO, dealId });
    expect(await db.select().from(outbox)).toHaveLength(0); // só lembrete: nada é enviado
    // Programada: a proposta some da sugestão e tocar de novo não cria outra.
    expect((await pronta(plus(230)))!.retomarEm).toBeNull();
    await expect(resumeFromSuggestion(s.id, dealId, sara, plus(240))).rejects.toThrow(/já tem retomada/);
    expect(await lembretes()).toHaveLength(1);
  });

  it("a IA esqueceu (0) mas ela cancelou sem pedir outra data: 3 semanas; 'depois eu remarco' também é sem data", async () => {
    await pede("Vou ter que cancelar, depois eu remarco");
    await generateForDeal(dealId, { now: plus(200), caller: responde(texto, 0) });
    expect((await pronta(plus(210)))!.retomarEm).toEqual(new Date("2026-11-10T13:00:00Z")); // 21 dias, ter 10/11 10:00
  });

  it("a Casa já respondeu ao cancelamento (a Sara mandou por último) e a Cati pede: a proposta vem igual", async () => {
    await pede("Preciso desmarcar o de sábado, não vou conseguir ir");
    await recordOutbound({ dealId, channelId: null, body: "*SARA - CASA FIAES:*\nTudo bem, Paula, desmarquei aqui.", userId: sara, at: plus(190) });
    await generateForDeal(dealId, { userId: sara, now: plus(200), caller: responde("Quando quiser remarcar, é só me chamar. 💛", 30) });
    expect(calls.at(-1)!.user).toContain("A última mensagem é da Casa");
    expect((await pronta(plus(210)))!.retomarEm).toEqual(new Date("2026-11-19T13:00:00Z")); // 30 dias, qui 19/11
  });

  it("sem proposta: remarcação com data, IA que inventa sem cancelamento, horário futuro marcado ou retomada já aberta", async () => {
    await pede("Preciso desmarcar, dá pra remarcar pra sexta à tarde?");
    await generateForDeal(dealId, { now: plus(200), caller: responde("Claro! Vou ver sexta à tarde pra você.", 20) });
    expect((await pronta(plus(210)))!.retomarEm).toBeNull();
    await pede("Quanto custa a hidratação?", "C2", plus(220));
    await generateForDeal(dealId, { now: plus(230), caller: responde("A hidratação fica R$ 80.", 20) });
    expect((await pronta(plus(240)))!.retomarEm).toBeNull();
    await db.update(deals).set({ scheduledAt: plus(5 * 86400) }).where(eq(deals.id, dealId));
    await pede("Vou ter que cancelar, depois vejo", "C3", plus(250));
    await generateForDeal(dealId, { now: plus(260), caller: responde(texto, 15) });
    expect((await pronta(plus(270)))!.retomarEm).toBeNull();
  });
});
