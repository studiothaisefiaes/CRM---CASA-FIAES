import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { deals } from "../db/schema";
import { resetDb } from "../../../test/db";
import { recordInbound, recordOutbound } from "./deals";
import { closesConversation, isClosingText } from "./message-kinds";

describe("mensagem que só encerra a conversa", () => {
  it("agradecimento, ok e emoji sozinhos encerram", () => {
    for (const t of ["Obrigada!", "obrigado", "Muito obrigada 🙏", "Obg", "obgd!!", "Brigadaaa", "ok", "Ok, obrigada!", "tá bom", "Ta bom obrigada", "Combinado!", "Perfeito", "Valeu", "Show", "Amém 🙏", "👍", "❤️❤️", "😍🙏", "De nada", "Ótimo, obrigada", "Obrigada viu", "Entendi, obrigada", "Joia\n\nMuito obrigada", "Tudo bem, eu agradeço o retorno.", "Confirmado", "Confirmadíssimo", "Joia 👍", "Agradeço pela atenção"])
      expect(isClosingText(t), t).toBe(true);
  });
  it("pergunta, pedido ou conteúdo novo não encerra", () => {
    for (const t of ["Obrigada! Qual o valor?", "ok, que horas?", "Obrigada, posso ir amanhã", "Não sei se vcs fazem esse tipo de serviço", "quanto custa?", "Oi", "Bom dia", "obrigada mas não consigo ir", "", "  ", "Tudo bem?", "confirmado, mas posso mudar para as 15h"])
      expect(isClosingText(t), t).toBe(false);
  });
  it("figurinha e reação continuam encerrando; texto só quando é de encerramento", () => {
    expect(closesConversation("sticker")).toBe(true);
    expect(closesConversation("reaction")).toBe(true);
    expect(closesConversation("text", "Obrigada!")).toBe(true);
    expect(closesConversation("text", "Obrigada! E o preço?")).toBe(false);
    expect(closesConversation("audio", null)).toBe(false);
  });
});

describe("recordInbound com agradecimento", () => {
  beforeEach(async () => { await resetDb(); });
  const T = (h: number, m = 0) => new Date(Date.UTC(2026, 9, 14, h + 3, m));

  it("\"Obrigada!\" logo depois da resposta da Casa não abre espera", async () => {
    const a = await recordInbound({ channelId: null, externalId: "L1", phoneRaw: "71990000007", body: "Vocês fazem clareamento?", at: T(11, 44) });
    if (!("dealId" in a)) throw new Error("sem lead");
    await recordOutbound({ dealId: a.dealId, channelId: null, body: "Sim, realizamos.", at: T(11, 49) });
    await recordInbound({ channelId: null, externalId: "L2", phoneRaw: "71990000007", body: "Obrigada!", at: T(11, 54) });
    const [d] = await db.select().from(deals).where(eq(deals.id, a.dealId));
    expect(d.awaitingReplySince).toBeNull();
  });

  it("agradecimento com pergunta abre espera normalmente", async () => {
    const a = await recordInbound({ channelId: null, externalId: "M1", phoneRaw: "71992039858", body: "Oi", at: T(10) });
    if (!("dealId" in a)) throw new Error("sem lead");
    await recordOutbound({ dealId: a.dealId, channelId: null, body: "Olá!", at: T(10, 5) });
    await recordInbound({ channelId: null, externalId: "M2", phoneRaw: "71992039858", body: "Obrigada! Qual o valor?", at: T(10, 10) });
    const [d] = await db.select().from(deals).where(eq(deals.id, a.dealId));
    expect(d.awaitingReplySince?.toISOString()).toBe(T(10, 10).toISOString());
  });
});
