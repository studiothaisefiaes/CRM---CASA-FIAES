import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { alerts, channels, contacts, deals, messages, users } from "../db/schema";
import { recordInbound } from "./deals";
import { setWhatsappProvider } from "../whatsapp/evolution";
import { save } from "../whatsapp/media";
import { ProviderError } from "../whatsapp/provider";
import { resetDb } from "../../../test/db";
import { saveFuncao } from "./funcoes";
import { FORWARD_MAX, forwardInBackground, forwardMessage, forwardMessages, prepareForward } from "./forward";

type Media = { name: string; mime: string; mediatype: string; caption: string | null };
const texts: { to: string; text: string }[] = [];
const medias: { to: string; caption: string | null }[] = [];
const audios: string[] = [];
const failFor = new Set<string>();
/** Recusa explícita da Evolution (400): com certeza NÃO saiu, dá para seguir com as próximas. Erro sem status = pode ter saído. */
const recusou = () => new ProviderError("falhou", 400);
/** Ordem de tudo o que saiu, por destino ("telefone|tipo|conteúdo"): as várias mensagens têm de sair na ordem da conversa. */
const log: string[] = [];
let n = 0;
const fake = {
  createInstance: async () => {}, connect: async () => ({ status: "conectado" as const }), state: async () => "conectado" as const, logout: async () => {}, remove: async () => {},
  sendText: async (_i: string, to: string, text: string) => { if (failFor.has(to) || text.includes("FALHA")) throw recusou(); texts.push({ to, text }); log.push(`${to}|T|${text}`); return { externalId: `T${++n}` }; },
  sendMedia: async (_i: string, to: string, f: Media, caption: string | null) => { if (failFor.has(to)) throw recusou(); medias.push({ to, caption }); log.push(`${to}|M|${f.mediatype}|${caption ?? ""}`); return { externalId: `M${++n}` }; },
  sendAudio: async (_i: string, to: string) => { audios.push(to); log.push(`${to}|A`); return { externalId: `A${++n}` }; },
};
// PNG mínimo válido (assinatura + IHDR); o servidor reconhece o tipo pelos bytes.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
let uid = "", gestor = "", chId = "", srcDeal = "", photoId = "", textId = "";
const dealOf = async (phone: string, name: string, kind: "cliente" | "equipe" = "cliente") => {
  const r = await recordInbound({ channelId: chId, externalId: `IN-${phone}`, phoneRaw: phone, body: "oi", pushName: name });
  if (!("dealId" in r)) throw new Error("sem conversa");
  await db.update(contacts).set({ name, kind }).where(eq(contacts.id, (await db.select().from(deals).where(eq(deals.id, r.dealId)))[0].contactId));
  return r.dealId;
};

beforeEach(async () => {
  texts.length = 0; medias.length = 0; audios.length = 0; log.length = 0; failFor.clear(); n = 0;
  await resetDb(); setWhatsappProvider(fake as never);
  [{ id: uid }] = await db.insert(users).values({ name: "Cati Souza", email: "cati@c.com", role: "atendente", passwordHash: "x" }).returning();
  [{ id: gestor }] = await db.insert(users).values({ name: "Thaise", email: "t@c.com", role: "gestor", passwordHash: "x" }).returning();
  [{ id: chId }] = await db.insert(channels).values({ name: "Rec", instanceName: "rec", status: "conectado", phone: "+557199990404" }).returning();
  srcDeal = await dealOf("71999995555", "Maria Souza");
  const [d] = await db.select().from(deals).where(eq(deals.id, srcDeal));
  await save("fwd-foto.png", PNG);
  [{ id: photoId }] = await db.insert(messages).values({ dealId: srcDeal, contactId: d.contactId, channelId: chId, direction: "in", kind: "image", body: null, mediaPath: "fwd-foto.png", mediaMime: "image/png", status: "received", externalId: "IMG1", createdAt: new Date("2026-10-20T13:00:00Z") }).returning({ id: messages.id });
  [{ id: textId }] = await db.insert(messages).values({ dealId: srcDeal, contactId: d.contactId, channelId: chId, direction: "in", kind: "text", body: "Quero horário sexta", status: "received", externalId: "TX1", createdAt: new Date("2026-10-20T13:05:00Z") }).returning({ id: messages.id });
});
afterEach(() => setWhatsappProvider(null));

