import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { channels, deals, messages, stages, webhookEvents } from "../db/schema";
import { ingestEvolution, checkSecret, parseContent, messageTime } from "./webhook";
import { getDealDetail } from "../queries/deal";
import { resetDb } from "../../../test/db";
import { inboundText, inboundAudio, fromPhone, adLead, connectionOpen, reaction } from "../../../test/fixtures/evolution";

beforeEach(async () => {
  await resetDb();
  await db.insert(channels).values({ name: "Principal", instanceName: "casa-principal", status: "aguardando_qr" });
});

describe("webhook Evolution", () => {
  it("segredo: compara em tempo constante", () => {
    expect(checkSecret("abc", "abc")).toBe(true);
    expect(checkSecret("abd", "abc")).toBe(false);
    expect(checkSecret(null, "abc")).toBe(false);
  });

  it("mensagem recebida vira lead ligado ao canal", async () => {
    await ingestEvolution(inboundText());
    const [d] = await db.select().from(deals);
    const [ch] = await db.select().from(channels);
    expect(d.channelId).toBe(ch.id);
    expect((await db.select().from(messages))[0].body).toContain("queria saber o valor");
  });

  it("evento reenviado é ignorado", async () => {
    await ingestEvolution(inboundText());
    const r = await ingestEvolution(inboundText());
    expect(r).toMatchObject({ duplicate: true });
    expect((await db.select().from(messages)).length).toBe(1);
    expect((await db.select().from(webhookEvents)).length).toBe(1);
  });

  it("áudio entra como mensagem de áudio", async () => {
    await ingestEvolution(inboundAudio());
    expect((await db.select().from(messages))[0].kind).toBe("audio");
  });

  it("resposta pelo celular move o lead para Atendimento", async () => {
    await ingestEvolution(inboundText());
    await ingestEvolution(fromPhone());
    const [r] = await db.select({ key: stages.key }).from(deals).innerJoin(stages, eq(stages.id, deals.stageId));
    expect(r.key).toBe("atendimento");
  });

  it("lead de anúncio é marcado com origem Anúncio", async () => {
    await ingestEvolution(adLead());
    expect((await db.select().from(deals))[0].origin).toBe("Anúncio");
  });

  it("conexão aberta marca o canal como conectado com o número", async () => {
    await ingestEvolution(connectionOpen);
    const [ch] = await db.select().from(channels);
    expect(ch.status).toBe("conectado");
    expect(ch.phone).toBe("+557133330000");
  });

  it("reação não vira mensagem", async () => {
    await ingestEvolution(reaction);
    expect((await db.select().from(messages)).length).toBe(0);
  });

  it("extrai legenda de imagem e nome de documento", () => {
    expect(parseContent({ imageMessage: { caption: "foto" } })).toEqual({ kind: "image", body: "foto" });
    expect(parseContent({ documentMessage: { fileName: "orcamento.pdf" } })).toEqual({ kind: "document", body: "orcamento.pdf" });
  });
});

describe("parseContent: legenda vazia", () => {
  it("legenda '' vira null (foto, vídeo e documento)", () => {
    expect(parseContent({ imageMessage: { caption: "" } } as never)?.body).toBeNull();
    expect(parseContent({ videoMessage: { caption: "" } } as never)?.body).toBeNull();
    expect(parseContent({ documentMessage: { caption: "", fileName: "t.pdf" } } as never)?.body).toBe("t.pdf");
  });
});

describe("ordem das mensagens no mesmo segundo (messageTimestamp em segundos)", () => {
  afterEach(() => { vi.useRealTimers(); });
  const S = 1_791_550_931;

  it("messageTime: chegou dentro do próprio segundo usa a hora de chegada (ms); atrasada fica no fim do segundo do WhatsApp; sem hora usa agora", () => {
    expect(messageTime(S, S * 1000 + 250).getTime()).toBe(S * 1000 + 250);
    expect(messageTime(S, S * 1000 + 999).getTime()).toBe(S * 1000 + 999);
    expect(messageTime(S, S * 1000 + 1000).getTime()).toBe(S * 1000 + 999); // atrasada: fim do segundo do WhatsApp
    expect(messageTime(S, S * 1000 + 60_000).getTime()).toBe(S * 1000 + 999);
    expect(messageTime(S, S * 1000 - 5).getTime()).toBe(S * 1000); // relógio do servidor atrás: não inventa hora antes do WhatsApp
    expect(messageTime(undefined, 1234).getTime()).toBe(1234);
  });

  it("duas mensagens no mesmo segundo aparecem na conversa na ordem em que chegaram", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(S * 1000 + 100);
    await ingestEvolution(inboundText("SEG1", undefined, "primeira"));
    vi.setSystemTime(S * 1000 + 600);
    await ingestEvolution(inboundText("SEG2", undefined, "segunda"));
    vi.useRealTimers();
    const [d] = await db.select().from(deals);
    const msgs = (await getDealDetail(d.id))!.messages;
    expect(msgs.map((m) => m.body)).toEqual(["primeira", "segunda"]);
    expect(msgs.map((m) => m.createdAt.getTime())).toEqual([S * 1000 + 100, S * 1000 + 600]);
  });

  it("resposta pelo celular que chega atrasada, no mesmo segundo da mensagem da cliente, ainda conta como resposta", async () => {
    // A cliente escreve em S e o evento chega ao vivo (S.500); a resposta da Casa também é de S, mas o evento só chega em S+1.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(S * 1000 + 500);
    await ingestEvolution(inboundText("CLI1", undefined, "oi, tem horário?"));
    vi.setSystemTime(S * 1000 + 1002);
    const resp = fromPhone("CASA1");
    resp.data.messageTimestamp = S;
    await ingestEvolution(resp);
    vi.useRealTimers();
    const [r] = await db.select({ key: stages.key, awaiting: deals.awaitingReplySince }).from(deals).innerJoin(stages, eq(stages.id, deals.stageId));
    expect(r).toEqual({ key: "atendimento", awaiting: null });
  });

  it("empate exato de horário: a ordem é estável (desempate pelo id), igual em toda leitura", async () => {
    await ingestEvolution(inboundText("EMP0", undefined, "abre o lead"));
    const [d] = await db.select().from(deals);
    const at = new Date("2026-10-09T15:00:00.000Z"); // depois da mensagem que abriu o lead
    const ids = ["ffffffff-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002", "88888888-0000-4000-8000-000000000003"];
    await db.insert(messages).values(ids.map((id, i) => ({ id, contactId: d.contactId, dealId: d.id, direction: "in" as const, body: `empate ${i}`, createdAt: at })));
    const tied = async () => (await getDealDetail(d.id))!.messages.filter((m) => m.createdAt.getTime() === at.getTime()).map((m) => m.id);
    expect(await tied()).toEqual([...ids].sort());
    expect(await tied()).toEqual(await tied());
  });
});
