import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { professionals } from "../db/schema";
import { resetDb } from "../../../test/db";
import { ap, bahia, cliente, setupAgenda } from "../../../test/agenda-fixtures";
import { dayVisitsOf } from "./day-visit";
import { getLiveBoardData } from "./ao-vivo";

let s: Awaited<ReturnType<typeof setupAgenda>>;
beforeEach(async () => { await resetDb(); s = await setupAgenda(); });

describe("Ao vivo: os dados do dia", () => {
  it("as visitas do dia (as mesmas do Hoje), o início real de cada horário e as profissionais na ordem da Agenda, com a assistente", async () => {
    await db.update(professionals).set({ assistantOf: s.ana.id, photoPath: "profissionais/x/1760000000000.png" }).where(eq(professionals.id, s.bia.id));
    const [inativa] = await db.insert(professionals).values({ name: "DORA", active: false }).returning();
    const p = await cliente("Paula");
    const r = await cliente("Rita");
    const a = await ap({ startsAt: bahia(17, 9), professionalId: s.bia.id, contactId: p.contactId, status: "em_atendimento", startedAt: bahia(17, 9, 10) });
    await ap({ startsAt: bahia(17, 11), professionalId: inativa.id, contactId: r.contactId });
    await ap({ startsAt: bahia(18, 11), professionalId: s.ana.id, contactId: r.contactId }); // outro dia

    const d = await getLiveBoardData(bahia(17, 10));
    expect(d.day).toBe("2026-10-17");
    expect(d.visits).toEqual(await dayVisitsOf("2026-10-17", { withValues: false }));
    expect(d.startedAt).toEqual({ [a.id]: bahia(17, 9, 10).toISOString() });
    expect(d.pros.map((x) => [x.name, x.assistantOf])).toEqual([["Ana", null], ["Bia", s.ana.id], ["Dora", null]]); // inativa com horário hoje entra
    expect(d.pros.find((x) => x.name === "Bia")!.photoUrl).toBe(`/api/profissionais/${s.bia.id}/foto?v=1760000000000`);
  });
});
