import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { channels, contactNotes, contacts, contactTags, deals, libraryFiles, messages, outbox, settings, tags, teams, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import { recordInbound, recordOutbound } from "./deals";
import { drainOutbox } from "./outbox";
import { saveWelcomeMenu, welcomeText } from "./welcome-menu";
import { saveFuncao } from "./funcoes";
import { setWhatsappProvider } from "../whatsapp/evolution";

const OPEN: [string, string] = ["09:00", "18:00"];
const HOURS = { 0: null, 1: null, 2: OPEN, 3: OPEN, 4: OPEN, 5: OPEN, 6: OPEN };
const T0 = new Date("2026-10-20T13:00:00Z"); // terça 10:00
const plus = (min: number) => new Date(T0.getTime() + min * 60_000);
const MENU = { enabled: true, intro: "Olá! Bem-vinda à Casa Fiaes. Responda com o número:", options: [{ label: "Agendar horário", tag: "Quer agendar" }, { label: "Saber preços", tag: null }] };
const sent: string[] = [];
const fake = {
  createInstance: async () => {}, connect: async () => ({ status: "conectado" as const }), state: async () => "conectado" as const, logout: async () => {}, remove: async () => {},
  sendText: async (_i: string, _t: string, text: string) => { sent.push(text); return { externalId: `W${sent.length}` }; },
};
let uid = "";
const inbound = (id: string, body = "Oi", at = T0, phone = "71999990101") =>
  recordInbound({ channelId: null, externalId: id, phoneRaw: phone, pushName: "Cliente Teste", body, at, now: at });
const dealOf = async (r: Awaited<ReturnType<typeof inbound>>) => { if (!("dealId" in r)) throw new Error("sem lead"); return r.dealId; };

beforeEach(async () => {
  sent.length = 0;
  await resetDb();
  await db.insert(settings).values({ key: "business_hours", value: HOURS });
  [{ id: uid }] = await db.insert(users).values({ name: "Thaíse Teste", email: "gestao@teste.local", role: "gestor", passwordHash: "x" }).returning();
  await db.insert(channels).values({ name: "Recepção", instanceName: "rec-teste", status: "conectado", phone: "+557133330000" });
  setWhatsappProvider(fake);
});
afterEach(() => setWhatsappProvider(null));

describe("menu de boas-vindas", () => {
  it("nasce desligado: número novo não recebe nada", async () => {
    await inbound("M1");
    expect(await db.select().from(outbox)).toHaveLength(0);
  });

  it("ligado e Casa aberta: número novo recebe o menu, uma vez", async () => {
    await saveWelcomeMenu(MENU, uid);
    await inbound("M1");
    await inbound("M2", "?", plus(1));
    const items = await db.select().from(outbox);
    expect(items).toHaveLength(1);
    expect(items[0].text).toBe("Olá! Bem-vinda à Casa Fiaes. Responda com o número:\n\n1. Agendar horário\n2. Saber preços");
    expect(welcomeText(MENU)).toBe(items[0].text);
  });

  it("quem já conversou antes e a Casa fechada não recebem o menu", async () => {
    await saveWelcomeMenu(MENU, uid);
    const [c] = await db.insert(contacts).values({ name: "Antiga Teste", phoneE164: "+5571999990102" }).returning();
    await db.insert(messages).values({ contactId: c.id, direction: "in", kind: "text", body: "oi", status: "received", createdAt: new Date("2026-08-01T13:00:00Z") });
    await inbound("M3", "Oi de novo", T0, "71999990102");
    await inbound("M4", "Oi", new Date("2026-10-19T13:00:00Z"), "71999990103"); // segunda: Casa fechada
    expect(await db.select().from(outbox)).toHaveLength(0);
  });

  it("na hora de enviar: desligado ou a Casa já respondeu, o menu não sai", async () => {
    await saveWelcomeMenu(MENU, uid);
    await inbound("M1");
    await saveWelcomeMenu({ ...MENU, enabled: false }, uid);
    expect((await drainOutbox(plus(1))).cancelled).toBe(1);
    await saveWelcomeMenu(MENU, uid);
    const d = await dealOf(await inbound("M5", "Oi", plus(2), "71999990104"));
    await recordOutbound({ dealId: d, channelId: null, body: "Oi! Sou a Thaíse, como posso ajudar?", userId: uid, at: plus(3) });
    expect((await drainOutbox(plus(4))).cancelled).toBe(1);
    expect(sent).toHaveLength(0);
  });

  it("a resposta ao menu vira etiqueta e nota para quem atender; depois de alguém da equipe responder, “1” é só mensagem", async () => {
    await saveWelcomeMenu(MENU, uid);
    const d = await dealOf(await inbound("M1"));
    expect((await drainOutbox(plus(1))).sent).toBe(1);
    await inbound("M2", "1", plus(2));
    const contactId = (await db.select().from(deals).where(eq(deals.id, d)))[0].contactId;
    const t = await db.select({ name: tags.name }).from(contactTags).innerJoin(tags, eq(tags.id, contactTags.tagId)).where(eq(contactTags.contactId, contactId));
    expect(t.map((x) => x.name)).toEqual(["Quer agendar"]);
    expect((await db.select().from(contactNotes))[0]).toMatchObject({ source: "menu", authorName: "Menu de boas-vindas", body: "Escolheu no menu: 1. Agendar horário" });
    await recordOutbound({ dealId: d, channelId: null, body: "Claro! Qual dia?", userId: uid, at: plus(3) });
    await inbound("M3", "2", plus(4));
    expect(await db.select().from(contactNotes)).toHaveLength(1);
  });

  it("ligar sem saudação ou com menos de 2 opções é recusado", async () => {
    await expect(saveWelcomeMenu({ enabled: true, intro: "Oi", options: [{ label: "Agendar" }] }, uid)).rejects.toThrow(/pelo menos 2 opções/);
  });
  it("ligação de número novo não recebe o menu (nem a perdida nem a atendida)", async () => {
    await saveWelcomeMenu(MENU, uid);
    await recordInbound({ channelId: null, externalId: "call:1", phoneRaw: "71999990105", kind: "call", body: "Ligação perdida", at: T0, now: T0 });
    await recordInbound({ channelId: null, externalId: "call:2", phoneRaw: "71999990106", kind: "call", body: "Ligação recebida · atendida", noWait: true, at: T0, now: T0 });
    expect(await db.select().from(outbox)).toHaveLength(0);
  });

});

describe("menu que encaminha e responde", () => {
  const tagsOf = async (dealId: string) => {
    const [d] = await db.select().from(deals).where(eq(deals.id, dealId));
    return (await db.select({ name: tags.name }).from(contactTags).innerJoin(tags, eq(tags.id, contactTags.tagId)).where(eq(contactTags.contactId, d.contactId))).map((x) => x.name).sort();
  };
  const teamId = async (name: string) => (await db.select().from(teams).where(eq(teams.name, name)))[0].id;
  const notes = async () => (await db.select().from(contactNotes)).map((n) => n.body);
  const queued = async () => (await db.select().from(outbox)).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  /** Menu ligado, número novo, menu enviado. */
  const start = async (menu: unknown) => {
    await saveWelcomeMenu(menu, uid);
    const d = await dealOf(await inbound("M1"));
    expect((await drainOutbox(plus(1))).sent).toBe(1);
    return d;
  };

  it("opção que responde: a resposta entra na fila com o texto da gestão e a etiqueta é posta", async () => {
    const [f] = await db.insert(libraryFiles).values({ name: "Tabela de preços.pdf", path: "biblioteca/x.pdf", mime: "application/pdf", kind: "document" }).returning();
    const d = await start({ ...MENU, options: [MENU.options[0], { label: "Saber preços", tag: "Quer preços", reply: { text: "Segue a nossa tabela 💛", fileId: f.id } }] });
    await inbound("M2", "2️⃣", plus(2));
    expect(await tagsOf(d)).toEqual(["Quer preços"]);
    expect(await notes()).toEqual(["Escolheu no menu: 2. Saber preços"]);
    const items = (await queued()).slice(1);
    expect(items.map((i) => [i.kind, i.text, (i.options as { source?: string }).source])).toEqual([
      ["text", "Segue a nossa tabela 💛", "menu_boas_vindas:resposta"],
      ["media", "Tabela de preços.pdf", "menu_boas_vindas:resposta"],
    ]);
    expect((items[1].options as { fileId?: string; caption?: string }).fileId).toBe(f.id);
    expect((items[1].options as { caption?: string }).caption).toBeUndefined(); // arquivo sem legenda
    // O menu já saiu (a Casa "já escreveu"), mas a resposta é a continuação dele: sai. O arquivo apagado da Biblioteca não sai.
    await db.update(libraryFiles).set({ deletedAt: plus(2) }).where(eq(libraryFiles.id, f.id));
    expect(await drainOutbox(plus(3))).toMatchObject({ sent: 1, cancelled: 1 });
    expect(sent).toEqual([welcomeText(MENU), "Segue a nossa tabela 💛"]);
  });

  it("opção que passa para o setor Método Fiaes®: chama passToTeam e deixa a nota 'Escolheu no menu: 2. Método Fiaes®'", async () => {
    const metodo = await teamId("Método Fiaes®");
    const d = await start({ ...MENU, options: [MENU.options[0], { label: "Método Fiaes®", passTo: { team: metodo } }] });
    await inbound("M2", "opção 2", plus(2));
    expect(await notes()).toEqual(["Escolheu no menu: 2. Método Fiaes®"]);
    expect((await db.select().from(deals).where(eq(deals.id, d)))[0].teamId).toBe(metodo);
    expect(await queued()).toHaveLength(1); // passar para não manda nada para a cliente
  });

  it("passar para setor com a função Setores desligada: registra a nota, não passa e faz o resto", async () => {
    const metodo = await teamId("Método Fiaes®");
    const d = await start({ ...MENU, options: [MENU.options[0], { label: "Método Fiaes®", tag: "Método", reply: { text: "Já te passo para a equipe do Método Fiaes® 💛" }, passTo: { team: metodo } }] });
    await saveFuncao("setores", { on: false }, uid);
    await inbound("M2", "2", plus(2));
    expect(await notes()).toEqual(["Escolheu no menu: 2. Método Fiaes®"]);
    expect(await tagsOf(d)).toEqual(["Método"]);
    expect((await db.select().from(deals).where(eq(deals.id, d)))[0].teamId).toBeNull();
    expect((await queued()).slice(1).map((i) => i.text)).toEqual(["Já te passo para a equipe do Método Fiaes® 💛"]);
  });

  it("opção que passa para uma pessoa: a conversa fica com ela", async () => {
    const [{ id: sara }] = await db.insert(users).values({ name: "Sara Teste", email: "sara@teste.local", role: "atendente", passwordHash: "x" }).returning();
    const d = await start({ ...MENU, options: [{ label: "Falar com Sara", passTo: { user: sara } }, MENU.options[1]] });
    await db.update(deals).set({ ownerId: null }).where(eq(deals.id, d)); // começa sem dona, qualquer que seja a distribuição
    await inbound("M2", "1", plus(2));
    expect((await db.select().from(deals).where(eq(deals.id, d)))[0].ownerId).toBe(sara);
  });

  it("opção com submenu: manda o submenu; '1' depois disso vale para o submenu, não para o menu de cima", async () => {
    const d = await start({ ...MENU, options: [MENU.options[0], { label: "Método Fiaes®", submenu: { intro: "Sobre o Método Fiaes®:", options: [{ label: "Primeira avaliação", tag: "Avaliação" }, { label: "Já sou cliente", tag: null }] } }] });
    await inbound("M2", "2", plus(2));
    const sub = (await queued())[1];
    expect(sub.text).toBe("Sobre o Método Fiaes®:\n\n1. Primeira avaliação\n2. Já sou cliente");
    expect((sub.options as { source?: string }).source).toBe("menu_boas_vindas:1");
    expect((await drainOutbox(plus(3))).sent).toBe(1); // o menu de cima já saiu, mas ninguém da Casa escreveu: o submenu sai
    await inbound("M3", "1", plus(4));
    expect(await tagsOf(d)).toEqual(["Avaliação"]);
    expect(await notes()).toEqual(["Escolheu no menu: 2. Método Fiaes®", "Escolheu no menu: 2. Método Fiaes® › 1. Primeira avaliação"]);
    // Já escolheu no submenu: "2" agora é só mensagem.
    await inbound("M4", "2", plus(5));
    expect(await notes()).toHaveLength(2);
  });

  it("submenu na fila e alguém da equipe escreve: o submenu não sai", async () => {
    const d = await start({ ...MENU, options: [MENU.options[0], { label: "Método Fiaes®", submenu: { intro: "Sobre o Método Fiaes®:", options: [{ label: "Primeira avaliação" }, { label: "Já sou cliente" }] } }] });
    await inbound("M2", "2", plus(2));
    await recordOutbound({ dealId: d, channelId: null, body: "Oi! Sou a Thaíse.", userId: uid, at: plus(3) });
    expect((await drainOutbox(plus(4))).cancelled).toBe(1);
  });

  it("alguém da equipe escreveu depois do menu: a resposta da cliente não é mais escolha (igual a hoje)", async () => {
    const metodo = await teamId("Método Fiaes®");
    const d = await start({ ...MENU, options: [MENU.options[0], { label: "Método Fiaes®", tag: "Método", reply: { text: "Oi" }, passTo: { team: metodo } }] });
    await recordOutbound({ dealId: d, channelId: null, body: "Oi! Sou a Thaíse, como posso ajudar?", userId: uid, at: plus(2) });
    await inbound("M2", "2", plus(3));
    expect(await notes()).toEqual([]);
    expect(await tagsOf(d)).toEqual([]);
    expect(await queued()).toHaveLength(1);
    expect((await db.select().from(deals).where(eq(deals.id, d)))[0].teamId).toBeNull();
  });

  it("frase com número não é escolha: a equipe atende", async () => {
    const d = await start(MENU);
    await inbound("M2", "tenho 2 filhas", plus(2));
    await inbound("M3", "dois horários", plus(3));
    expect(await notes()).toEqual([]);
    expect(await tagsOf(d)).toEqual([]);
  });

  it("menu salvo no formato antigo continua funcionando (só etiqueta e nota)", async () => {
    await db.insert(settings).values({ key: "menu_boas_vindas", value: { enabled: true, intro: "Olá! Responda com o número:", options: [{ label: "Agendar horário", tag: "Quer agendar" }, { label: "Saber preços", tag: null }] } });
    const d = await dealOf(await inbound("M1"));
    expect((await drainOutbox(plus(1))).sent).toBe(1);
    await inbound("M2", "1", plus(2));
    expect(await tagsOf(d)).toEqual(["Quer agendar"]);
    expect(await notes()).toEqual(["Escolheu no menu: 1. Agendar horário"]);
    expect(await queued()).toHaveLength(1);
  });

  it("salvar recusa terceiro nível, opção sem nome e passar para setor inativo", async () => {
    const deep = { label: "Fundo", submenu: { intro: "Mais um", options: [{ label: "a" }, { label: "b" }] } };
    await expect(saveWelcomeMenu({ ...MENU, options: [MENU.options[0], { label: "Método Fiaes®", submenu: { intro: "Sobre:", options: [deep, { label: "Outra" }] } }] }, uid))
      .rejects.toThrow("O menu tem no máximo 2 níveis.");
    await expect(saveWelcomeMenu({ ...MENU, options: [MENU.options[0], { label: "Método Fiaes®", submenu: { intro: "Sobre:", options: [{ label: " " }, { label: "Outra" }] } }] }, uid))
      .rejects.toThrow("Escreva o nome da opção.");
    await expect(saveWelcomeMenu({ ...MENU, options: [MENU.options[0], { label: "Método Fiaes®", submenu: { intro: "Sobre:", options: [{ label: "Só uma" }] } }] }, uid))
      .rejects.toThrow(/de 2 a 6 opções/);
    const servicos = await teamId("Serviços gerais");
    await db.update(teams).set({ active: false }).where(eq(teams.id, servicos));
    await expect(saveWelcomeMenu({ ...MENU, options: [MENU.options[0], { label: "Unhas", passTo: { team: servicos } }] }, uid)).rejects.toThrow(/setor desativado/);
    await expect(saveWelcomeMenu({ ...MENU, options: [MENU.options[0], { label: "Preços", reply: { text: " ", fileId: null } }] }, uid)).rejects.toThrow(/Escreva a resposta ou escolha um arquivo/);
    expect(await db.select().from(settings).where(eq(settings.key, "menu_boas_vindas"))).toHaveLength(0);
  });
});

