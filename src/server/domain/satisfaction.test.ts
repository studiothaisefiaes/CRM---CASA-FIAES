import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { alerts, appointments, automations, channels, contacts, contactTags, deals, lists, messages, outbox, professionals, satisfactionAnswers, stages, tags, visits } from "../db/schema";
import { resetDb } from "../../../test/db";
import { setupAgenda, setSetting } from "../../../test/agenda-fixtures";
import { permsFor } from "../../../test/perms";
import { setWhatsappProvider } from "../whatsapp/evolution";
import { drainOutbox, enqueueAutomated } from "./outbox";
import { candidateForDeal, fireRule } from "../rules/engine";
import type { Action } from "../rules/types";
import { afterVisitDone, getAfterVisit, type AfterVisitConfig } from "./after-visit";
import { applyPollVote } from "./poll-vote";
import { AFTER_VISIT_DEFAULTS } from "@/lib/after-visit";
import { VIRADA_ITENS } from "@/lib/virada";
import { CONFIRMACAO_OPCOES } from "../rules/types";
import { SATISFACTION_OPTIONS, applySatisfactionVote, loadSatisfaction, satisfactionNumbers, scoreOf } from "./satisfaction";

/** Instante de Salvador (UTC−3). */
const bahia = (day: string, hm: string) => new Date(`${day}T${hm}:00-03:00`);
const GOOGLE = "https://g.page/r/casa-fiaes/review";
const T0 = bahia("2026-10-20", "15:00"); // terça, a enquete sai (13h + 2 h)
const T1 = bahia("2026-10-20", "16:00");

// Provider falso: nenhum teste fala com a Evolution nem envia mensagem real.
const sentTexts: string[] = [];
const sentPolls: { title: string; options: string[]; id: string }[] = [];
const fake = {
  createInstance: async () => {}, connect: async () => ({ status: "conectado" as const }), state: async () => "conectado" as const, logout: async () => {}, remove: async () => {},
  sendText: async (_i: string, _to: string, text: string) => { sentTexts.push(text); return { externalId: `TXT${sentTexts.length}` }; },
  sendPoll: async (_i: string, _to: string, title: string, options: string[]) => { const id = `POLL${sentPolls.length + 1}`; sentPolls.push({ title, options, id }); return { externalId: id }; },
};

let channelId = "";
let gilvan = "", escova = "";
let seq = 0;

/** Modo pesquisa direto no banco, com a Virada do Depois do atendimento feita (a regra "Mandar a Pesquisa de satisfação" exige, Task 10). */
const pesquisa = async (patch: Partial<AfterVisitConfig> = {}) => {
  await setSetting("virada_depois", { alvo: "depois", marcados: [...VIRADA_ITENS.depois], quem: "teste", quando: T0.toISOString() });
  await setSetting("depois_atendimento", { ...AFTER_VISIT_DEFAULTS, mode: "pesquisa", linkGoogle: GOOGLE, ...patch });
};

/** Maria, com conversa aberta e uma visita (Escova com Gilvan) Finalizada às 13h. */
async function mariaComVisita(name = "Maria") {
  const [c] = await db.insert(contacts).values({ name, phoneE164: `+5571988${String(++seq).padStart(6, "0")}` }).returning();
  const [st] = await db.select().from(stages).where(eq(stages.key, "atendimento"));
  const [d] = await db.insert(deals).values({ contactId: c.id, stageId: st.id, channelId }).returning();
  const [v] = await db.insert(visits).values({ contactId: c.id, day: "2026-10-20", dealId: d.id }).returning();
  const done = bahia("2026-10-20", "13:00");
  await db.insert(appointments).values({ contactId: c.id, clientName: name, professionalId: gilvan, serviceId: escova, serviceLabel: "Escova", startsAt: bahia("2026-10-20", "12:00"),
    durationMin: 60, status: "compareceu", origin: "crm", externalKey: `crm:${++seq}`, visitId: v.id, finishedAt: done, updatedAt: done });
  return { contactId: c.id, dealId: d.id, visitId: v.id };
}

