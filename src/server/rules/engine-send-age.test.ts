import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { automations, contacts, deals, outbox, stages, users } from "../db/schema";
import { recordInbound } from "../domain/deals";
import { saveAutomation } from "../domain/config";
import { runRules } from "./engine";
import { previewCandidates } from "./preview";
import { AUTOMATION_TEMPLATES } from "./templates";
import { resetDb } from "../../../test/db";

const T0 = new Date("2026-10-13T13:00:00Z"); // terça, 10h em Salvador
const ago = (ms: number) => new Date(T0.getTime() - ms);
const DAY = 86_400_000, MIN = 60_000;
let gestor = "";
const ligar = (id: string) => { const t = AUTOMATION_TEMPLATES.find((x) => x.id === id)!; return saveAutomation(null, { ...t.rule, enabled: true }, gestor); };
const lead = async (phone: string, at: Date, pushName: string | undefined = "Cliente") => {
  const r = await recordInbound({ channelId: null, externalId: `m-${phone}`, phoneRaw: phone, pushName, body: "oi", at });
  if (!("dealId" in r)) throw new Error("sem deal");
  return r.dealId;
};
const queued = async () => new Set((await db.select({ d: outbox.dealId }).from(outbox)).map((r) => r.d));

beforeEach(async () => {
  await resetDb();
  await db.update(automations).set({ enabled: false }); // só as automações do teste (as padrão mexeriam nas etapas)
  [{ id: gestor }] = await db.insert(users).values({ name: "Thaíse", email: "t@c.com", role: "gestor", passwordHash: "x" }).returning();
});

describe("teto de idade nos envios automáticos (não dispara para o histórico)", () => {
  it("sem resposta (aviso de recebimento): espera de 60 dias não recebe; a de 20 minutos recebe", async () => {
    const velho = await lead("71999810001", ago(60 * DAY));
    const novo = await lead("71999810002", ago(20 * MIN));
    await ligar("aviso-recebimento");
    const s = await runRules(T0);
    const q = await queued();
    expect(q.has(novo)).toBe(true);
    expect(q.has(velho)).toBe(false);
    expect(s.sent).toBe(1);
  });
  it("sem resposta: alerta interno continua valendo para a espera antiga", async () => {
    const velho = await lead("71999810003", ago(60 * DAY));
    await saveAutomation(null, { name: "Alerta interno", enabled: true, trigger: { type: "sem_resposta_minutos", minutes: 10 }, conditions: [], actions: [{ type: "alertar_gestao", message: "{nome} sem resposta" }] }, gestor);
    const s = await runRules(T0);
    expect(s.fired).toBeGreaterThanOrEqual(1);
    expect((await queued()).has(velho)).toBe(false);
  });
  it("sem retorno da cliente (retomada): silêncio de 60 dias não recebe; o de 3 dias recebe", async () => {
    const [st] = await db.select().from(stages).where(eq(stages.key, "atendimento"));
    const velho = await lead("71999810004", ago(61 * DAY));
    const novo = await lead("71999810005", ago(4 * DAY));
    for (const [id, dias] of [[velho, 60], [novo, 3]] as const)
      await db.update(deals).set({ stageId: st.id, stageEnteredAt: ago(dias * DAY), awaitingReplySince: null, lastOutboundAt: ago(dias * DAY), lastInboundAt: ago((dias + 1) * DAY) }).where(eq(deals.id, id));
    await ligar("followup-orcamento");
    await runRules(T0);
    const q = await queued();
    expect(q.has(novo)).toBe(true);
    expect(q.has(velho)).toBe(false);
  });
  it("preview conta só quem receberia o envio", async () => {
    await lead("71999810006", ago(60 * DAY));
    await lead("71999810007", ago(20 * MIN));
    const t = AUTOMATION_TEMPLATES.find((x) => x.id === "aviso-recebimento")!;
    const p = await previewCandidates(t.rule, T0);
    expect(p.sendCount).toBe(1);
    expect(p.count).toBe(2);
  });
});

describe("{nome} na mensagem à cliente", () => {
  it("sem nome, o texto sai natural (sem o telefone no lugar)", async () => {
    const id = await lead("71999810008", ago(20 * MIN), undefined);
    await db.update(contacts).set({ name: null });
    await ligar("aviso-recebimento");
    await runRules(T0);
    const [o] = await db.select().from(outbox).where(eq(outbox.dealId, id));
    expect(o.text).not.toMatch(/\{nome\}|\+?55|7199981/);
    expect(o.text).toMatch(/^Oi!/);
  });
  it("com nome, usa o primeiro nome como antes", async () => {
    const id = await lead("71999810009", ago(20 * MIN), "Mariana Souza");
    await ligar("aviso-recebimento");
    await runRules(T0);
    const [o] = await db.select().from(outbox).where(eq(outbox.dealId, id));
    expect(o.text).toContain("Mariana");
  });
});
