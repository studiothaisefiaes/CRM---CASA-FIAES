import { beforeEach, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import { appointments, deals, stages, tasks } from "../db/schema";
import { resetDb } from "../../../test/db";
import { NOW, ap, bahia, cliente, setupAgenda } from "../../../test/agenda-fixtures";
import { faltaPelaConversa } from "./falta-escolha";

// 02/11: a escolha do diálogo do Faltou ("Cancelou", "não remarcar") também vale na Fila e no Hoje (antes só a Agenda lia o cookie).
let s: Awaited<ReturnType<typeof setupAgenda>>;
beforeEach(async () => { await resetDb(); s = await setupAgenda(); });

async function agendada() {
  const c = await cliente("Paula Souza", { stage: "agendado", conversaHaDias: 0 });
  const a = await ap({ contactId: c.contactId, clientName: "Paula Souza", professionalId: s.ana.id, serviceId: s.corte.id, startsAt: bahia(15, 8), origin: "crm", dealId: c.dealId });
  await db.update(deals).set({ scheduledAt: a.startsAt }).where(eq(deals.id, c.dealId!));
  return { dealId: c.dealId!, apptId: a.id };
}
const remarcarAberto = async (dealId: string) =>
  (await db.select({ title: tasks.title }).from(tasks).where(and(eq(tasks.dealId, dealId), isNull(tasks.doneAt)))).filter((t) => t.title.startsWith("Remarcar"));

describe("Faltou pela conversa respeita a escolha do diálogo", () => {
  it("Cancelou: o horário vira Cancelado e a conversa não conta falta", async () => {
    const { dealId, apptId } = await agendada();
    expect(await faltaPelaConversa(dealId, { t: "cancelou", r: true }, s.recepcao, NOW)).toMatchObject({ changed: true, cancelou: true });
    const [a] = await db.select().from(appointments).where(eq(appointments.id, apptId));
    expect(a).toMatchObject({ status: "cancelado", cancelReason: "cliente_desmarcou" });
    const [d] = await db.select({ attendance: deals.attendance }).from(deals).where(eq(deals.id, dealId));
    expect(d.attendance).not.toBe("faltou");
    // A conversa sai de Agendado (senão o "Ela veio?" volta).
    const [k] = await db.select({ kind: stages.kind }).from(deals).innerJoin(stages, eq(stages.id, deals.stageId)).where(eq(deals.id, dealId));
    expect(k.kind).not.toBe("agendado");
  });
  it("Cancelou e não remarcar: sem o Remarcar na conversa", async () => {
    const { dealId } = await agendada();
    await faltaPelaConversa(dealId, { t: "cancelou", r: false }, s.recepcao, NOW);
    expect(await remarcarAberto(dealId)).toEqual([]);
  });
  it("Não veio e não remarcar: falta marcada, sem o Remarcar", async () => {
    const { dealId } = await agendada();
    expect(await faltaPelaConversa(dealId, { t: "faltou", r: false }, s.recepcao, NOW)).toMatchObject({ changed: true, remarcar: false });
    const [d] = await db.select({ attendance: deals.attendance }).from(deals).where(eq(deals.id, dealId));
    expect(d.attendance).toBe("faltou");
    expect(await remarcarAberto(dealId)).toEqual([]);
  });
  it("sem escolha: como sempre (falta com Remarcar)", async () => {
    const { dealId } = await agendada();
    expect(await faltaPelaConversa(dealId, null, s.recepcao, NOW)).toMatchObject({ changed: true, remarcar: true });
    expect((await remarcarAberto(dealId)).length).toBe(1);
  });
});
