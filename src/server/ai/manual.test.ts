import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { auditLog, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import { AI_MANUAL_MAX, approxTokens, countMissing, emptyManual } from "@/lib/ai-manual";
import { getAiManual, saveAiManual } from "./manual";

let g = "";
beforeEach(async () => {
  await resetDb();
  g = (await db.insert(users).values({ name: "G", email: "g@c.com", role: "gestor", passwordHash: "x" }).returning())[0].id;
});

describe("Manual da Casa para a IA (seções de skill)", () => {
  it("nasce com as seções vazias; salva cada seção sem espaço sobrando, com quem salvou e quando", async () => {
    expect(await getAiManual()).toEqual({ secoes: emptyManual(), updatedAt: null });
    const saved = await saveAiManual({ ...emptyManual(), regras: "  Tolerância de 15 min.\r\n\r\n\r\nSinal: [a Casa precisa preencher]  ", fala: "Acolhedor 🌷" }, g);
    expect(saved.secoes.regras).toBe("Tolerância de 15 min.\n\nSinal: [a Casa precisa preencher]");
    const m = await getAiManual();
    expect(m.secoes).toEqual(saved.secoes);
    expect(m.updatedAt).toBeInstanceOf(Date);
    expect(countMissing(m.secoes)).toBe(1);
    expect((await db.select().from(auditLog).where(eq(auditLog.entityId, "ia_manual_casa"))).length).toBe(1);
  });
  it("ignora chave que não é seção e recusa o manual grande demais (custo de toda sugestão)", async () => {
    const r = await saveAiManual({ ...emptyManual(), casa: "Alameda", outra: "x" } as never, g);
    expect(Object.keys(r.secoes).sort()).toEqual(Object.keys(emptyManual()).sort());
    await expect(saveAiManual({ ...emptyManual(), casa: "x".repeat(AI_MANUAL_MAX / 2), exemplos: "y".repeat(AI_MANUAL_MAX / 2 + 1) }, g)).rejects.toThrow(/caracteres/);
  });
  it("estimativa de tokens para a tela", () => {
    expect(approxTokens("")).toBe(0);
    expect(approxTokens("a".repeat(350))).toBe(100);
  });
});

describe("Manual v3: teto 24.000 e seções Cenários e Objeções", () => {
  it("salva cenários e objeções e aceita até 24.000 caracteres", async () => {
    expect(AI_MANUAL_MAX).toBe(24_000);
    const r = await saveAiManual({ ...emptyManual(), cenarios: "Transição → explicar.", objecoes: "Tá caro → perguntar o investimento.", casa: "x".repeat(23_900) }, g);
    expect(r.secoes).toMatchObject({ cenarios: "Transição → explicar.", objecoes: "Tá caro → perguntar o investimento." });
    expect((await getAiManual()).secoes.objecoes).toBe("Tá caro → perguntar o investimento.");
  });
});