/** A enquete sai pela fila (modo pesquisa) e devolve o id da mensagem da enquete (a linha da pesquisa). */
async function enqueteEnviada(name = "Maria") {
  const p = await mariaComVisita(name);
  expect(await afterVisitDone(p.visitId, bahia("2026-10-20", "13:00"))).toBe("enfileirado");
  const polls = sentPolls.length;
  await drainOutbox(T0);
  expect(sentPolls).toHaveLength(polls + 1);
  const [row] = await db.select().from(satisfactionAnswers).where(eq(satisfactionAnswers.dealId, p.dealId));
  return { ...p, pollId: row.pollMessageId, externalId: sentPolls.at(-1)!.id };
}

/** Os textos que estão na fila para sair (a enquete não conta). */
const outboxTexts = async () => (await db.select().from(outbox).where(and(eq(outbox.kind, "text"), eq(outbox.status, "pending")))).map((o) => o.text);
const alertsOf = (dealId: string) => db.select().from(alerts).where(eq(alerts.dealId, dealId));
const tagsOf = async (contactId: string) => (await db.select({ name: tags.name }).from(contactTags).innerJoin(tags, eq(tags.id, contactTags.tagId)).where(eq(contactTags.contactId, contactId))).map((t) => t.name);
const answer = async (pollId: string) => (await db.select().from(satisfactionAnswers).where(eq(satisfactionAnswers.pollMessageId, pollId)))[0];

beforeEach(async () => {
  sentTexts.length = 0; sentPolls.length = 0;
  await resetDb();
  await setupAgenda();
  setWhatsappProvider(fake);
  [{ id: channelId }] = await db.insert(channels).values({ name: "Rec", instanceName: "rec", status: "conectado", phone: "+557199990404" }).returning();
  await setSetting("business_hours", { 0: null, 1: null, 2: ["09:00", "18:00"], 3: ["09:00", "18:00"], 4: ["09:00", "18:00"], 5: ["09:00", "18:00"], 6: ["09:00", "18:00"] });
  [{ id: gilvan }] = await db.insert(professionals).values({ name: "Gilvan" }).returning();
  [{ id: escova }] = await db.insert(lists).values({ kind: "service", label: "Escova", position: 95 }).returning();
  await pesquisa();
});
afterEach(() => { setWhatsappProvider(null); });

describe("Pesquisa de satisfação: a enquete", () => {
  it("as opções são fixas e a nota é o número", () => {
    expect(SATISFACTION_OPTIONS).toEqual(["5 · Excelente", "4 · Muito bom", "3 · Bom", "2 · Ruim", "1 · Muito ruim"]);
    expect(SATISFACTION_OPTIONS.map(scoreOf)).toEqual([5, 4, 3, 2, 1]);
    expect(scoreOf("Confirmo")).toBeNull();
    expect(scoreOf(" 2 · ruim ")).toBe(2);
  });

  it("no modo pesquisa a fila manda a enquete de 1 a 5 e, enviada, grava a pergunta com quem fez e o que fez", async () => {
    const p = await mariaComVisita();
    await afterVisitDone(p.visitId, bahia("2026-10-20", "13:00"));
    const [item] = await db.select().from(outbox);
    expect(item).toMatchObject({ kind: "poll", text: "Maria, de 1 a 5, como foi seu atendimento hoje na Casa Fiaes?", options: { values: [...SATISFACTION_OPTIONS] } });
    expect(await db.select().from(satisfactionAnswers)).toHaveLength(0); // só grava depois de enviar
    expect((await drainOutbox(T0)).sent).toBe(1);
    expect(sentPolls).toEqual([{ title: "Maria, de 1 a 5, como foi seu atendimento hoje na Casa Fiaes?", options: [...SATISFACTION_OPTIONS], id: "POLL1" }]);
    expect(sentTexts).toEqual([]); // uma mensagem só: nunca o agradecimento junto
    const rows = await db.select().from(satisfactionAnswers);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ visitId: p.visitId, dealId: p.dealId, contactId: p.contactId, professionalIds: [gilvan], serviceIds: [escova], score: null, answeredAt: null, askedAt: T0 });
  });

  it("enfileirado como agradecimento e mudado para pesquisa antes de sair: sai a enquete (a configuração de agora vale)", async () => {
    await pesquisa({ mode: "agradecimento" });
    const p = await mariaComVisita();
    await afterVisitDone(p.visitId, bahia("2026-10-20", "13:00"));
    expect((await db.select().from(outbox))[0].kind).toBe("text");
    await pesquisa();
    expect((await drainOutbox(T0)).sent).toBe(1);
    expect(sentTexts).toEqual([]);
    expect(sentPolls).toHaveLength(1);
    expect(await db.select().from(satisfactionAnswers)).toHaveLength(1);
  });

  it("Automáticas pausadas: a enquete não sai e nada é gravado", async () => {
    const p = await mariaComVisita();
    await afterVisitDone(p.visitId, bahia("2026-10-20", "13:00"));
    await db.update(contacts).set({ automationsPausedUntil: bahia("2026-10-25", "00:00") }).where(eq(contacts.id, p.contactId));
    await drainOutbox(T0);
    expect((await db.select().from(outbox))[0].status).toBe("cancelled");
    expect(sentPolls).toEqual([]);
    expect(await db.select().from(satisfactionAnswers)).toHaveLength(0);
  });
});

