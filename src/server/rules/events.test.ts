import { describe, it, expect, beforeEach } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { alerts, automationRuns, automations, channels, contacts, dealEvents, deals, messages, outbox, settings, stages, teams, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import { recordInbound } from "../domain/deals";
import { addTag, tagsOf as tagsOfContacts } from "../domain/tags";
import { notesOf } from "../domain/notes";
import { saveFuncao } from "../domain/funcoes";
import { ingestEvolution } from "../whatsapp/webhook";
import { runRules } from "./engine";
import { runEventRules } from "./events";
import { previewCandidates } from "./preview";
import { EVENT_TRIGGERS, describeConditions, describeTrigger, type Action, type Condition, type Trigger } from "./types";

const T0 = new Date("2026-10-13T13:00:00Z"); // terça-feira, 10h em Salvador (expediente)
const hour = (n: number) => new Date(T0.getTime() + n * 3_600_000);
const PHONE = "71999812244";

let dealId = "", contactId = "", m1 = "", userId = "";

/** Regra ligada "desde" `enabledAt` (padrão: 1 h antes de T0). */
async function rule(r: { trigger: Trigger; conditions?: Condition[]; actions: Action[]; enabledAt?: Date }) {
  const [a] = await db.insert(automations).values({
    name: `Regra ${r.trigger.type}`, enabled: true, trigger: r.trigger, conditions: r.conditions ?? [], actions: r.actions,
    updatedAt: r.enabledAt ?? hour(-1),
  }).returning();
  return a;
}
async function inbound(ext: string, body: string | null, o: { at?: Date; now?: Date; kind?: string; phone?: string; name?: string } = {}) {
  const at = o.at ?? T0;
  const r = await recordInbound({ channelId: null, externalId: ext, phoneRaw: o.phone ?? PHONE, pushName: o.name ?? "Maria", kind: o.kind ?? "text", body, at, now: o.now ?? at });
  if (!("messageId" in r)) throw new Error("sem mensagem");
  return r;
}
const eventAlerts = async () => (await db.select().from(alerts)).filter((a) => EVENT_TRIGGERS.has(a.type as Trigger["type"]));
const alertTexts = async () => (await eventAlerts()).map((a) => a.message).sort();
async function runs() {
  const ids = (await db.select({ id: automations.id, trigger: automations.trigger }).from(automations))
    .filter((a) => EVENT_TRIGGERS.has((a.trigger as { type: Trigger["type"] }).type)).map((a) => a.id);
  return ids.length ? db.select().from(automationRuns).where(inArray(automationRuns.automationId, ids)) : [];
}

describe("regras por acontecimento", () => {
  beforeEach(async () => {
    await resetDb();
    const [u] = await db.insert(users).values({ name: "Ana", email: "ana@c.com", role: "gestor", passwordHash: "x" }).returning();
    userId = u.id;
  });

  it("'quanto custa' na mensagem da cliente dispara a regra de palavra uma vez por mensagem", async () => {
    await rule({ trigger: { type: "cliente_escreveu", words: ["quanto custa", "valor"] }, actions: [{ type: "alertar_responsavel", message: "{nome} perguntou preço" }] });
    const r = await inbound("m1", "Oi! Quanto custa a escova?");
    dealId = r.dealId; m1 = r.messageId;
    expect(await alertTexts()).toEqual(["Maria perguntou preço"]);
    const again = await runEventRules({ type: "mensagem", dealId, messageId: m1, kind: "text", body: "Oi! Quanto custa a escova?", created: false, at: T0 }, T0);
    expect(again.fired).toBe(0);
    expect(await alertTexts()).toHaveLength(1);
    const rs = await runs();
    expect(rs.map((x) => x.windowKey)).toEqual([`evento:${m1}`]);
  });

  it("palavra casa sem acento e sem maiúscula, mas não dentro de outra palavra ('valor' não casa 'valorizar')", async () => {
    await rule({ trigger: { type: "cliente_escreveu", words: ["preço"] }, actions: [{ type: "alertar_responsavel", message: "{nome}: preço" }] });
    await rule({ trigger: { type: "cliente_escreveu", words: ["valor"] }, actions: [{ type: "alertar_responsavel", message: "{nome}: valor" }] });
    await inbound("a1", "Qual o PRECO da escova?");
    expect(await alertTexts()).toEqual(["Maria: preço"]);
    await inbound("a2", "Quero valorizar meu cabelo", { at: hour(0.1) });
    expect(await alertTexts()).toEqual(["Maria: preço"]);
    await inbound("a3", "e o valor, qual é?", { at: hour(0.2) });
    expect(await alertTexts()).toEqual(["Maria: preço", "Maria: valor"]);
    // Ligação e figurinha não são texto: não casam palavra.
    await inbound("a4", "valor", { at: hour(0.3), kind: "sticker" });
    expect(await alertTexts()).toHaveLength(2);
  });

  it("ligar a regra não age nas mensagens que já chegaram, nem na mensagem com mais de 6 h (webhook reprocessado)", async () => {
    const old = await inbound("o1", "quanto custa?"); // chegou antes de a regra existir
    await rule({ trigger: { type: "cliente_escreveu", words: ["quanto custa"] }, actions: [{ type: "alertar_responsavel", message: "{nome} perguntou preço" }], enabledAt: hour(0.5) });
    const ev = { type: "mensagem" as const, dealId: old.dealId, messageId: old.messageId, kind: "text", body: "quanto custa?", created: false, at: T0 };
    expect((await runEventRules(ev, hour(0.6))).fired).toBe(0);
    // Reprocessada pelo webhook 7 h depois (mensagem nova para o banco, mas com o horário antigo): fora do corte.
    await inbound("o2", "quanto custa a progressiva?", { at: hour(1), now: hour(8) });
    expect(await alertTexts()).toEqual([]);
    // Dentro do corte (5 h): age.
    await inbound("o3", "quanto custa a escova?", { at: hour(2), now: hour(7) });
    expect(await alertTexts()).toEqual(["Maria perguntou preço"]);
  });

  it("o corte é o número da função (Ignorar mensagem com mais de X horas) e a função desligada não dispara nada", async () => {
    await rule({ trigger: { type: "cliente_escreveu", words: ["valor"] }, actions: [{ type: "alertar_responsavel", message: "{nome} perguntou valor" }] });
    await inbound("c1", "valor?", { at: T0, now: hour(7) });
    expect(await alertTexts()).toEqual([]);
    await saveFuncao("regras_acontecimento", { params: { horas_max_mensagem: 8 } }, userId);
    await inbound("c2", "valor?", { at: hour(1), now: hour(8) });
    expect(await alertTexts()).toEqual(["Maria perguntou valor"]);
    await saveFuncao("regras_acontecimento", { on: false }, userId);
    const r = await inbound("c3", "e o valor?", { at: hour(2) });
    expect(await alertTexts()).toHaveLength(1);
    expect((await runEventRules({ type: "mensagem", dealId: r.dealId, messageId: r.messageId, kind: "text", body: "e o valor?", created: false, at: hour(2) }, hour(2))).fired).toBe(0);
  });

  it("etiqueta posta por regra não dispara regra (sem laço A→B→A)", async () => {
    const r = await inbound("e0", "oi");
    contactId = (await db.select({ c: deals.contactId }).from(deals).where(eq(deals.id, r.dealId)))[0].c;
    await rule({ trigger: { type: "etiqueta_colocada", tag: "B" }, actions: [{ type: "alertar_responsavel", message: "{nome} ganhou B" }], enabledAt: new Date(Date.now() - 3_600_000) });
    await runEventRules({ type: "etiqueta", contactId, tag: "B", at: new Date(), byRule: true });
    expect(await runs()).toHaveLength(0);
    await addTag(contactId, "b", userId, { byRule: true });
    expect(await runs()).toHaveLength(0);
  });

  it("etiqueta colocada pela equipe dispara uma vez; a mesma etiqueta de novo e a importada não", async () => {
    const r = await inbound("e1", "oi");
    contactId = (await db.select({ c: deals.contactId }).from(deals).where(eq(deals.id, r.dealId)))[0].c;
    await rule({ trigger: { type: "etiqueta_colocada", tag: "VIP" }, actions: [{ type: "alertar_responsavel", message: "{nome} virou VIP" }], enabledAt: new Date(Date.now() - 3_600_000) });
    await addTag(contactId, "vip", userId);
    expect(await alertTexts()).toEqual(["Maria virou VIP"]);
    await addTag(contactId, "VIP", userId); // já tinha
    expect(await alertTexts()).toHaveLength(1);
    const other = await inbound("e2", "oi", { phone: "71999812255", name: "Joana" });
    const otherContact = (await db.select({ c: deals.contactId }).from(deals).where(eq(deals.id, other.dealId)))[0].c;
    await addTag(otherContact, "VIP", null, { imported: true });
    expect(await alertTexts()).toHaveLength(1);
  });

  it("ligação perdida dispara; atendida não", async () => {
    await db.insert(channels).values({ name: "Recepção", instanceName: "casa-principal", status: "conectado", phone: "+557133330000" });
    await rule({ trigger: { type: "ligacao_perdida" }, actions: [{ type: "alertar_responsavel", message: "Retornar a ligação de {nome}" }], enabledAt: new Date(Date.now() - 3_600_000) });
    const call = (id: string, status: string, secsAgo: number) => ({ event: "call", instance: "casa-principal",
      data: { id, from: "5571999990061@s.whatsapp.net", chatId: "5571999990061@s.whatsapp.net", status, isVideo: false, isGroup: false, date: new Date(Date.now() - secsAgo * 1000).toISOString(), offline: false } });
    await ingestEvolution(call("L1", "accept", 1800));
    expect(await alertTexts()).toEqual([]);
    await ingestEvolution(call("L2", "timeout", 60));
    expect(await alertTexts()).toHaveLength(1);
    expect((await alertTexts())[0]).toMatch(/^Retornar a ligação de /);
  });

  it("contato novo dispara só na 1ª mensagem do contato", async () => {
    await rule({ trigger: { type: "contato_novo" }, actions: [{ type: "alertar_responsavel", message: "{nome} é contato novo" }] });
    await inbound("n1", "oi");
    await inbound("n2", "tudo bem?", { at: hour(0.1) });
    expect(await alertTexts()).toEqual(["Maria é contato novo"]);
    // Cliente que volta depois de Fechado (lead novo, mas o contato já falou com a Casa): não é contato novo.
    await db.update(deals).set({ closedAt: hour(0.2) });
    const back = await inbound("n3", "oi de novo", { at: hour(0.3) });
    expect(back.created).toBe(true);
    expect(await alertTexts()).toHaveLength(1);
  });

  it("contato novo dispara mesmo com o menu de boas-vindas já enviado antes da checagem (só conta mensagem da cliente)", async () => {
    const r = await inbound("nm1", "oi");
    const [d] = await db.select({ contactId: deals.contactId }).from(deals).where(eq(deals.id, r.dealId));
    await db.insert(messages).values({ dealId: r.dealId, contactId: d.contactId, channelId: null, direction: "out", kind: "text", body: "Menu: 1. Agendar 2. Preços", status: "sent", createdAt: new Date(T0.getTime() + 1000) });
    await rule({ trigger: { type: "contato_novo" }, actions: [{ type: "alertar_responsavel", message: "{nome} é contato novo" }] });
    const out = await runEventRules({ type: "mensagem", dealId: r.dealId, messageId: r.messageId, kind: "text", body: "oi", created: true, at: T0 }, T0);
    expect(out.fired).toBe(1);
    expect(await alertTexts()).toEqual(["Maria é contato novo"]);
  });

  it("duas regras na mesma palavra: a que move de etapa não faz a outra perder o acontecimento", async () => {
    const [mover] = await db.insert(automations).values({ name: "A move", enabled: true, trigger: { type: "cliente_escreveu", words: ["agendar"] }, conditions: [],
      actions: [{ type: "mover_para_etapa", stage: "atendimento" }], updatedAt: hour(-1) }).returning();
    await db.insert(automations).values({ name: "B alerta", enabled: true, trigger: { type: "cliente_escreveu", words: ["agendar"] }, conditions: [],
      actions: [{ type: "alertar_responsavel", message: "{nome} quer agendar" }], updatedAt: hour(-1) });
    const r = await inbound("mv1", "quero agendar");
    const [s] = await db.select({ key: stages.key }).from(deals).innerJoin(stages, eq(stages.id, deals.stageId)).where(eq(deals.id, r.dealId));
    expect(s.key).toBe("atendimento");
    expect(await alertTexts()).toEqual(["Maria quer agendar"]);
    expect((await runs()).map((x) => x.automationId).includes(mover.id)).toBe(true);
    expect(await runs()).toHaveLength(2);
  });

  it("mídia recebida: só os tipos marcados", async () => {
    await rule({ trigger: { type: "midia_recebida", kinds: ["audio"] }, actions: [{ type: "alertar_responsavel", message: "{nome} mandou áudio" }] });
    await inbound("x1", null, { kind: "image" });
    expect(await alertTexts()).toEqual([]);
    await inbound("x2", null, { kind: "audio", at: hour(0.1) });
    expect(await alertTexts()).toEqual(["Maria mandou áudio"]);
  });

  it("condição casa_aberta=false só age fora do expediente (Dias especiais valem)", async () => {
    await db.insert(settings).values({ key: "dias_especiais", value: [{ day: "2026-10-15", window: null, text: null }] }); // quinta fechada
    await rule({ trigger: { type: "cliente_escreveu", words: ["oi"] }, conditions: [{ type: "casa_aberta", aberta: false }], actions: [{ type: "alertar_responsavel", message: "{nome} escreveu fora do horário" }] });
    await inbound("h1", "oi"); // terça 10h: aberta
    expect(await alertTexts()).toEqual([]);
    await inbound("h2", "oi", { at: hour(12) }); // terça 22h: fechada
    expect(await alertTexts()).toHaveLength(1);
    // Fadiga de alerta (20/10): com o aviso de terça ainda aberto, a mesma regra não repete o aviso.
    await inbound("h3", "oi", { at: hour(48) }); // quinta 10h: feriado (Dias especiais)
    expect(await alertTexts()).toHaveLength(1);
    await db.update(alerts).set({ resolvedAt: hour(48.1) });
    await inbound("h4", "oi", { at: hour(48.2) }); // quinta, ainda feriado: age
    expect(await alertTexts()).toHaveLength(2);
  });

  it("condição tem_etiqueta e etapa_em valem no acontecimento", async () => {
    await rule({ trigger: { type: "cliente_escreveu", words: ["oi"] }, conditions: [{ type: "tem_etiqueta", tag: "VIP", tem: true }, { type: "etapa_em", stages: ["lead"] }],
      actions: [{ type: "alertar_responsavel", message: "{nome} VIP escreveu" }] });
    const r = await inbound("t1", "oi");
    expect(await alertTexts()).toEqual([]);
    const cid = (await db.select({ c: deals.contactId }).from(deals).where(eq(deals.id, r.dealId)))[0].c;
    await addTag(cid, "vip", userId);
    await inbound("t2", "oi", { at: hour(0.1) });
    expect(await alertTexts()).toEqual(["Maria VIP escreveu"]);
  });

  it("Spam, Fornecedor, Equipe e canal em modo quieto ficam fora (igual ao motor de tempo)", async () => {
    const quiet = (await db.insert(channels).values({ name: "Novo", instanceName: "novo", status: "conectado", quietUntil: hour(24) }).returning())[0];
    const leads = [];
    for (const [i, phone] of ["71999810001", "71999810002", "71999810003", "71999810004", "71999810005"].entries())
      leads.push(await inbound(`k${i}`, "quanto custa?", { phone, name: `C${i}` }));
    const contactOf = async (d: string) => (await db.select({ c: deals.contactId }).from(deals).where(eq(deals.id, d)))[0].c;
    await db.update(contacts).set({ kind: "spam" }).where(eq(contacts.id, await contactOf(leads[0].dealId)));
    await db.update(contacts).set({ kind: "fornecedor" }).where(eq(contacts.id, await contactOf(leads[1].dealId)));
    await db.update(contacts).set({ kind: "equipe" }).where(eq(contacts.id, await contactOf(leads[2].dealId)));
    await db.update(deals).set({ channelId: quiet.id }).where(eq(deals.id, leads[3].dealId));
    await rule({ trigger: { type: "cliente_escreveu", words: ["quanto custa"] }, actions: [{ type: "alertar_responsavel", message: "{nome} perguntou preço" }] });
    for (const l of leads) await runEventRules({ type: "mensagem", dealId: l.dealId, messageId: l.messageId, kind: "text", body: "quanto custa?", created: true, at: T0 }, T0);
    expect(await alertTexts()).toEqual(["C4 perguntou preço"]);
  });

  it("enviar mensagem vai para a fila (a pausa e o consentimento são conferidos lá)", async () => {
    const a = await rule({ trigger: { type: "cliente_escreveu", words: ["horário"] }, actions: [{ type: "enviar_mensagem", message: "Oi, {nome}! Já te mando os horários." }] });
    await inbound("s1", "tem horario amanhã?");
    const rows = await db.select().from(outbox);
    expect(rows.map((r) => [r.text, (r.options as { source?: string }).source])).toEqual([["Oi, Maria! Já te mando os horários.", `automacao:${a.id}`]]);
  });

  it("runRules (a cada minuto) não roda gatilho de acontecimento", async () => {
    await db.update(automations).set({ enabled: false });
    await rule({ trigger: { type: "cliente_escreveu", words: ["oi"] }, actions: [{ type: "alertar_responsavel", message: "{nome}" }] });
    await rule({ trigger: { type: "contato_novo" }, actions: [{ type: "alertar_responsavel", message: "{nome}" }] });
    await rule({ trigger: { type: "ligacao_perdida" }, actions: [{ type: "alertar_responsavel", message: "{nome}" }] });
    await rule({ trigger: { type: "midia_recebida", kinds: ["image"] }, actions: [{ type: "alertar_responsavel", message: "{nome}" }] });
    await rule({ trigger: { type: "etiqueta_colocada", tag: "B" }, actions: [{ type: "alertar_responsavel", message: "{nome}" }] });
    const s = await runRules(T0);
    expect(s.fired).toBe(0);
    expect(s.errors).toEqual([]);
  });

  it("a prévia de gatilho de acontecimento não conta ninguém (vale para o que acontecer depois de ligar)", async () => {
    await inbound("p1", "quanto custa?");
    const p = await previewCandidates({ name: "Preço", enabled: true, trigger: { type: "cliente_escreveu", words: ["quanto custa"] }, conditions: [], actions: [{ type: "alertar_responsavel", message: "{nome} perguntou" }] }, T0);
    expect(p).toEqual({ count: 0, sendCount: 0, sample: [] });
  });

  it("frase legível do gatilho e das condições", () => {
    const stages = [{ key: "lead", name: "Novo contato" }];
    expect(describeTrigger({ type: "cliente_escreveu", words: ["quanto custa", "valor"] }) + describeConditions([{ type: "casa_aberta", aberta: true }], stages))
      .toBe("a cliente escrever 'quanto custa' ou 'valor', com a Casa aberta");
    expect(describeConditions([{ type: "etapa_em", stages: ["lead"] }, { type: "tem_etiqueta", tag: "VIP", tem: false }, { type: "casa_aberta", aberta: false }], stages))
      .toBe(", em Novo contato, sem a etiqueta VIP, com a Casa fechada");
    expect(describeTrigger({ type: "midia_recebida", kinds: ["image", "audio"] })).toBe("a cliente mandar foto ou áudio");
  });
});

/* ---------- Task 7: ações novas (pôr/tirar etiqueta, passar para, nota, arquivo, status, atraso) ---------- */
describe("regras: ações novas", () => {
  let recepcaoId = "";
  const named = async (name: string, r: { trigger: Trigger; actions: Action[]; conditions?: Condition[] }) =>
    (await db.insert(automations).values({ name, enabled: true, trigger: r.trigger, conditions: r.conditions ?? [], actions: r.actions, updatedAt: hour(-1) }).returning())[0];
  const tagNames = async (cid: string) => ((await tagsOfContacts([cid])).get(cid) ?? []).map((t) => t.name);
  const dealRow = async (id: string) => (await db.select().from(deals).where(eq(deals.id, id)))[0];
  const contactOf = async (d: string) => (await db.select({ c: deals.contactId }).from(deals).where(eq(deals.id, d)))[0].c;

  beforeEach(async () => {
    await resetDb();
    const [u] = await db.insert(users).values({ name: "Ana", email: "ana@c.com", role: "gestor", passwordHash: "x" }).returning();
    userId = u.id;
    recepcaoId = (await db.select().from(teams).where(eq(teams.name, "Recepção")))[0].id;
  });

  it("'remarcar' na mensagem: põe Quer remarcar, passa para o setor Recepção e escreve a nota", async () => {
    await named("Remarcar", { trigger: { type: "cliente_escreveu", words: ["remarcar"] }, actions: [
      { type: "por_etiqueta", tag: "Quer remarcar" }, { type: "passar_para", to: { team: recepcaoId } }, { type: "escrever_nota", text: "Pediu para remarcar" }] });
    const r = await inbound("m1", "Preciso remarcar amanhã");
    const cid = await contactOf(r.dealId);
    expect(await tagNames(cid)).toContain("Quer remarcar");
    expect((await dealRow(r.dealId)).teamId).toBe(recepcaoId);
    expect(await notesOf(cid)).toContainEqual(expect.objectContaining({ authorName: "Regra: Remarcar", body: "Pediu para remarcar", source: "regra" }));
  });

  it("tirar_etiqueta tira a etiqueta da cliente (sem diferença de maiúscula); sem a etiqueta, não é erro", async () => {
    const r = await inbound("t0", "oi");
    const cid = await contactOf(r.dealId);
    await addTag(cid, "VIP", userId);
    await named("Tira VIP", { trigger: { type: "cliente_escreveu", words: ["cancelar"] }, actions: [{ type: "tirar_etiqueta", tag: "vip" }] });
    const m = await inbound("t1", "quero cancelar", { at: hour(0.1) });
    expect(await tagNames(cid)).toEqual([]);
    const again = await runEventRules({ type: "mensagem", dealId: m.dealId, messageId: m.messageId, kind: "text", body: "quero cancelar", created: false, at: hour(0.1) }, hour(0.1));
    expect(again.errors).toEqual([]);
  });

  it("passar_para pessoa que saiu da equipe: a regra registra o erro e as outras ações seguem (a anterior não é desfeita)", async () => {
    const r = await inbound("p0", "quero remarcar");
    const cid = await contactOf(r.dealId);
    const [saiu] = await db.insert(users).values({ name: "Bia", email: "bia@c.com", role: "atendente", passwordHash: "x", active: false }).returning();
    await named("Remarcar", { trigger: { type: "cliente_escreveu", words: ["remarcar"] }, actions: [
      { type: "por_etiqueta", tag: "Quer remarcar" }, { type: "passar_para", to: { user: saiu.id } }, { type: "escrever_nota", text: "Pediu para remarcar" }] });
    const out = await runEventRules({ type: "mensagem", dealId: r.dealId, messageId: r.messageId, kind: "text", body: "quero remarcar", created: true, at: T0 }, T0);
    expect(out.fired).toBe(1);
    expect(out.errors).toEqual([`Remarcar / ${r.dealId}: Essa pessoa não está mais na equipe.`]);
    expect(await tagNames(cid)).toEqual(["Quer remarcar"]);
    expect((await notesOf(cid)).map((n) => n.body)).toEqual(["Pediu para remarcar"]);
    expect((await dealRow(r.dealId)).ownerId).not.toBe(saiu.id);
  });

  it("passar_para pessoa ativa: a conversa vai para ela, como Sistema; se já é dela, nada muda", async () => {
    const [bia] = await db.insert(users).values({ name: "Bia", email: "bia@c.com", role: "atendente", passwordHash: "x" }).returning();
    const r = await inbound("p1", "quero falar com a Bia");
    await db.update(deals).set({ ownerId: userId }).where(eq(deals.id, r.dealId)); // a distribuição pode ter dado a qualquer uma
    await named("Para Bia", { trigger: { type: "cliente_escreveu", words: ["bia"] }, actions: [{ type: "passar_para", to: { user: bia.id } }] });
    const ev = { type: "mensagem" as const, dealId: r.dealId, messageId: r.messageId, kind: "text", body: "quero falar com a Bia", created: false, at: T0 };
    expect(await runEventRules(ev, T0)).toEqual({ fired: 1, errors: [] });
    expect((await dealRow(r.dealId)).ownerId).toBe(bia.id);
    const avisos = await db.select().from(alerts).where(eq(alerts.type, "transferido_para_voce"));
    expect(avisos.map((a) => [a.userId, a.message.split(" ")[0]])).toEqual([[bia.id, "Sistema"]]);
    const m2 = await inbound("p2", "Bia de novo", { at: hour(0.1) });
    expect((await db.select().from(alerts).where(eq(alerts.type, "transferido_para_voce")))).toHaveLength(1);
    expect(m2.dealId).toBe(r.dealId);
  });

  it("Automáticas pausadas: as ações internas continuam (etiqueta e nota); a mensagem fica para a fila decidir", async () => {
    const r = await inbound("z0", "oi");
    const cid = await contactOf(r.dealId);
    await db.update(contacts).set({ automationsPausedUntil: hour(48) }).where(eq(contacts.id, cid));
    await named("Pausada", { trigger: { type: "cliente_escreveu", words: ["remarcar"] }, actions: [
      { type: "por_etiqueta", tag: "Quer remarcar" }, { type: "escrever_nota", text: "Pediu para remarcar" }, { type: "enviar_mensagem", message: "Oi, {nome}!" }] });
    await inbound("z1", "preciso remarcar", { at: hour(0.1) });
    expect(await tagNames(cid)).toEqual(["Quer remarcar"]);
    expect((await notesOf(cid)).map((n) => n.body)).toEqual(["Pediu para remarcar"]);
    expect(await db.select().from(outbox)).toHaveLength(1);
  });

  it("com Setores desligada, passar para setor vira erro da regra e as outras ações seguem", async () => {
    const r = await inbound("st0", "remarcar");
    await saveFuncao("setores", { on: false }, userId);
    await named("Remarcar", { trigger: { type: "cliente_escreveu", words: ["remarcar"] }, actions: [{ type: "passar_para", to: { team: recepcaoId } }, { type: "por_etiqueta", tag: "Quer remarcar" }] });
    const out = await runEventRules({ type: "mensagem", dealId: r.dealId, messageId: r.messageId, kind: "text", body: "remarcar", created: false, at: T0 }, T0);
    expect(out.errors).toEqual([`Remarcar / ${r.dealId}: Setores está desligada em Configurações › Recursos.`]);
    expect((await dealRow(r.dealId)).teamId).toBeNull();
    expect(await tagNames(await contactOf(r.dealId))).toEqual(["Quer remarcar"]);
  });

  it("etiqueta posta pela regra não dispara a regra de etiqueta (byRule)", async () => {
    await named("Põe B", { trigger: { type: "cliente_escreveu", words: ["oi"] }, actions: [{ type: "por_etiqueta", tag: "B" }] });
    await named("Alerta B", { trigger: { type: "etiqueta_colocada", tag: "B" }, actions: [{ type: "alertar_responsavel", message: "{nome} ganhou B" }] });
    const r = await inbound("b1", "oi");
    expect(await tagNames(await contactOf(r.dealId))).toEqual(["B"]);
    expect(await alertTexts()).toEqual([]);
  });

  it("enviar_mensagem com 10 min de atraso entra na fila com notBefore = agora + 10 min", async () => {
    await named("Horários", { trigger: { type: "cliente_escreveu", words: ["horário"] }, actions: [{ type: "enviar_mensagem", message: "Oi, {nome}! Já te mando os horários.", delayMinutes: 10 }] });
    await inbound("d1", "tem horario?");
    const [row] = await db.select().from(outbox);
    expect(row.notBefore).toEqual(new Date(T0.getTime() + 10 * 60_000));
  });

  it("escrever_nota mantém o texto da gestão e mudar_status aguardando tira a espera (Sistema)", async () => {
    await named("Só olhar", { trigger: { type: "cliente_escreveu", words: ["obrigada"] }, actions: [{ type: "escrever_nota", text: "Agradeceu, sem pergunta" }, { type: "mudar_status", status: "aguardando" }] });
    const r = await inbound("s1", "obrigada!");
    expect((await dealRow(r.dealId)).awaitingReplySince).toBeNull();
    const ev = (await db.select().from(dealEvents).where(eq(dealEvents.dealId, r.dealId))).find((e) => e.type === "resolvida");
    expect(ev?.userId).toBeNull();
  });
});