describe("encaminhar", () => {
  it("para conversa de Equipe vai com o cabeçalho com o nome da cliente e o horário", async () => {
    const eq1 = await dealOf("71988880001", "Sara Lima", "equipe");
    const r = await forwardMessage(photoId, [eq1], uid);
    expect(r).toEqual({ sent: 1, failed: [] });
    expect(medias[0].caption).toBe("Encaminhada da conversa com Maria Souza, 20/10 às 10:00:");
  });
  it("texto para Equipe leva o cabeçalho na frente", async () => {
    const eq1 = await dealOf("71988880001", "Sara Lima", "equipe");
    await forwardMessage(textId, [eq1], uid);
    expect(texts[0].text).toContain("Encaminhada da conversa com Maria Souza, 20/10 às 10:05:\nQuero horário sexta");
  });
  it("para outra cliente vai só o conteúdo: sem nome, telefone nem legenda de origem", async () => {
    const outra = await dealOf("71988880002", "Joana Reis");
    await forwardMessage(photoId, [outra], uid);
    expect(medias[0].caption).toBeNull();
    await forwardMessage(textId, [outra], uid);
    expect(texts[0].text).toContain("Quero horário sexta");
    expect(texts[0].text).not.toMatch(/Maria|Encaminhada|5555/);
  });
  it("mais de 10 destinos é recusado; destino que falha não impede os outros", async () => {
    await expect(forwardMessage(textId, Array.from({ length: FORWARD_MAX + 1 }, (_, i) => `00000000-0000-4000-8000-0000000000${String(i).padStart(2, "0")}`), uid)).rejects.toThrow(`Dá para encaminhar para até ${FORWARD_MAX} conversas de uma vez.`);
    const a = await dealOf("71988880003", "A"), b = await dealOf("71988880004", "B");
    failFor.add("+5571988880003");
    const r = await forwardMessage(textId, [a, b], uid);
    expect(r.sent).toBe(1);
    expect(r.failed).toHaveLength(1);
    expect(r.failed[0].dealId).toBe(a);
  });
  it("o limite vem de Configurações › Recursos", async () => {
    await saveFuncao("encaminhar", { params: { max_destinos: 1 } }, gestor, { confirmouEnvio: false });
    const a = await dealOf("71988880003", "A"), b = await dealOf("71988880004", "B");
    await expect(forwardMessage(textId, [a, b], uid)).rejects.toThrow("até 1 conversas");
  });
  it("função desligada recusa", async () => {
    await saveFuncao("encaminhar", { on: false }, gestor, { confirmouEnvio: false });
    const a = await dealOf("71988880003", "A");
    await expect(forwardMessage(textId, [a], uid)).rejects.toThrow("Encaminhar mensagem está desligada em Configurações › Recursos.");
    expect(texts).toEqual([]);
  });
  it("o cabeçalho é um texto editável", async () => {
    await saveFuncao("encaminhar", { textos: { cabecalho_equipe: "Veio de {nome} ({data})" } }, gestor, { confirmouEnvio: false });
    const eq1 = await dealOf("71988880001", "Sara Lima", "equipe");
    await forwardMessage(photoId, [eq1], uid);
    expect(medias[0].caption).toBe("Veio de Maria Souza (20/10 às 10:00)");
  });
  it("mídia já apagada pela retenção: 'Essa foto não está mais guardada no sistema.'", async () => {
    await db.update(messages).set({ mediaPurgedAt: new Date() }).where(eq(messages.id, photoId));
    const a = await dealOf("71988880003", "A");
    await expect(forwardMessage(photoId, [a], uid)).rejects.toThrow("Essa foto não está mais guardada no sistema.");
  });
  it("nota interna, ligação e mensagem apagada não podem ser encaminhadas", async () => {
    const a = await dealOf("71988880003", "A");
    const [d] = await db.select().from(deals).where(eq(deals.id, srcDeal));
    const [nota] = await db.insert(messages).values({ dealId: srcDeal, contactId: d.contactId, direction: "out", kind: "nota", body: "interna", status: "sent" }).returning();
    const [lig] = await db.insert(messages).values({ dealId: srcDeal, contactId: d.contactId, direction: "in", kind: "call", body: null, status: "received" }).returning();
    await db.update(messages).set({ deletedAt: new Date() }).where(eq(messages.id, textId));
    for (const id of [nota.id, lig.id, textId]) await expect(forwardMessage(id, [a], uid)).rejects.toThrow("Essa mensagem não pode ser encaminhada.");
    expect(texts).toEqual([]);
  });
  it("destino repetido conta uma vez", async () => {
    const a = await dealOf("71988880003", "A");
    expect((await forwardMessage(textId, [a, a], uid)).sent).toBe(1);
  });
  it("destino que não existe falha sozinho", async () => {
    const r = await forwardMessage(textId, ["00000000-0000-4000-8000-000000000000"], uid);
    expect(r.sent).toBe(0);
    expect(r.failed[0].error).toBe("Conversa não encontrada.");
  });
});

