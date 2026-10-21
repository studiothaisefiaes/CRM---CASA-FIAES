// src/server/queries/team-now.test.ts
import { beforeEach, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { contacts, deals, messages, profiles, stages, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import { getTeamNow } from "./team-now";

const NOW = new Date("2026-10-15T15:00:00Z");
const minAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);
beforeEach(resetDb);

it("cada pessoa com estado, esperando, dela e a última resposta; quem não fez nada (e convite pendente) fica de fora", async () => {
  const [atendente] = await db.select().from(profiles).where(eq(profiles.key, "atendente")); // recebe da distribuição
  const [sara] = await db.insert(users).values({ name: "Sara Lima", email: "s@c.com", role: "atendente", passwordHash: "x", signature: "SARA", availability: "ausente", profileId: atendente.id }).returning();
  const [cati] = await db.insert(users).values({ name: "Catarina Moura", email: "c@c.com", role: "gestor", passwordHash: "x", signature: "CATI", availability: "disponivel", lastSeenAt: minAgo(2) }).returning();
  await db.insert(users).values({ name: "Joaquim", email: "j@c.com", role: "gestor", passwordHash: "x" });
  await db.insert(users).values({ name: "Convite", email: "v@c.com", role: "atendente", passwordHash: null, availability: "disponivel", lastSeenAt: minAgo(1) });
  const [lead] = await db.select().from(stages).where(eq(stages.key, "lead"));
  let n = 0;
  const mk = async (ownerId: string | null, awaiting: boolean, extra: { ignored?: boolean } = {}) => {
    n++;
    const [c] = await db.insert(contacts).values({ name: `C${n}`, phoneE164: `+5571999000${String(n).padStart(3, "0")}`, ignored: extra.ignored ?? false }).returning();
    return (await db.insert(deals).values({ contactId: c.id, stageId: lead.id, ownerId, awaitingReplySince: awaiting ? minAgo(5) : null }).returning())[0];
  };
  const d1 = await mk(sara.id, true); await mk(sara.id, false); await mk(sara.id, true, { ignored: true });
  await mk(null, true); await mk(null, false);
  await db.insert(messages).values({ dealId: d1.id, contactId: d1.contactId, direction: "out", body: "*SARA - CASA FIAES:*\nOi", sentByUserId: sara.id, sentVia: "celular", fromPhone: true, createdAt: minAgo(4) });

  const t = await getTeamNow(NOW);
  expect(t.members).toEqual([
    { id: sara.id, name: "Sara", state: "respondendo", waiting: 1, mine: 2, lastReplyAt: minAgo(4).toISOString(), lastReplyVia: "celular", receives: true },
    { id: cati.id, name: "Cati", state: "no_crm", waiting: 0, mine: 0, lastReplyAt: null, lastReplyVia: null, receives: false }, // sem perfil que recebe: fica fora da linha da Fila
  ]);
  expect(t.unowned).toEqual({ waiting: 1, total: 2 });
});

it("a profissional (só o app) nunca aparece em 'Equipe agora', mesmo com o CRM aberto", async () => {
  const [prof] = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.key, "profissional"));
  await db.insert(users).values({ name: "Maiara Lima", email: "m@c.com", role: "atendente", passwordHash: "x", profileId: prof.id, availability: "disponivel", lastSeenAt: minAgo(1) });
  await db.insert(users).values({ name: "Cati", email: "c2@c.com", role: "gestor", passwordHash: "x", availability: "disponivel", lastSeenAt: minAgo(1) });
  const t = await getTeamNow(NOW);
  expect(t.members.map((m) => m.name)).toEqual(["Cati"]);
});
