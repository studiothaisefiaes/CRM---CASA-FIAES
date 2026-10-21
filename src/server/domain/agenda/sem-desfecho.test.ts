import { beforeEach, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { appointments, auditLog, messages } from "../../db/schema";
import { resetDb } from "../../../../test/db";
import { ap, bahia, cliente, setupAgenda } from "../../../../test/agenda-fixtures";
import { item } from "../../../../test/salon-fixtures";
import { marcarSemDesfecho } from "./sem-desfecho";

const NOW = bahia(19, 12);
let s: Awaited<ReturnType<typeof setupAgenda>>;
beforeEach(async () => { await resetDb(); s = await setupAgenda(); });
const get = async (id: string) => (await db.select().from(appointments).where(eq(appointments.id, id)))[0];

it("Chegou e passados sem venda e sem conversa viram 'sem desfecho'; com venda ou conversa recente, hoje e futuro ficam; nunca Faltou/Compareceu; idempotente", async () => {
  const a = await cliente("Ana Teste"), b = await cliente("Bia Teste"), c = await cliente("Cris Teste"), d = await cliente("Dora Teste");
  const chegou = await ap({ startsAt: bahia(17, 10), contactId: a.contactId, professionalId: s.ana.id, status: "chegou" });
  const velho = await ap({ startsAt: bahia(10, 10), contactId: b.contactId, professionalId: s.ana.id, status: "confirmado" });
  const comVenda = await ap({ startsAt: bahia(12, 10), contactId: c.contactId, professionalId: s.ana.id, status: "agendado" });
  await item({ day: "2026-10-12", value: 10000, contactId: c.contactId });
  const comConversa = await ap({ startsAt: bahia(14, 10), contactId: d.contactId, professionalId: s.ana.id, status: "agendado" });
  await db.insert(messages).values({ contactId: d.contactId, direction: "in", kind: "text", status: "received", createdAt: bahia(18, 9) } as never);
  const hoje = await ap({ startsAt: bahia(19, 9), contactId: a.contactId, professionalId: s.bia.id, status: "agendado" });
  const futuro = await ap({ startsAt: bahia(25, 9), contactId: b.contactId, professionalId: s.bia.id, status: "confirmado" });

  const seco = await marcarSemDesfecho({ apply: false, now: NOW });
  expect(seco).toMatchObject({ chegou: 1, agendados: 1, comVenda: 1, comConversa: 1 });
  expect((await get(chegou.id)).status).toBe("chegou"); // dry-run não grava

  await marcarSemDesfecho({ apply: true, now: NOW });
  expect(await get(chegou.id)).toMatchObject({ status: "conferir", avecStatus: "chegou" });
  expect(await get(velho.id)).toMatchObject({ status: "conferir", avecStatus: "confirmado" });
  for (const x of [comVenda, comConversa, hoje, futuro]) expect((await get(x.id)).status).toBe(x.status);
  const logs = (await db.select().from(auditLog)).filter((l) => l.action === "horario_sem_desfecho");
  expect(logs.map((l) => (l.data as { de: string }).de).sort()).toEqual(["chegou", "confirmado"]);

  expect(await marcarSemDesfecho({ apply: true, now: NOW })).toMatchObject({ chegou: 0, agendados: 0 });
  expect((await db.select().from(auditLog)).filter((l) => l.action === "horario_sem_desfecho")).toHaveLength(2);
  expect((await db.select().from(appointments)).filter((x) => x.status === "faltou" || x.status === "compareceu")).toHaveLength(0);
});