/** Encaminhar várias de uma vez (Cati 24/10: encaminhava 6 itens de uma cliente, um por um). */
describe("encaminhar várias", () => {
  const textMsg = async (body: string, at: string) => {
    const [d] = await db.select().from(deals).where(eq(deals.id, srcDeal));
    const [r] = await db.insert(messages).values({ dealId: srcDeal, contactId: d.contactId, channelId: chId, direction: "in", kind: "text", body, status: "received", externalId: `X-${body}`, createdAt: new Date(at) }).returning({ id: messages.id });
    return r.id;
  };
  /** O conteúdo que saiu para um destino, sem a assinatura da atendente (1ª linha do texto). */
  const sentTo = (phone: string) => log.filter((l) => l.startsWith(`${phone}|`)).map((l) => l.slice(phone.length + 1).replace(/^T\|\*[^\n]*\*\n/, "T|"));

  it("saem na ordem em que foram escritas na conversa, não na ordem em que foram marcadas", async () => {
    const antes = await textMsg("Bom dia", "2026-10-20T12:50:00Z");
    const outra = await dealOf("71988880002", "Joana Reis");
    const r = await forwardMessages([textId, photoId, antes], [outra], uid);
    expect(r).toEqual({ sent: 1, messages: 3, failed: [] });
    expect(sentTo("+5571988880002")).toEqual(["T|Bom dia", "M|image|", "T|Quero horário sexta"]);
  });
  it("para Equipe o cabeçalho vai uma vez só, no começo, e cada item vai sem repetir", async () => {
    const eq1 = await dealOf("71988880001", "Sara Lima", "equipe");
    await forwardMessages([photoId, textId], [eq1], uid);
    expect(sentTo("+5571988880001")).toEqual(["T|Encaminhadas da conversa com Maria Souza:", "M|image|", "T|Quero horário sexta"]);
  });
  it("o cabeçalho de várias é um texto editável em Configurações › Recursos", async () => {
    await saveFuncao("encaminhar", { textos: { cabecalho_equipe_varias: "De {nome}:" } }, gestor, { confirmouEnvio: false });
    const eq1 = await dealOf("71988880001", "Sara Lima", "equipe");
    await forwardMessages([photoId, textId], [eq1], uid);
    expect(sentTo("+5571988880001")[0]).toBe("T|De Maria Souza:");
  });
  it("uma só pelo caminho de várias continua igual à de uma (cabeçalho com a data junto da foto)", async () => {
    const eq1 = await dealOf("71988880001", "Sara Lima", "equipe");
    await forwardMessages([photoId], [eq1], uid);
    expect(sentTo("+5571988880001")).toEqual(["M|image|Encaminhada da conversa com Maria Souza, 20/10 às 10:00:"]);
  });
  it("o limite de mensagens por vez vem de Configurações › Recursos (padrão 30)", async () => {
    const a = await dealOf("71988880003", "A");
    const ids = Array.from({ length: 31 }, (_, i) => `00000000-0000-4000-8000-0000000001${String(i).padStart(2, "0")}`);
    await expect(forwardMessages(ids, [a], uid)).rejects.toThrow("Dá para encaminhar até 30 mensagens de uma vez.");
    await saveFuncao("encaminhar", { params: { max_mensagens: 1 } }, gestor, { confirmouEnvio: false });
    await expect(forwardMessages([photoId, textId], [a], uid)).rejects.toThrow("Dá para encaminhar até 1 mensagens de uma vez.");
    expect(log).toEqual([]);
  });
  it("mensagens de pessoas diferentes são recusadas e nada sai", async () => {
    const a = await dealOf("71988880003", "A");
    const [deOutra] = await db.select({ id: messages.id }).from(messages).where(eq(messages.dealId, a));
    await expect(forwardMessages([textId, deOutra.id], [a], uid)).rejects.toThrow("As mensagens precisam ser da mesma conversa.");
    expect(log).toEqual([]);
  });
  it("cliente que voltou: a tela junta as conversas dela, então mensagem da conversa antiga entra junto com a de hoje", async () => {
    // A conversa da tela mostra as mensagens do CONTATO (getDealDetail filtra por contactId); a conversa antiga fechou e a de hoje é outra.
    const [velho] = await db.select().from(deals).where(eq(deals.id, srcDeal));
    await db.update(deals).set({ closedAt: new Date("2026-10-21T12:00:00Z") }).where(eq(deals.id, srcDeal));
    const { id: _id, ...resto } = velho; void _id;
    const [novo] = await db.insert(deals).values({ ...resto, closedAt: null, createdAt: new Date("2026-10-24T12:00:00Z") }).returning({ id: deals.id });
    const [hoje] = await db.insert(messages).values({ dealId: novo.id, contactId: velho.contactId, channelId: chId, direction: "in", kind: "text", body: "Voltei", status: "received", externalId: "TX-HOJE", createdAt: new Date("2026-10-24T12:00:00Z") }).returning({ id: messages.id });
    const outra = await dealOf("71988880002", "Joana Reis");
    const r = await forwardMessages([hoje.id, photoId], [outra], uid);
    expect(r).toMatchObject({ sent: 1, messages: 2, failed: [] });
    expect(sentTo("+5571988880002")).toEqual(["M|image|", "T|Voltei"]);
  });
  it("uma que não pode ser encaminhada (apagada, ligação) recusa o pedido inteiro", async () => {
    const a = await dealOf("71988880003", "A");
    await db.update(messages).set({ deletedAt: new Date() }).where(eq(messages.id, textId));
    await expect(forwardMessages([photoId, textId], [a], uid)).rejects.toThrow("Uma das mensagens escolhidas não pode ser encaminhada.");
    expect(log).toEqual([]);
  });
  it("dentro de um destino, a que falha não impede as próximas e é relatada; destino que falha inteiro não impede os outros", async () => {
    const falha = await textMsg("FALHA aqui", "2026-10-20T13:02:00Z");
    const a = await dealOf("71988880003", "A"), b = await dealOf("71988880004", "B");
    failFor.add("+5571988880004");
    const r = await forwardMessages([photoId, falha, textId], [a, b], uid);
    expect(r.sent).toBe(0);
    expect(r.messages).toBe(3);
    expect(sentTo("+5571988880003")).toEqual(["M|image|", "T|Quero horário sexta"]);
    expect(r.failed).toEqual([
      { dealId: a, error: expect.any(String), messageIds: [falha] },
      { dealId: b, error: expect.any(String), messageIds: [photoId, falha, textId] },
    ]);
  });
  it("foto que não está mais guardada falha em todos os destinos e as outras saem; se nenhuma está guardada, recusa", async () => {
    await db.update(messages).set({ mediaPurgedAt: new Date() }).where(eq(messages.id, photoId));
    const a = await dealOf("71988880003", "A");
    const r = await forwardMessages([photoId, textId], [a], uid);
    expect(r.failed).toEqual([{ dealId: a, error: "Essa foto não está mais guardada no sistema.", messageIds: [photoId] }]);
    expect(sentTo("+5571988880003")).toEqual(["T|Quero horário sexta"]);
    await expect(forwardMessages([photoId], [a], uid)).rejects.toThrow("Essa foto não está mais guardada no sistema.");
  });
  it("WhatsApp sem resposta (pode ter saído): para tudo o que falta, em todos os destinos, sem esperar outro tempo esgotado", async () => {
    const a = await dealOf("71988880003", "A"), b = await dealOf("71988880004", "B");
    const lento = await textMsg("LENTO", "2026-10-20T13:02:00Z");
    // O primeiro envio de A sai, o segundo não responde (timeout/rede: a Evolution pode ter recebido): nada mais é tentado.
    const sendText = fake.sendText;
    fake.sendText = async (i: string, to: string, text: string) => { if (text.includes("LENTO")) throw new Error("The operation was aborted due to timeout"); return sendText(i, to, text); };
    try {
      const r = await forwardMessages([photoId, lento, textId], [a, b], uid);
      expect(sentTo("+5571988880003")).toEqual(["M|image|"]);
      expect(sentTo("+5571988880004")).toEqual([]);
      expect(r.sent).toBe(0);
      expect(r.stopped).toBe(true);
      expect(r.failed).toEqual([
        { dealId: a, error: expect.stringMatching(/confira no whatsapp/i), messageIds: [lento, textId] },
        { dealId: b, error: expect.stringMatching(/não foi tentad/i) },
      ]);
    } finally { fake.sendText = sendText; }
  });
  it("foto/vídeo sem resposta do WhatsApp também para o resto (o arquivo pode ter saído)", async () => {
    const a = await dealOf("71988880003", "A"), b = await dealOf("71988880004", "B");
    const sendMedia = fake.sendMedia;
    fake.sendMedia = async () => { throw new Error("fetch failed"); };
    try {
      const r = await forwardMessages([photoId, textId], [a, b], uid);
      expect(log).toEqual([]);
      expect(r.failed).toEqual([
        { dealId: a, error: expect.any(String), messageIds: [photoId, textId] },
        { dealId: b, error: expect.stringMatching(/não foi tentad/i) },
      ]);
    } finally { fake.sendMedia = sendMedia; }
  });
  it("nenhuma mensagem escolhida é recusada", async () => {
    const a = await dealOf("71988880003", "A");
    await expect(forwardMessages([], [a], uid)).rejects.toThrow("Escolha as mensagens para encaminhar.");
  });
});

