import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { channels, outbox, settings, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import { setWhatsappProvider } from "../whatsapp/evolution";
import { fillName } from "../../lib/auto-message-text";
import { recordInbound } from "./deals";
import { archiveConversation } from "./conversation-archive";
import { drainOutbox } from "./outbox";
import { getAutoMessage, saveAutoMessage, saveAutoMessageAsReply } from "./auto-message-settings";
import { quickRepliesFor } from "./quick-replies";

// Provider falso (como em outbox.test.ts): nenhum teste fala com a Evolution nem envia mensagem real.
const sent: string[] = [];
const fake = {
  createInstance: async () => {}, connect: async () => ({ status: "conectado" as const }), state: async () => "conectado" as const, logout: async () => {}, remove: async () => {},
  sendText: async (_i: string, _to: string, text: string) => { sent.push(text); return { externalId: "OUT" + sent.length }; },
  sendPoll: async () => ({ externalId: "POLL1" }),
};
const OPEN = new Date("2026-10-13T13:00:00Z");   // terça 10h em Salvador: aberta no horário padrão
const CLOSED = new Date("2026-10-13T02:00:00Z"); // segunda 23h: fechada
let g = "", chId = "";

beforeEach(async () => {
  sent.length = 0; await resetDb(); setWhatsappProvider(fake);
  g = (await db.insert(users).values({ name: "Gestora Teste", email: "g@teste.local", role: "gestor", availability: "ausente" }).returning())[0].id;
  [{ id: chId }] = await db.insert(channels).values({ name: "Rec", instanceName: "rec", status: "conectado", phone: "+557199990404" }).returning();
});
afterEach(() => setWhatsappProvider(null));

const escreve = (phone: string, at: Date, name = "Carla Duarte") =>
  recordInbound({ channelId: chId, externalId: `${phone}-${at.getTime()}`, phoneRaw: phone, pushName: name, body: "oi", at, now: at });
const fila = () => db.select().from(outbox);

describe("mensagens automáticas novas (Lote 4)", () => {
  it("nascem desligadas: cliente nova escreve com a Casa aberta e nada entra na fila", async () => {
    for (const k of ["boas_vindas", "ausencia", "encerramento"] as const) expect(await getAutoMessage(k)).toEqual({ enabled: false, text: "" });
    await escreve("71990000401", OPEN);
    expect(await fila()).toEqual([]);
  });

  it("boas-vindas ligada: só no primeiro contato, com a Casa aberta, com o primeiro nome", async () => {
    await saveAutoMessage("boas_vindas", { enabled: true, text: "Oi, {nome}! Que bom te ver por aqui." }, g);
    await escreve("71990000402", OPEN);
    expect((await fila()).map((i) => i.text)).toEqual(["Oi, Maria! Que bom te ver por aqui."]);
    await escreve("71990000402", new Date(OPEN.getTime() + 60_000));        // a mesma cliente de novo
    await escreve("71990000403", CLOSED, "Bia Teste");                         // Casa fechada: é a "fora do horário" (desligada)
    expect(await fila()).toHaveLength(1);
  });

  it("ausência ligada: sai quando ninguém está Disponível; com alguém Disponível, não", async () => {
    await saveAutoMessage("ausencia", { enabled: true, text: "Oi! Já, já alguém te responde." }, g);
    await escreve("71990000404", OPEN);
    expect(await fila()).toHaveLength(1);
    await db.update(users).set({ availability: "disponivel" }).where(eq(users.id, g));
    await escreve("71990000405", OPEN, "Caio Teste");
    expect(await fila()).toHaveLength(1);
  });

  it("encerramento ligado: sai ao encerrar a conversa", async () => {
    await saveAutoMessage("encerramento", { enabled: true, text: "Obrigada, {nome}! Até a próxima." }, g);
    const r = await escreve("71990000406", OPEN);
    if (!("dealId" in r)) throw new Error("sem lead");
    await archiveConversation(r.dealId, g);
    expect((await fila()).map((i) => i.text)).toEqual(["Obrigada, Maria! Até a próxima."]);
  });

  it("desligada depois de entrar na fila: na hora de enviar é cancelada e nada sai", async () => {
    await saveAutoMessage("boas_vindas", { enabled: true, text: "Oi, {nome}!" }, g);
    await escreve("71990000407", OPEN);
    await saveAutoMessage("boas_vindas", { enabled: false, text: "Oi, {nome}!" }, g);
    await drainOutbox(new Date(OPEN.getTime() + 60_000));
    expect(sent).toEqual([]);
    expect((await fila())[0]).toMatchObject({ status: "cancelled", error: "A mensagem automática foi desligada." });
  });

  it("ligar exige texto", async () => {
    await expect(saveAutoMessage("ausencia", { enabled: true, text: "" }, g)).rejects.toThrow("Escreva o texto antes de ligar");
  });

  it("{nome}: o primeiro nome; sem nome some com a vírgula (nunca o telefone)", () => {
    expect(fillName("Oi, {nome}! Tudo bem?", "Carla Duarte")).toBe("Oi, Maria! Tudo bem?");
    expect(fillName("Oi, {nome}! Tudo bem?", null)).toBe("Oi! Tudo bem?");
  });

  it("a fora do horário (que já existia) também troca {nome} pelo primeiro nome", async () => {
    await db.insert(settings).values({ key: "auto_resposta", value: { enabled: true, text: "Oi, {nome}! Respondemos quando a Casa abrir." } });
    await escreve("71990000408", CLOSED);
    expect((await fila()).map((i) => i.text)).toEqual(["Oi, Maria! Respondemos quando a Casa abrir."]);
  });
});

describe("só consulta: a mensagem automática vira resposta pronta (20/10)", () => {
  it("o texto vai para /auto-boas-vindas, a automática continua desligada e nada entra na fila de envio; de novo, atualiza", async () => {
    await resetDb();
    const [u] = await db.insert(users).values({ name: "Gestora", email: "g@c.com", role: "gestor", passwordHash: "x" }).returning();
    await saveAutoMessageAsReply("boas_vindas", "Oi, {nome}! Que bom falar com você.", u.id);
    expect(await getAutoMessage("boas_vindas")).toEqual({ enabled: false, text: "Oi, {nome}! Que bom falar com você." });
    const auto = async () => (await quickRepliesFor(u.id)).filter((r) => r.label === "auto-boas-vindas"); // o banco de teste já traz outras respostas prontas
    expect((await auto()).map((r) => r.body)).toEqual(["Oi, {nome}! Que bom falar com você."]);
    await saveAutoMessageAsReply("boas_vindas", "Olá, {nome}! Seja bem-vinda.", u.id);
    expect((await auto()).map((r) => r.body)).toEqual(["Olá, {nome}! Seja bem-vinda."]);
    expect(await db.select().from(outbox)).toHaveLength(0);
  });
});
