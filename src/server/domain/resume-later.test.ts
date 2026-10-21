import { beforeEach, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import { alerts, deals, stages, tasks, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import { recordInbound, recordOutbound } from "./deals";
import { resumeLater } from "./resume-later";
import { runRules } from "../rules/engine";
import { getQueue } from "../queries/queue";
import { permsFor } from "../../../test/perms";

const T0 = new Date("2026-10-14T15:44:00Z"); // quarta, 12h44 em Salvador
const later = (min: number) => new Date(T0.getTime() + min * 60_000);
const stageOf = async (id: string) => (await db.select({ k: stages.key }).from(deals).innerJoin(stages, eq(stages.id, deals.stageId)).where(eq(deals.id, id)))[0].k;
let ana = "";

beforeEach(async () => {
  await resetDb();
  ana = (await db.insert(users).values({ name: "Ana", email: "ana@c.com", role: "atendente", passwordHash: "x" }).returning())[0].id;
});

async function conversaComEspera() {
  const r = await recordInbound({ channelId: null, externalId: "R1", phoneRaw: "71988887777", pushName: "Rita", body: "Quero dar de presente pra minha mãe", at: T0 });
  if (!("dealId" in r)) throw new Error("sem lead");
  await recordOutbound({ dealId: r.dealId, channelId: null, body: "Hoje às 15h fica bom?", at: later(1) });
  await recordInbound({ channelId: null, externalId: "R2", phoneRaw: "71988887777", body: "Ela está viajando, eu entro em contato para agendar", at: later(2) });
  return r.dealId;
}

describe("Retomar depois", () => {
  it("cria o lembrete, fica em Em conversa esperando a cliente e a conversa deixa de esperar a Casa (avisos resolvidos)", async () => {
    const id = await conversaComEspera();
    await db.insert(alerts).values({ dealId: id, audience: "responsavel", type: "sem_resposta_minutos", severity: "urgente", message: "Rita está esperando", dedupeKey: "t1", level: 1 });
    const due = new Date("2026-10-21T13:00:00Z");
    await resumeLater(id, { title: "Ela vai dar retorno para agendar", dueAt: due }, ana, later(3));
    const [d] = await db.select().from(deals).where(eq(deals.id, id));
    expect(d.awaitingReplySince).toBeNull();
    expect(await stageOf(id)).toBe("atendimento");
    expect(d.followupAttempt).toBe(1);
    const [t] = await db.select().from(tasks).where(and(eq(tasks.dealId, id), isNull(tasks.doneAt)));
    expect(t).toMatchObject({ title: "Ela vai dar retorno para agendar", kind: "proxima_acao" });
    expect(t.dueAt.toISOString()).toBe(due.toISOString());
    expect(await db.select().from(alerts).where(and(eq(alerts.dealId, id), isNull(alerts.resolvedAt)))).toHaveLength(0);
  });

  it("agendado continua agendado (só cria o lembrete)", async () => {
    const id = await conversaComEspera();
    const [ag] = await db.select().from(stages).where(eq(stages.key, "agendado"));
    await db.update(deals).set({ stageId: ag.id }).where(eq(deals.id, id));
    await resumeLater(id, { title: "Confirmar", dueAt: new Date("2026-10-15T13:00:00Z") }, ana, later(3));
    expect(await stageOf(id)).toBe("agendado");
  });

  it("com lembrete marcado, o follow-up diário automático não empurra a conversa nem avisa antes da data", async () => {
    const r = await recordInbound({ channelId: null, externalId: "S1", phoneRaw: "71988886666", pushName: "Sol", body: "oi", at: T0 });
    if (!("dealId" in r)) throw new Error("sem lead");
    await recordOutbound({ dealId: r.dealId, channelId: null, body: "Oi Sol, qual serviço?", at: later(1) });
    await resumeLater(r.dealId, { title: "Retomar contato com Sol", dueAt: new Date("2026-10-21T13:00:00Z") }, ana, later(2));
    await runRules(new Date(T0.getTime() + 2 * 86_400_000));
    expect(await stageOf(r.dealId)).toBe("atendimento");
    expect((await db.select().from(alerts).where(eq(alerts.dealId, r.dealId))).map((a) => a.type + ": " + a.message)).toEqual([]);
  });

  it("na Fila: sai de Atrasados e fica em Aguardando a cliente até o dia do lembrete", async () => {
    const id = await conversaComEspera();
    await resumeLater(id, { title: "Retomar", dueAt: new Date("2026-10-21T13:00:00Z") }, ana, later(3));
    const q = await getQueue({ id: ana, perms: permsFor("gestor") }, { now: later(60) });
    expect(q.sections.find((s) => s.items.some((i) => i.dealId === id))?.key).toBe("aguardando-cliente");
  });

  it("título vazio ou data passada: erro claro", async () => {
    const id = await conversaComEspera();
    await expect(resumeLater(id, { title: " ", dueAt: later(60) }, ana, later(3))).rejects.toThrow(/Escreva/);
    await expect(resumeLater(id, { title: "x", dueAt: new Date("2026-10-01T13:00:00Z") }, ana, later(3))).rejects.toThrow(/já passou/);
  });
});