describe("conferir antes de abrir conversa e enviar em segundo plano", () => {
  /** Só os avisos do encaminhar (as conversas de teste também geram "Fulana escreveu"). */
  const avisos = () => db.select().from(alerts).where(eq(alerts.type, "encaminhar_falhou")).orderBy(alerts.message);
  it("prepareForward confere tudo sem enviar nada: limite, mesma pessoa, apagada, mídia toda sumida, destinos", async () => {
    const a = await dealOf("71988880003", "A");
    const [deOutra] = await db.select({ id: messages.id }).from(messages).where(eq(messages.dealId, a));
    await expect(prepareForward([textId, deOutra.id], 1)).rejects.toThrow("As mensagens precisam ser da mesma conversa.");
    await expect(prepareForward([textId], 0)).rejects.toThrow("Escolha para quem encaminhar.");
    await expect(prepareForward([textId], FORWARD_MAX + 1)).rejects.toThrow(`Dá para encaminhar para até ${FORWARD_MAX} conversas de uma vez.`);
    await saveFuncao("encaminhar", { params: { max_mensagens: 1 } }, gestor, { confirmouEnvio: false });
    await expect(prepareForward([photoId, textId], 1)).rejects.toThrow("Dá para encaminhar até 1 mensagens de uma vez.");
    await db.update(messages).set({ mediaPurgedAt: new Date() }).where(eq(messages.id, photoId));
    await expect(prepareForward([photoId], 1)).rejects.toThrow("Essa foto não está mais guardada no sistema.");
    await db.update(messages).set({ deletedAt: new Date() }).where(eq(messages.id, textId));
    await expect(prepareForward([textId], 1)).rejects.toThrow("Essa mensagem não pode ser encaminhada.");
    expect(log).toEqual([]);
  });
  it("tudo saiu: nenhum aviso no sino", async () => {
    const a = await dealOf("71988880003", "A");
    await forwardInBackground(await prepareForward([photoId, textId], 1), [a], uid);
    expect(log).toHaveLength(2);
    expect(await avisos()).toEqual([]);
  });
  it("o que não saiu vira aviso no sino de quem encaminhou, um por conversa, dizendo quais mensagens (tipo e hora) e o motivo", async () => {
    const [d] = await db.select().from(deals).where(eq(deals.id, srcDeal));
    const [falha] = await db.insert(messages).values({ dealId: srcDeal, contactId: d.contactId, channelId: chId, direction: "in", kind: "text", body: "FALHA aqui", status: "received", externalId: "X-FALHA", createdAt: new Date("2026-10-20T13:02:00Z") }).returning({ id: messages.id });
    const a = await dealOf("71988880003", "Ana Lima"), b = await dealOf("71988880004", "Bia Reis");
    failFor.add("+5571988880004");
    await forwardInBackground(await prepareForward([photoId, falha.id, textId], 2), [a, b], uid);
    const rows = await avisos();
    expect(rows.map((r) => ({ dealId: r.dealId, userId: r.userId, audience: r.audience, type: r.type }))).toEqual([
      { dealId: a, userId: uid, audience: "responsavel", type: "encaminhar_falhou" },
      { dealId: b, userId: uid, audience: "responsavel", type: "encaminhar_falhou" },
    ]);
    expect(rows[0].message).toBe("Encaminhamento para Ana Lima: 1 de 3 não saiu (mensagem de 20/10 às 10:02). Não foi possível enviar: falhou.");
    expect(rows[1].message).toBe("Encaminhamento para Bia Reis: as 3 mensagens não saíram. Não foi possível enviar: falhou.");
  });
  it("conversa de destino que sumiu: o aviso sai sem link para ela (e o das outras continua)", async () => {
    const a = await dealOf("71988880003", "A");
    failFor.add("+5571988880003");
    await forwardInBackground(await prepareForward([textId], 2), [a, "00000000-0000-4000-8000-000000000077"], uid);
    const rows = await avisos();
    expect(rows.map((r) => [r.dealId, r.message])).toEqual([
      [a, "Encaminhamento para A: não saiu. Não foi possível enviar: falhou."],
      [null, "Encaminhamento para uma conversa que não existe mais: não saiu. Conversa não encontrada."],
    ]);
  });
});