describe("Pesquisa de satisfação: o voto", () => {
  it("nota 5: grava, e a cliente recebe a mensagem de nota alta com o link do Google", async () => {
    const { pollId } = await enqueteEnviada();
    expect(await applySatisfactionVote(pollId, "5 · Excelente", T1)).toBe("nota_alta");
    expect(await outboxTexts()).toEqual(["Que alegria, Maria! 💛 Se puder, conte como foi no Google: https://g.page/r/casa-fiaes/review"]);
    expect(await answer(pollId)).toMatchObject({ score: 5, answeredAt: T1 });
    const [item] = await db.select().from(outbox).where(eq(outbox.kind, "text"));
    expect(item.options).toMatchObject({ source: `pesquisa_nota_alta:${pollId}` });
    expect((await drainOutbox(T1)).sent).toBe(1);
    expect(sentTexts).toEqual(["Que alegria, Maria! 💛 Se puder, conte como foi no Google: https://g.page/r/casa-fiaes/review"]);
  });

  it("nota 2: avisa a gestão com cliente, serviços e quem fez; põe a etiqueta Nota baixa; não manda nada para a cliente", async () => {
    const { pollId, dealId, contactId } = await enqueteEnviada();
    expect(await applySatisfactionVote(pollId, "2 · Ruim", T1)).toBe("nota_baixa");
    expect(await outboxTexts()).toEqual([]);
    expect(await alertsOf(dealId)).toContainEqual(expect.objectContaining({ audience: "gestao", type: "nota_baixa",
      message: "Maria deu nota 2 para Escova com Gilvan. Fale com ela hoje.", dedupeKey: `nota:${pollId}`, resolvedAt: null }));
    expect(await tagsOf(contactId)).toContain("Nota baixa");
    expect(await answer(pollId)).toMatchObject({ score: 2 });
  });

  it("mudou o voto de 2 para 5: vale o último, o alerta de nota baixa se resolve, e o link sai uma vez só", async () => {
    const { pollId, dealId, contactId } = await enqueteEnviada();
    expect(await applySatisfactionVote(pollId, "2 · Ruim", T1)).toBe("nota_baixa");
    expect(await applySatisfactionVote(pollId, "5 · Excelente", T1)).toBe("nota_alta");
    expect((await alertsOf(dealId))[0].resolvedAt).not.toBeNull();
    expect(await tagsOf(contactId)).not.toContain("Nota baixa");
    expect((await drainOutbox(T1)).sent).toBe(1);
    expect(await applySatisfactionVote(pollId, "2 · Ruim", T1)).toBe("nota_baixa");
    const open = await alertsOf(dealId);
    expect(open).toHaveLength(1); // o mesmo alerta (nota:<enquete>) volta a ficar aberto
    expect(open[0].resolvedAt).toBeNull();
    expect(await applySatisfactionVote(pollId, "5 · Excelente", T1)).toBe("nota_alta");
    await drainOutbox(T1);
    expect(sentTexts).toEqual(["Que alegria, Maria! 💛 Se puder, conte como foi no Google: https://g.page/r/casa-fiaes/review"]);
    expect((await db.select().from(outbox).where(eq(outbox.kind, "text")))).toHaveLength(1);
    expect(await answer(pollId)).toMatchObject({ score: 5 });
  });

  it("nota alta que virou baixa antes de sair: a mensagem do Google é cancelada na fila", async () => {
    const { pollId } = await enqueteEnviada();
    await applySatisfactionVote(pollId, "5 · Excelente", T1);
    await applySatisfactionVote(pollId, "1 · Muito ruim", T1);
    await drainOutbox(T1);
    expect(sentTexts).toEqual([]);
    expect((await db.select().from(outbox).where(eq(outbox.kind, "text")))[0]).toMatchObject({ status: "cancelled", error: "A nota da Pesquisa de satisfação mudou." });
  });

  it("votou de novo com a mesma nota (webhook repetido): nada muda", async () => {
    const { pollId, dealId } = await enqueteEnviada();
    expect(await applySatisfactionVote(pollId, "2 · Ruim", T1)).toBe("nota_baixa");
    const later = bahia("2026-10-20", "17:00");
    expect(await applySatisfactionVote(pollId, "2 · Ruim", later)).toBe("nada");
    expect(await alertsOf(dealId)).toHaveLength(1);
    expect(await answer(pollId)).toMatchObject({ score: 2, answeredAt: T1 });
    expect(await applySatisfactionVote(pollId, "5 · Excelente", T1)).toBe("nota_alta");
    expect(await applySatisfactionVote(pollId, "5 · Excelente", later)).toBe("nada");
    expect(await db.select().from(outbox).where(eq(outbox.kind, "text"))).toHaveLength(1);
  });

  it("voto retirado: a nota sai, o alerta se resolve; opção que não é da pesquisa não faz nada", async () => {
    const { pollId, dealId } = await enqueteEnviada();
    await applySatisfactionVote(pollId, "2 · Ruim", T1);
    expect(await applySatisfactionVote(pollId, null, T1)).toBe("retirado");
    expect(await answer(pollId)).toMatchObject({ score: null, answeredAt: null });
    expect((await alertsOf(dealId))[0].resolvedAt).not.toBeNull();
    expect(await applySatisfactionVote(pollId, "Confirmo", T1)).toBe("nada");
    expect(await applySatisfactionVote("00000000-0000-4000-8000-000000000000", "5 · Excelente", T1)).toBe("nada");
  });

  it("o voto chega pelo webhook (applyPollVote): enquete da pesquisa vai para a pesquisa", async () => {
    const { pollId, externalId } = await enqueteEnviada();
    expect(await applyPollVote({ channelId, pollExternalId: externalId, option: "4 · Muito bom", at: T1 })).toEqual({ applied: "pesquisa", pesquisa: "nota_alta" });
    expect(await answer(pollId)).toMatchObject({ score: 4 });
  });

  it("enquete de confirmação continua com o caminho antigo (Confirmo / Preciso remarcar)", async () => {
    const p = await mariaComVisita();
    await db.insert(messages).values({ dealId: p.dealId, contactId: p.contactId, channelId, direction: "out", kind: "poll", body: "Enquete: Confirma?", externalId: "CONF1", status: "sent" });
    expect(await applyPollVote({ channelId, pollExternalId: "CONF1", option: CONFIRMACAO_OPCOES.confirmo, at: T1 })).toEqual({ applied: "confirmado" });
    expect((await db.select().from(deals).where(eq(deals.id, p.dealId)))[0].attendance).toBe("confirmado");
    expect(await db.select().from(satisfactionAnswers)).toHaveLength(0);
  });
});

