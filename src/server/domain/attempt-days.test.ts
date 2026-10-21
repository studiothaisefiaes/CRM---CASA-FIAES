import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { contacts, deals, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import { attemptDaysOf } from "../../lib/attempts";
import { recordOutbound, stageByKind } from "./deals";
import { sweepAttempts, waitForClientTx } from "./funnel";
import { setStageAttemptDays } from "./stage-admin";

const T = (day: number, h: number, m = 0) => new Date(Date.UTC(2026, 9, day, h + 3, m)); // outubro/2026, hora de Salvador
let g = "";
beforeEach(async () => { await resetDb(); g = (await db.insert(users).values({ name: "Gestora Teste", email: "g@teste.local", role: "gestor" }).returning())[0].id; });

/** Em conversa esperando a cliente (a antiga Aguardando cliente): as tentativas começam em `at`. */
async function conversaEsperandoCliente(at: Date) {
  const [c] = await db.insert(contacts).values({ name: "Cliente Teste", phoneE164: "+5571990000301" }).returning();
  const [d] = await db.insert(deals).values({ contactId: c.id, stageId: (await stageByKind("atendimento")).id, stageEnteredAt: T(1, 10), createdAt: T(1, 10) }).returning();
  await db.transaction((tx) => waitForClientTx(tx, d.id, null, "manual", at));
  return d.id;
}

describe("dias das tentativas por etapa (Lote 4)", () => {
  it("lista torta vale o padrão do tipo", () => {
    expect(attemptDaysOf("followup", null)).toEqual([1, 3, 7]);
    expect(attemptDaysOf("proposta", [2, 4])).toEqual([2, 4, 8]);
    expect(attemptDaysOf("followup", [3, 2, 9])).toEqual([1, 3, 7]);
    expect(attemptDaysOf("followup", [2, 5, 10])).toEqual([2, 5, 10]);
  });

  it("só aceita 3 números de 1 a 60, crescentes, e só em Em conversa ou Orçamento", async () => {
    const f = await stageByKind("atendimento");
    await expect(setStageAttemptDays(f.id, [2, 2, 9], g)).rejects.toThrow("cada tentativa depois da anterior");
    await expect(setStageAttemptDays(f.id, [1, 3, 90], g)).rejects.toThrow("de 1 a 60");
    await expect(setStageAttemptDays((await stageByKind("agendado")).id, [1, 3, 7], g)).rejects.toThrow("só em Em conversa e Orçamento");
  });

  it("a 1ª tentativa nasce no 1º dia da espera e a varredura usa o 2º (contando do começo da espera, não da entrada na etapa)", async () => {
    const f = await stageByKind("atendimento");
    await setStageAttemptDays(f.id, [2, 5, 10], g);
    const id = await conversaEsperandoCliente(T(13, 10)); // terça 10h
    let [d] = await db.select().from(deals).where(eq(deals.id, id));
    expect(d.followupAttempt).toBe(1);
    expect(d.followupDueAt!.toISOString()).toBe(T(15, 10).toISOString()); // D+2, quinta 10h

    await recordOutbound({ dealId: id, channelId: null, externalId: "o1", body: "Oi, tudo bem?", fromPhone: true, at: T(15, 11) }); // a Casa tentou no dia
    await sweepAttempts(T(15, 11, 5));
    [d] = await db.select().from(deals).where(eq(deals.id, id));
    expect(d.followupAttempt).toBe(2);
    expect(d.followupDueAt!.toISOString()).toBe(T(19, 10).toISOString()); // D+5 a partir da entrada = domingo 18 → fechado → segunda 19
  });
});
