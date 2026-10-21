import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { auditLog } from "../../db/schema";
import { resetDb } from "../../../../test/db";
import { setupCaixa } from "../../../../test/caixa-fixtures";
import { CAIXA_RECURSOS_PADRAO } from "@/lib/caixa-recursos";
import { assertRecurso, getCaixaRecursos, saveCaixaRecursos } from "./recursos";

let s: Awaited<ReturnType<typeof setupCaixa>>;
beforeEach(async () => { await resetDb(); s = await setupCaixa(); });

describe("liga/desliga do caixa", () => {
  it("sem setting, tudo ligado", async () => {
    expect(await getCaixaRecursos()).toEqual(CAIXA_RECURSOS_PADRAO);
    await expect(assertRecurso("divida")).resolves.toBeUndefined();
  });
  it("desligar uma chave recusa só ela e grava de/para na auditoria", async () => {
    await saveCaixaRecursos({ ...CAIXA_RECURSOS_PADRAO, divida: false }, s.gestora.id);
    await expect(assertRecurso("divida")).rejects.toThrow("Dívida da cliente está desligado em Configurações › Caixa.");
    await expect(assertRecurso("vales")).resolves.toBeUndefined();
    const [a] = await db.select().from(auditLog).where(eq(auditLog.action, "caixa_recursos"));
    expect(a.data).toMatchObject({ de: CAIXA_RECURSOS_PADRAO, para: { ...CAIXA_RECURSOS_PADRAO, divida: false } });
  });
  it("valida os números e o texto", async () => {
    await expect(saveCaixaRecursos({ ...CAIXA_RECURSOS_PADRAO, assistentesMax: 0 as 1 }, s.gestora.id)).rejects.toThrow("Use 1 ou 2 assistentes.");
    await expect(saveCaixaRecursos({ ...CAIXA_RECURSOS_PADRAO, valeSenhaTentativas: 21 }, s.gestora.id)).rejects.toThrow("Use de 1 a 20 tentativas.");
    await expect(saveCaixaRecursos({ ...CAIXA_RECURSOS_PADRAO, valeSenhaJanelaMin: 121 }, s.gestora.id)).rejects.toThrow("Use de 1 a 120 minutos.");
    await expect(saveCaixaRecursos({ ...CAIXA_RECURSOS_PADRAO, reciboTexto: "   " }, s.gestora.id)).rejects.toThrow("Escreva o texto do recibo.");
    await expect(saveCaixaRecursos({ ...CAIXA_RECURSOS_PADRAO, reciboTexto: "x".repeat(601) }, s.gestora.id)).rejects.toThrow("Escreva o texto do recibo.");
  });
  it("os números salvos voltam na leitura", async () => {
    await saveCaixaRecursos({ ...CAIXA_RECURSOS_PADRAO, assistentesMax: 1, valeSenhaTentativas: 3, valeSenhaJanelaMin: 20 }, s.gestora.id);
    expect(await getCaixaRecursos()).toMatchObject({ assistentesMax: 1, valeSenhaTentativas: 3, valeSenhaJanelaMin: 20 });
  });
  it("'Pagar comissão a partir de': grava a data, vazio = sem corte, data inválida recusa", async () => {
    await saveCaixaRecursos({ ...CAIXA_RECURSOS_PADRAO, pagarComissaoDesde: "2026-09-15" }, s.gestora.id);
    expect((await getCaixaRecursos()).pagarComissaoDesde).toBe("2026-09-15");
    await saveCaixaRecursos({ ...CAIXA_RECURSOS_PADRAO, pagarComissaoDesde: null }, s.gestora.id);
    expect((await getCaixaRecursos()).pagarComissaoDesde).toBeNull();
    await expect(saveCaixaRecursos({ ...CAIXA_RECURSOS_PADRAO, pagarComissaoDesde: "2026-02-30" }, s.gestora.id)).rejects.toThrow("Use uma data válida.");
  });
});