describe("Pesquisa de satisfação: tudo configurável (regra do dono)", () => {
  it("nota alta a partir de 4 (padrão): nota 4 recebe o Google e 3 é baixa; com 'só 5', a nota 4 vira baixa", async () => {
    expect((await getAfterVisit()).notaAltaMin).toBe(4);
    const a = await enqueteEnviada("Maria");
    expect(await applySatisfactionVote(a.pollId, "4 · Muito bom", T1)).toBe("nota_alta");
    const b = await enqueteEnviada("Rita");
    expect(await applySatisfactionVote(b.pollId, "3 · Bom", T1)).toBe("nota_baixa");
    await pesquisa({ notaAltaMin: 5 });
    const c = await enqueteEnviada("Joana");
    expect(await applySatisfactionVote(c.pollId, "4 · Muito bom", T1)).toBe("nota_baixa");
  });

  it("o texto do alerta, o da nota alta e o nome da etiqueta são os da configuração", async () => {
    await pesquisa({ textoNotaBaixa: "Nota {nota} de {nome} ({servicos}, {profissionais}): ligue já.", etiquetaNotaBaixa: "Atenção pesquisa",
      textoNotaAlta: "Valeu, {primeiro_nome}! Avalie: {link_google}" });
    const a = await enqueteEnviada("Maria Souza");
    await applySatisfactionVote(a.pollId, "1 · Muito ruim", T1);
    expect((await alertsOf(a.dealId))[0].message).toBe("Nota 1 de Maria Souza (Escova, Gilvan): ligue já.");
    expect(await tagsOf(a.contactId)).toEqual(["Atenção pesquisa"]);
    const b = await enqueteEnviada("Rita Lima");
    await applySatisfactionVote(b.pollId, "5 · Excelente", T1);
    expect(await outboxTexts()).toEqual([`Valeu, Rita! Avalie: ${GOOGLE}`]);
  });

  it("desligada depois de enviar: o voto ainda grava a nota, mas nada sai para a cliente", async () => {
    const { pollId } = await enqueteEnviada();
    await pesquisa({ mode: "desligado" });
    expect(await applySatisfactionVote(pollId, "5 · Excelente", T1)).toBe("nota_alta");
    expect(await outboxTexts()).toEqual([]);
    expect(await answer(pollId)).toMatchObject({ score: 5 });
  });
});

