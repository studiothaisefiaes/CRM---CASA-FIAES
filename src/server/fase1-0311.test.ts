import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { channels, messages } from "./db/schema";
import { ingestEvolution, parseContent, protocolAction } from "./whatsapp/webhook";
import { sweepStuckPending, STUCK_PENDING_MS, UNCERTAIN_SEND_MESSAGE } from "./domain/send";
import { declaredBytes, AUTO_MAX_BYTES } from "./whatsapp/media";
import { PUSH_ALSO } from "./push";
import { resetDb } from "../../test/db";
import { inboundText } from "../../test/fixtures/evolution";

/** Fase 1 do plano de 02/11 (achados da auditoria de conversas). */
describe("mensagens que chegavam vazias", () => {
  it("modelo com botões: vale o texto (título, corpo e rodapé)", () => {
    expect(parseContent({ templateMessage: { templateId: "1", hydratedTemplate: { hydratedTitleText: "Promo", hydratedContentText: "Seu pedido saiu", hydratedFooterText: "Loja X" } } } as never))
      .toEqual({ kind: "text", body: "Promo\nSeu pedido saiu\nLoja X" });
  });
  it("modelo interativo e mensagem interativa: o corpo", () => {
    expect(parseContent({ templateMessage: { interactiveMessageTemplate: { body: { text: "Confirme o código" } } } } as never)).toEqual({ kind: "text", body: "Confirme o código" });
    expect(parseContent({ interactiveMessage: { body: { text: "Escolha uma opção" }, nativeFlowMessage: {} } } as never)).toEqual({ kind: "text", body: "Escolha uma opção" });
  });
  it("foto de álbum embrulhada (associatedChildMessage) vira foto", () => {
    expect(parseContent({ associatedChildMessage: { message: { imageMessage: { caption: "olha" } } } } as never)).toEqual({ kind: "image", body: "olha" });
  });
  it("modelo sem texto nenhum continua 'other'", () => {
    expect(parseContent({ templateMessage: { hydratedTemplate: {} } } as never)).toEqual({ kind: "other", body: null });
  });
});

describe("edição no formato novo (criptografada)", () => {
  const secretEdit = (target: string) => ({
    event: "messages.upsert", instance: "casa-principal",
    data: { key: { remoteJid: "5571999812244@s.whatsapp.net", fromMe: false, id: `EDIT-${target}` },
      message: { messageContextInfo: {}, secretEncryptedMessage: { secretEncType: 2, encIv: "x", encPayload: "y", targetMessageKey: { id: target, fromMe: false } } },
      messageType: "secretEncryptedMessage", messageTimestamp: 1791551200 },
  });

  it("protocolAction reconhece a edição sem o texto novo", () => {
    expect(protocolAction(secretEdit("ABC").data.message as never)).toEqual({ type: "edit", id: "ABC", body: null });
    // Outro tipo de segredo (ex.: evento) não é edição.
    expect(protocolAction({ secretEncryptedMessage: { secretEncType: 1, targetMessageKey: { id: "ABC" } } } as never)).toBeNull();
  });

  describe("no banco", () => {
    beforeEach(async () => {
      await resetDb();
      await db.insert(channels).values({ name: "Principal", instanceName: "casa-principal", status: "conectado" });
    });

    it("a original fica 'editada, veja no celular' e o texto antigo não é apagado", async () => {
      await ingestEvolution(inboundText("ORIG1", undefined, "pode ser dia 15?"));
      await ingestEvolution(secretEdit("ORIG1"));
      const [m] = await db.select().from(messages).where(eq(messages.externalId, "ORIG1"));
      expect(m.editedAt).not.toBeNull();
      expect(m.editedTextMissing).toBe(true);
      expect(m.body).toBe("pode ser dia 15?");
      expect(await db.select().from(messages)).toHaveLength(1);
    });

    it("edição comum (com texto) troca o texto e tira o aviso", async () => {
      await ingestEvolution(inboundText("ORIG2", undefined, "dia 15"));
      await ingestEvolution(secretEdit("ORIG2"));
      await ingestEvolution({ event: "messages.upsert", instance: "casa-principal", data: { key: { remoteJid: "5571999812244@s.whatsapp.net", fromMe: false, id: "EDIT2B" },
        message: { protocolMessage: { key: { id: "ORIG2" }, type: 14, editedMessage: { conversation: "dia 16" } } }, messageTimestamp: 1791551300 } });
      const [m] = await db.select().from(messages).where(eq(messages.externalId, "ORIG2"));
      expect(m.body).toBe("dia 16");
      expect(m.editedTextMissing).toBe(false);
    });
  });
});

describe("envio preso em 'enviando…'", () => {
  beforeEach(async () => {
    await resetDb();
    await db.insert(channels).values({ name: "Principal", instanceName: "casa-principal", status: "conectado" });
  });

  it("depois de 10 min sem id do WhatsApp vira envio incerto; o recente e o que tem id ficam", async () => {
    await ingestEvolution(inboundText());
    const [base] = await db.select().from(messages);
    const now = new Date();
    const old = new Date(now.getTime() - STUCK_PENDING_MS - 60_000);
    const row = (over: Partial<typeof messages.$inferInsert>) => ({ dealId: base.dealId, contactId: base.contactId, channelId: base.channelId, direction: "out" as const, kind: "text", body: "oi", status: "pending", ...over });
    const [preso] = await db.insert(messages).values(row({ createdAt: old })).returning();
    const [recente] = await db.insert(messages).values(row({ createdAt: new Date(now.getTime() - 60_000) })).returning();
    const [comId] = await db.insert(messages).values(row({ createdAt: old, externalId: "WAID1" })).returning();
    expect(await sweepStuckPending(now)).toBe(1);
    const by = async (id: string) => (await db.select().from(messages).where(eq(messages.id, id)))[0];
    expect(await by(preso.id)).toMatchObject({ status: "failed", error: UNCERTAIN_SEND_MESSAGE });
    expect((await by(recente.id)).status).toBe("pending");
    expect((await by(comId.id)).status).toBe("pending");
  });
});

describe("outros itens da fase 1", () => {
  it("tamanho declarado da mídia (número, texto ou Long do protobuf; embrulhado)", () => {
    expect(declaredBytes({ videoMessage: { fileLength: 1234 } })).toBe(1234);
    expect(declaredBytes({ message: { documentMessage: { fileLength: "99999999" } } })).toBe(99999999);
    expect(declaredBytes({ videoMessage: { fileLength: { low: 500, high: 0 } } })).toBe(500);
    expect(declaredBytes({ videoMessage: {} })).toBeNull();
    expect(99999999 > AUTO_MAX_BYTES).toBe(true);
  });

  it("WhatsApp caído também vai por push", () => {
    expect(PUSH_ALSO).toEqual(expect.arrayContaining(["whatsapp_sem_conexao", "whatsapp_desconectado"]));
  });
});
