import { beforeEach, expect, it } from "vitest";
import { db } from "../db";
import { alerts, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import { permsFor } from "../../../test/perms";
import { resolveAlerts } from "./alert-actions";
import { getMyAlerts } from "../queries/alerts";
import type { SessionUser } from "../auth/sessions-store";

beforeEach(async () => { await resetDb(); });

it("Resolver: só os avisos de quem resolve; a espera não se resolve pelo sino; a gestão resolve os dela", async () => {
  const [ana] = await db.insert(users).values({ name: "Ana", email: "a@c.com", role: "atendente", passwordHash: "x" }).returning();
  const [bia] = await db.insert(users).values({ name: "Bia", email: "b@c.com", role: "atendente", passwordHash: "x" }).returning();
  const [gest] = await db.insert(users).values({ name: "G", email: "g@c.com", role: "gestor", passwordHash: "x" }).returning();
  const mk = (over: Partial<typeof alerts.$inferInsert>) => db.insert(alerts).values({ audience: "responsavel", type: "tarefa_vencendo", severity: "info", message: "m", dedupeKey: crypto.randomUUID(), ...over }).returning().then((r) => r[0]);
  const tarefa = await mk({ userId: ana.id, waitKey: "task:1" });
  const espera = await mk({ userId: ana.id, type: "sem_resposta_minutos", waitKey: "00000000-0000-4000-8000-000000000001:2026-10-15T12:00:00.000Z" });
  const daBia = await mk({ userId: bia.id });
  const gestao = await mk({ audience: "gestao", type: "envio_automatico_falhou" });
  const asAna = { id: ana.id, perms: permsFor("atendente") }, asGest = { id: gest.id, perms: permsFor("gestor") };

  expect(await resolveAlerts(asAna, [tarefa.id, espera.id, daBia.id, gestao.id])).toBe(1);
  expect(await resolveAlerts(asGest, [gestao.id])).toBe(1);
  const rows = new Map((await db.select().from(alerts)).map((a) => [a.id, !!a.resolvedAt]));
  expect([rows.get(tarefa.id), rows.get(espera.id), rows.get(daBia.id), rows.get(gestao.id)]).toEqual([true, false, false, true]);

  const anaVe = await getMyAlerts(asAna as SessionUser);
  expect(anaVe.find((a) => a.id === espera.id)).toMatchObject({ forMe: true, forGestao: false, resolvable: false });
  const novo = await mk({ audience: "gestao", type: "whatsapp_desconectado" });
  expect((await getMyAlerts(asGest as SessionUser)).find((a) => a.id === novo.id)).toMatchObject({ forMe: false, forGestao: true, resolvable: true });
  // o aviso "outra pessoa respondeu" (Lote 1A, sem wait_key) se resolve pelo sino
  const respondida = await mk({ userId: ana.id, type: "respondida_por_outra" });
  expect((await getMyAlerts(asAna as SessionUser)).find((a) => a.id === respondida.id)).toMatchObject({ forMe: true, resolvable: true });
});