describe("Pesquisa de satisfação: números (Relatórios › Salão)", () => {
  const ask = async (o: { pros: string[]; score: number | null; at: Date }) => {
    const p = await mariaComVisita(`Cliente ${++seq}`);
    const [m] = await db.insert(messages).values({ dealId: p.dealId, contactId: p.contactId, direction: "out", kind: "poll", body: "Enquete", status: "sent" }).returning();
    await db.insert(satisfactionAnswers).values({ dealId: p.dealId, contactId: p.contactId, pollMessageId: m.id, professionalIds: o.pros, askedAt: o.at, score: o.score, answeredAt: o.score ? o.at : null });
  };

  it("satisfactionNumbers: média e respostas por profissional no período", async () => {
    const [{ id: lia }] = await db.insert(professionals).values({ name: "Lia" }).returning();
    await ask({ pros: [gilvan], score: 5, at: bahia("2026-10-05", "10:00") });
    await ask({ pros: [gilvan, lia], score: 2, at: bahia("2026-10-10", "10:00") });
    await ask({ pros: [lia], score: null, at: bahia("2026-10-31", "23:30") }); // perguntada e sem resposta, último minuto do período
    await ask({ pros: [gilvan], score: 1, at: bahia("2026-11-01", "00:10") }); // fora do período
    await ask({ pros: [gilvan], score: 1, at: bahia("2026-09-30", "23:50") }); // fora do período
    expect(await satisfactionNumbers({ from: "2026-10-01", to: "2026-10-31" })).toEqual({
      asked: 3, answered: 2, average: 3.5,
      byProfessional: [{ id: gilvan, name: "Gilvan", answered: 2, average: 3.5 }, { id: lia, name: "Lia", answered: 1, average: 2 }],
    });
    expect(await satisfactionNumbers({ from: "2026-12-01", to: "2026-12-31" })).toEqual({ asked: 0, answered: 0, average: null, byProfessional: [] });
  });

  it("sem 'Ver números de toda a equipe' (relatorios.equipe) o servidor não entrega o bloco", async () => {
    await ask({ pros: [gilvan], score: 5, at: bahia("2026-10-05", "10:00") });
    const range = { from: "2026-10-01", to: "2026-10-31" };
    expect(await loadSatisfaction({ perms: permsFor("atendente").filter((p) => p !== "relatorios.equipe") }, range)).toBeNull();
    expect(await loadSatisfaction({ perms: permsFor("gestor") }, range)).toMatchObject({ asked: 1, answered: 1, average: 5 });
  });
});

