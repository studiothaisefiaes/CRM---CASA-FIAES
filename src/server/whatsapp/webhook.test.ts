import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { channels, deals, messages, stages, webhookEvents } from "../db/schema";
import { ingestEvolution, checkSecret, parseContent } from "./webhook";
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
