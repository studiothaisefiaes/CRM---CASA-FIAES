import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import { alerts, contacts, deals, stages, tasks, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import { getToday } from "./today";

beforeEach(async () => { await resetDb(); });

const NOW = new Date(Date.UTC(2026, 9, 13, 15, 0)); // terça 12h em Salvador
const bahia = (day: number, h: number, m = 0) => new Date(Date.UTC(2026, 9, day, h + 3, m));

async function setup() {
  const [ana] = await db.insert(users).values({ name: "Ana", email: "a@c.com", role: "atendente", passwordHash: "x" }).returning();
  const [bia] = await db.insert(users).values({ name: "Bia", email: "b@c.com", role: "atendente", passwordHash: "x" }).returning();
  const [gestora] = await db.insert(users).values({ name: "Gestora", email: "g@c.com", role: "gestor", passwordHash: "x" }).returning();
  const stage = async (kind: string) => (await db.select().from(stages)).find((s) => s.kind === kind)!;
  let n = 0;
  const mk = async (ownerId: string | null, over: Partial<typeof deals.$inferInsert> = {}, kind = "atendimento") => {
    n++;
    const [c] = await db.insert(contacts).values({ name: `Cliente ${n}`, phoneE164: `+55719999100${n}` }).returning();
    const [d] = await db.insert(deals).values({ contactId: c.id, stageId: (await stage(kind)).id, ownerId, ...over }).returning();
    return { c, d };
  };
  let k = 0;
  const alert = (dealId: string, over: Partial<typeof alerts.$inferInsert> = {}) =>
    db.insert(alerts).values({ dealId, audience: "responsavel", type: "sem_resposta_minutos", severity: "urgente", message: "m", dedupeKey: `k${++k}`, waitKey: `espera:${dealId}`, ...over });
  const task = (c: { id: string }, d: { id: string } | null, over: Partial<typeof tasks.$inferInsert>) =>
    db.insert(tasks).values({ contactId: c.id, dealId: d?.id ?? null, kind: "proxima_acao", title: "Ligar", dueAt: NOW, ...over }).returning();
  return { ana, bia, gestora, mk, alert, task };
}
const as = (u: { id: string; name: string; email: string; role: "gestor" | "atendente" }) => ({ id: u.id, name: u.name, email: u.email, role: u.role });

describe("Hoje: contador de atrasados", () => {
  it("conta leads com espera aberta, não alertas: 2 alertas da mesma espera (nível 1 e 2) valem 1", async () => {
    const { ana, gestora, mk, alert } = await setup();
    const { d } = await mk(ana.id, { awaitingReplySince: bahia(13, 11) });
    await alert(d.id, { userId: ana.id, level: 1 });
    await alert(d.id, { audience: "gestao", level: 2, dedupeKey: "k-nivel2", waitKey: `espera:${d.id}:n2` });
    expect((await getToday(as(gestora), NOW)).late).toBe(1);
    expect((await getToday(as(ana), NOW)).late).toBe(1);
  });
  it("não depende do SLA da etapa: esperando há 1 min sem alerta não é atrasado; com alerta é", async () => {
    const { ana, gestora, mk, alert } = await setup();
    const { d } = await mk(ana.id, { awaitingReplySince: new Date(NOW.getTime() - 60_000) });
    expect((await getToday(as(gestora), NOW)).late).toBe(0);
    await alert(d.id);
    expect((await getToday(as(gestora), NOW)).late).toBe(1);
  });
  it("atendente conta os dela e os sem dono, igual à Fila e ao sino; não os de outra pessoa", async () => {
    const { ana, bia, mk, alert } = await setup();
    const a = await mk(ana.id), b = await mk(bia.id), s = await mk(null);
    await alert(a.d.id); await alert(b.d.id); await alert(s.d.id);
    expect((await getToday(as(ana), NOW)).late).toBe(2);
  });
});

describe("Hoje: próximas ações", () => {
  it("só as do usuário, vencidas primeiro e depois as de hoje; amanhã, concluídas, outra pessoa e comparecimento ficam de fora", async () => {
    const { ana, bia, mk, task } = await setup();
    const { c, d } = await mk(ana.id);
    await task(c, d, { title: "hoje 17h", dueAt: bahia(13, 17), assigneeId: ana.id });
    await task(c, d, { title: "vencida ontem", dueAt: bahia(12, 10), assigneeId: ana.id, kind: "retorno" });
    await task(c, d, { title: "amanhã", dueAt: bahia(14, 9), assigneeId: ana.id });
    await task(c, d, { title: "feita", dueAt: bahia(13, 9), assigneeId: ana.id, doneAt: bahia(13, 10) });
    await task(c, d, { title: "da Bia", dueAt: bahia(13, 9), assigneeId: bia.id });
    await task(c, d, { title: "comparecimento", dueAt: bahia(13, 9), assigneeId: ana.id, kind: "comparecimento" });
    const t = await getToday(as(ana), NOW);
    expect(t.tasks.map((x) => x.title)).toEqual(["vencida ontem", "hoje 17h"]);
    expect(t.tasks.map((x) => x.overdue)).toEqual([true, false]);
    expect(t.tasks[0]).toMatchObject({ dealId: d.id, name: c.name });
  });
  it("lead arquivado e contato ignorado saem das próximas ações", async () => {
    const { ana, mk, task } = await setup();
    const arq = await mk(ana.id, { archivedAt: new Date() }), ign = await mk(ana.id);
    await db.update(contacts).set({ ignored: true }).where(eq(contacts.id, ign.c.id));
    await task(arq.c, arq.d, { assigneeId: ana.id, dueAt: bahia(13, 9) });
    await task(ign.c, ign.d, { assigneeId: ana.id, dueAt: bahia(13, 9) });
    expect((await getToday(as(ana), NOW)).tasks).toHaveLength(0);
  });
});

describe("Hoje: comparecimentos", () => {
  it("agendados de ontem sem comparecimento e os de hoje cujo horário já passou; os de hoje à tarde e os já marcados não", async () => {
    const { ana, mk } = await setup();
    await mk(ana.id, { scheduledAt: bahia(12, 15) }, "agendado");
    await mk(ana.id, { scheduledAt: bahia(13, 10) }, "agendado");
    await mk(ana.id, { scheduledAt: bahia(13, 16) }, "agendado");
    await mk(ana.id, { scheduledAt: bahia(12, 9), attendance: "compareceu" }, "agendado");
    const t = await getToday(as(ana), NOW);
    expect(t.attendance.map((a) => a.scheduledAt)).toEqual([bahia(12, 15).toISOString(), bahia(13, 10).toISOString()]);
  });
});

describe("Hoje: o que está esperando e quem é vermelho", () => {
  it("só tem `late` quem tem alerta de espera aberto; passou do SLA sem alerta não é atrasado (uma regra só, a do contador)", async () => {
    const { ana, mk, alert } = await setup();
    const longe = new Date(Date.now() - 6 * 3_600_000);
    const comAlerta = await mk(ana.id, { awaitingReplySince: longe }, "lead");
    const semAlerta = await mk(ana.id, { awaitingReplySince: longe }, "lead");
    await alert(comAlerta.d.id);
    const t = await getToday(as(ana), NOW);
    const by = new Map(t.waiting.map((w) => [w.id, w.late]));
    expect(by.get(comAlerta.d.id)).toBe(true);
    expect(by.get(semAlerta.d.id)).toBe(false);
    expect(t.waiting.filter((w) => w.late).length).toBe(t.late); // o contador e as linhas vermelhas batem
  });
});

describe("Hoje: contato ignorado fica de fora", () => {
  it("esperando, agenda, follow-up, cobrança e contagem de novos não trazem lead de contato ignorado", async () => {
    const { ana, mk } = await setup();
    const agora = new Date();
    const mkIgn = async (kind: string, over: Partial<typeof deals.$inferInsert>) => {
      const x = await mk(ana.id, over, kind);
      await db.update(contacts).set({ ignored: true }).where(eq(contacts.id, x.c.id));
      return x;
    };
    const ign = [
      await mkIgn("lead", { awaitingReplySince: agora }),
      await mkIgn("agendado", { scheduledAt: agora }),
      await mkIgn("followup", {}),
      await mkIgn("atendimento", { chargeAt: agora }),
    ];
    const ok = [
      await mk(ana.id, { awaitingReplySince: agora }, "lead"),
      await mk(ana.id, { scheduledAt: agora }, "agendado"),
      await mk(ana.id, {}, "followup"),
      await mk(ana.id, { chargeAt: agora }, "atendimento"),
    ];
    const t = await getToday(as(ana), NOW);
    const ids = new Set([...t.waiting, ...t.scheduled, ...t.followups, ...t.dues].map((i) => i.id));
    for (const x of ign) expect(ids.has(x.d.id)).toBe(false);
    for (const x of ok) expect(ids.has(x.d.id)).toBe(true);
    expect(Number(t.counts.abertos)).toBe(4); // só os 4 do controle
  });
});
