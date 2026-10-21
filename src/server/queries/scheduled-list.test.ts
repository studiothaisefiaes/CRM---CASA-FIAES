import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { channels, deals, settings, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import { permsFor } from "../../../test/perms";
import { recordInbound } from "../domain/deals";
import { editScheduled, resume } from "../domain/retomada";
import { cancelScheduled, restoreScheduled } from "../domain/scheduled";
import { canTouchScheduled, countScheduled, listScheduled } from "./scheduled-list";

/** Mensagens programadas: a lista (escopo, filtros, "não saíram"), Editar, Cancelar e Desfazer. Nada é enviado aqui. */
const OPEN: [string, string] = ["09:00", "18:00"];
const HOURS = { 0: null, 1: null, 2: OPEN, 3: OPEN, 4: OPEN, 5: OPEN, 6: OPEN }; // ter–sáb 9h–18h
const T0 = new Date("2026-10-13T13:00:00Z"); // terça 10:00 em Salvador
const at = (iso: string) => new Date(`${iso}-03:00`);
let sara = "", bia = "", ch = "", dSara = "", dBia = "", dLivre = "";
const gestora = () => ({ id: "00000000-0000-0000-0000-000000000000", perms: permsFor("gestor") });
const daSara = () => ({ id: sara, perms: permsFor("atendente") });

async function conversa(phone: string, name: string, owner: string | null) {
  const r = await recordInbound({ channelId: ch, externalId: `IN-${phone}`, phoneRaw: phone, pushName: name, body: "Oi", at: new Date(T0.getTime() - 600_000), now: new Date(T0.getTime() - 600_000) });
  if (!("dealId" in r)) throw new Error("sem conversa");
  await db.update(deals).set({ ownerId: owner }).where(eq(deals.id, r.dealId));
  return r.dealId;
}
const programar = (dealId: string, texto: string, when: string, user = sara, extra: { motivo?: string; cancelIfReply?: boolean } = {}) =>
  resume(dealId, { dueAt: at(when), texto, ...extra }, user, T0);

beforeEach(async () => {
  await resetDb();
  await db.insert(settings).values({ key: "business_hours", value: HOURS });
  [{ id: sara }, { id: bia }] = await db.insert(users).values([
    { name: "Sara Lima", email: "sara@teste.local", role: "atendente", passwordHash: "x" },
    { name: "Bia Souza", email: "bia@teste.local", role: "atendente", passwordHash: "x" },
  ]).returning();
  [{ id: ch }] = await db.insert(channels).values({ name: "Recepção", instanceName: "rec-teste", status: "conectado", phone: "+557133330000" }).returning();
  dSara = await conversa("71999990041", "JULIANA PIRES", sara);
  dBia = await conversa("71999990042", "Carla Mendes", bia);
  dLivre = await conversa("71999990043", "Dora Lins", null);
});

describe("lista de mensagens programadas", () => {
  it("pendentes em ordem de envio, com cliente, texto, quem programou, motivo e 'cancela se responder'; filtros de período, busca e Minhas", async () => {
    await programar(dSara, "Oi, Juliana! Ficou alguma dúvida?", "2026-10-13T15:00", sara, { motivo: "Ver se ela decidiu" });
    await programar(dBia, "Oi, Carla! Tudo bem?", "2026-10-15T11:00", bia, { cancelIfReply: false });
    await programar(dLivre, "Oi, Dora!", "2026-10-30T10:00", sara);
    const all = await listScheduled(gestora(), { now: T0 });
    expect(all.total).toBe(3);
    expect(all.pending.map((r) => r.name)).toEqual(["JULIANA PIRES", "Carla Mendes", "Dora Lins"]);
    expect(all.pending[0]).toMatchObject({ dealId: dSara, text: "Oi, Juliana! Ficou alguma dúvida?", sendAt: at("2026-10-13T15:00").toISOString(), status: "pending",
      authorName: "Sara Lima", cancelIfReply: true, motivo: "Ver se ela decidiu", hasReminder: true });
    expect(all.pending[1]).toMatchObject({ cancelIfReply: false, motivo: null, authorName: "Bia Souza" });
    expect((await listScheduled(gestora(), { now: T0, range: "hoje" })).pending.map((r) => r.dealId)).toEqual([dSara]);
    expect((await listScheduled(gestora(), { now: T0, range: "7d" })).pending.map((r) => r.dealId)).toEqual([dSara, dBia]);
    expect((await listScheduled(gestora(), { now: T0, q: "carla" })).pending.map((r) => r.dealId)).toEqual([dBia]);
    expect((await listScheduled({ id: bia, perms: permsFor("gestor") }, { now: T0, mine: true })).pending.map((r) => r.dealId)).toEqual([dBia]);
    expect(await countScheduled(gestora())).toBe(3);
  });

  it("atendente sem 'Ver conversas de todas': as conversas dela e as sem dona (e as que ela programou); não mexe nas outras", async () => {
    await programar(dSara, "Oi, Juliana!", "2026-10-14T10:00");
    const daBia = (await programar(dBia, "Oi, Carla!", "2026-10-14T11:00", bia)).outboxId!;
    await programar(dLivre, "Oi, Dora!", "2026-10-14T12:00", bia);
    const l = await listScheduled(daSara(), { now: T0 });
    expect(l.pending.map((r) => r.dealId)).toEqual([dSara, dLivre]);
    expect(await countScheduled(daSara())).toBe(2);
    expect(await canTouchScheduled(daSara(), daBia)).toBeNull();
    expect(await canTouchScheduled(gestora(), daBia)).toEqual({ dealId: dBia });
  });

  it("Cancelar sai da lista e aparece em 'não saíram' com o motivo; Desfazer volta (só antes da hora)", async () => {
    const r = await programar(dSara, "Oi, Juliana!", "2026-10-14T10:00");
    await cancelScheduled(r.outboxId!, sara, "Cancelada em Mensagens programadas.");
    let l = await listScheduled(gestora(), { now: T0 });
    expect(l.pending).toHaveLength(0);
    expect(l.recent).toMatchObject([{ id: r.outboxId, status: "cancelled", error: "Cancelada em Mensagens programadas." }]);
    expect(l.recent[0].statusAt).not.toBeNull();
    await restoreScheduled(r.outboxId!, sara, T0);
    l = await listScheduled(gestora(), { now: T0 });
    expect(l.pending.map((x) => x.id)).toEqual([r.outboxId]);
    expect(l.recent).toHaveLength(0);
    await cancelScheduled(r.outboxId!, sara);
    await expect(restoreScheduled(r.outboxId!, sara, at("2026-10-14T10:30"))).rejects.toThrow(/desfazer/);
  });

  it("Editar troca texto, dia e hora (a antiga some, sem aparecer em 'não saíram'); se a nova não puder sair, a antiga volta", async () => {
    const r = await programar(dSara, "Oi, Juliana!", "2026-10-14T10:00");
    const e = await editScheduled(r.outboxId!, { dueAt: at("2026-10-16T15:30"), texto: "Oi, Juliana! Lembrando da manutenção.", cancelIfReply: false }, sara, T0);
    let l = await listScheduled(gestora(), { now: T0 });
    expect(l.pending).toHaveLength(1);
    expect(l.pending[0]).toMatchObject({ id: e.outboxId, text: "Oi, Juliana! Lembrando da manutenção.", sendAt: at("2026-10-16T15:30").toISOString(), cancelIfReply: false });
    expect(l.recent).toHaveLength(0);
    // Menos de 5 min: não programa e a de antes continua.
    await expect(editScheduled(e.outboxId!, { dueAt: new Date(T0.getTime() + 60_000), texto: "Oi!" }, sara, T0)).rejects.toThrow(/5 minutos/);
    l = await listScheduled(gestora(), { now: T0 });
    expect(l.pending.map((x) => [x.id, x.text])).toEqual([[e.outboxId, "Oi, Juliana! Lembrando da manutenção."]]);
    await cancelScheduled(e.outboxId!, sara);
    await expect(editScheduled(e.outboxId!, { dueAt: at("2026-10-16T15:30"), texto: "Oi!" }, sara, T0)).rejects.toThrow(/já saiu ou já foi cancelada/);
  });
});
