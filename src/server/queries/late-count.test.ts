import { beforeEach, describe, expect, it } from "vitest";
import { permsFor } from "../../../test/perms";
import { db } from "../db";
import { alerts, contacts, deals, stages, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import { countLateLeads } from "./late-count";

beforeEach(async () => { await resetDb(); });

async function setup() {
  const [ana] = await db.insert(users).values({ name: "Ana", email: "a@c.com", role: "atendente", passwordHash: "x" }).returning();
  const [bia] = await db.insert(users).values({ name: "Bia", email: "b@c.com", role: "atendente", passwordHash: "x" }).returning();
  const [gestora] = await db.insert(users).values({ name: "Gestora", email: "g@c.com", role: "gestor", passwordHash: "x" }).returning();
  const [stage] = await db.select().from(stages).limit(1);
  let n = 0;
  const lead = async (ownerId: string | null, over: { archivedAt?: Date; ignored?: boolean } = {}) => {
    n++;
    const [c] = await db.insert(contacts).values({ name: `C${n}`, phoneE164: `+55719999000${n}`, ignored: over.ignored ?? false }).returning();
    const [d] = await db.insert(deals).values({ contactId: c.id, stageId: stage.id, ownerId, archivedAt: over.archivedAt ?? null }).returning();
    return d;
  };
  let k = 0;
  const alert = (dealId: string, over: Partial<typeof alerts.$inferInsert> = {}) =>
    db.insert(alerts).values({ dealId, audience: "responsavel", type: "sem_resposta_minutos", severity: "urgente", message: "m", dedupeKey: `k${++k}`, waitKey: `espera:${dealId}:${k}`, ...over });
  return { ana, bia, gestora, lead, alert };
}
const asUser = (u: { id: string; name: string; email: string; role: "gestor" | "atendente" }) => ({ id: u.id, name: u.name, email: u.email, perms: permsFor(u.role) });

describe("countLateLeads", () => {
  it("conta leads distintos com alerta de espera aberto; nível 1 e 2 do mesmo lead conta 1", async () => {
    const { gestora, ana, lead, alert } = await setup();
    const d1 = await lead(ana.id), d2 = await lead(ana.id);
    await alert(d1.id, { userId: ana.id });
    await alert(d1.id, { audience: "gestao", level: 2, waitKey: "espera:outro" });
    await alert(d2.id, { userId: ana.id });
    expect(await countLateLeads(asUser(gestora))).toBe(2);
  });
  it("tarefa, alerta sem wait_key e alerta resolvido não contam", async () => {
    const { gestora, ana, lead, alert } = await setup();
    const d = await lead(ana.id), e = await lead(ana.id), f = await lead(ana.id);
    await alert(d.id, { type: "tarefa_vencida", waitKey: "task:123" });
    await alert(e.id, { waitKey: null });
    await alert(f.id, { resolvedAt: new Date() });
    expect(await countLateLeads(asUser(gestora))).toBe(0);
  });
  it("lead arquivado e contato ignorado não contam", async () => {
    const { gestora, ana, lead, alert } = await setup();
    const arq = await lead(ana.id, { archivedAt: new Date() }), ign = await lead(ana.id, { ignored: true }), ok = await lead(ana.id);
    await alert(arq.id); await alert(ign.id); await alert(ok.id);
    expect(await countLateLeads(asUser(gestora))).toBe(1);
  });
  it("atendente conta os leads dela e os sem dono (o mesmo escopo da Fila); gestor conta todos", async () => {
    const { gestora, ana, bia, lead, alert } = await setup();
    const da = await lead(ana.id), db_ = await lead(bia.id), sem = await lead(null);
    await alert(da.id, { userId: ana.id });
    await alert(db_.id, { userId: bia.id });
    await alert(sem.id, { userId: null, audience: "gestao" });
    expect(await countLateLeads(asUser(ana))).toBe(2); // o dela + o sem dono
    expect(await countLateLeads(asUser(bia))).toBe(2);
    expect(await countLateLeads(asUser(gestora))).toBe(3);
    // variante "só os dela" (resumo do dia e links vindos dos relatórios)
    expect(await countLateLeads(asUser(ana), { onlyOwn: true })).toBe(1);
    expect(await countLateLeads(asUser(gestora), { onlyOwn: true })).toBe(3);
  });
});