describe("Pesquisa de satisfação: uma pesquisa só por visita (regra × Depois do atendimento)", () => {
  const JA = "A cliente já recebeu a Pesquisa de satisfação desta visita.";
  const acts: Action[] = [{ type: "pedir_avaliacao" }, { type: "por_etiqueta", tag: "Pediu avaliação" }];
  let n = 0;
  /** Roda a regra "Mandar a Pesquisa de satisfação" + pôr etiqueta na conversa, agora. */
  async function regra(dealId: string, at = T0) {
    const [auto] = await db.insert(automations).values({ name: `Pesquisa ${++n}`, enabled: true, trigger: { type: "contato_novo" }, conditions: [], actions: acts }).returning();
    const c = await candidateForDeal(dealId, at);
    return fireRule(auto, { type: "contato_novo" }, acts, { ...c!, windowKey: `t:${n}` }, at);
  }
  const polls = async () => (await db.select().from(outbox).where(eq(outbox.kind, "poll")));

  it("Depois do atendimento já tem a pesquisa da visita (na fila ou enviada): a regra não manda outra e as outras ações seguem", async () => {
    const p = await mariaComVisita();
    expect(await afterVisitDone(p.visitId, bahia("2026-10-20", "13:00"))).toBe("enfileirado");
    expect(await regra(p.dealId, bahia("2026-10-20", "14:00"))).toEqual({ results: ["etiqueta"], errors: [JA] });
    expect(await polls()).toHaveLength(1);
    expect(await tagsOf(p.contactId)).toContain("Pediu avaliação");
    await drainOutbox(T0);
    expect(await regra(p.dealId, T1)).toEqual({ results: [], errors: [JA] });
    expect(sentPolls).toHaveLength(1);
  });

  it("a regra mandou a pesquisa da visita: o Depois do atendimento não manda nada para essa visita", async () => {
    const p = await mariaComVisita();
    expect(await regra(p.dealId, bahia("2026-10-20", "14:00"))).toEqual({ results: ["mensagem", "etiqueta"], errors: [] });
    expect((await polls())[0].options).toMatchObject({ visitId: p.visitId });
    expect(await afterVisitDone(p.visitId, bahia("2026-10-20", "14:00"))).toBe("ja_tem");
    await drainOutbox(T0);
    expect(sentPolls).toHaveLength(1);
    expect(await answer((await db.select().from(satisfactionAnswers))[0].pollMessageId)).toMatchObject({ visitId: p.visitId, professionalIds: [gilvan] });
    expect(await afterVisitDone(p.visitId, bahia("2026-10-20", "15:30"))).toBe("ja_tem");
    expect(await polls()).toHaveLength(1);
  });

  it("as duas na fila ao mesmo tempo: no envio sai a primeira e a outra é cancelada", async () => {
    const p = await mariaComVisita();
    await afterVisitDone(p.visitId, bahia("2026-10-20", "13:00"));
    await enqueueAutomated({ dealId: p.dealId, kind: "poll", text: "Maria, de 1 a 5?", options: [...SATISFACTION_OPTIONS], source: "automacao:00000000-0000-4000-8000-000000000001", guard: { visitId: p.visitId } });
    await db.insert(automations).values({ id: "00000000-0000-4000-8000-000000000001", name: "Pesquisa", enabled: true, trigger: { type: "contato_novo" }, conditions: [], actions: acts });
    await drainOutbox(T0);
    expect(sentPolls).toHaveLength(1);
    expect((await polls()).map((o) => [o.status, o.error])).toEqual(expect.arrayContaining([["sent", null], ["cancelled", JA]]));
  });

  it("a linha da pesquisa não foi gravada no envio: o voto ainda é da pesquisa (a linha nasce no voto) e a nota 2 avisa a gestão", async () => {
    const { pollId, dealId, externalId, visitId } = await enqueteEnviada();
    await db.delete(satisfactionAnswers);
    expect(await applyPollVote({ channelId, pollExternalId: externalId, option: "2 · Ruim", at: T1 })).toEqual({ applied: "pesquisa", pesquisa: "nota_baixa" });
    expect(await answer(pollId)).toMatchObject({ visitId, professionalIds: [gilvan], serviceIds: [escova], score: 2, askedAt: T0 });
    expect(await alertsOf(dealId)).toContainEqual(expect.objectContaining({ type: "nota_baixa", message: "Maria deu nota 2 para Escova com Gilvan. Fale com ela hoje." }));
  });
});
