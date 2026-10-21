import { describe, it, expect, beforeEach } from "vitest";
import { permsFor } from "../../../test/perms";
import { readFileSync } from "node:fs";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { db } from "./index";
import { alerts, contacts, deals, stages, users } from "./schema";
import { resetDb } from "../../../test/db";
import { waitKeyOf } from "../rules/wait-key";
import { countLateLeads } from "../queries/late-count";

const SQL = readFileSync(path.join(__dirname, "../../../drizzle/0010_wait_key_legado.sql"), "utf8");
const run = () => db.execute(sql.raw(SQL));

describe("0010: wait_key dos alertas de espera antigos", () => {
  beforeEach(resetDb);
  const legado = async (phone: string, since: string) => {
    const [st] = await db.select().from(stages).where(eq(stages.key, "lead"));
    const [c] = await db.insert(contacts).values({ phoneE164: phone, name: "Legado" }).returning();
    const [d] = await db.insert(deals).values({ contactId: c.id, stageId: st.id }).returning();
    // valor com microssegundos (como um now() do Postgres): a chave tem de bater com a que o motor calcula lendo pelo driver
    await db.execute(sql`update deals set awaiting_reply_since = ${since}::timestamptz where id = ${d.id}`);
    const [back] = await db.select().from(deals).where(eq(deals.id, d.id));
    return back;
  };
  const alerta = (dealId: string, o: { audience?: "gestao" | "responsavel"; createdAt?: Date; type?: "sem_resposta_minutos" | "parado_dias"; resolved?: boolean } = {}) =>
    db.insert(alerts).values({ dealId, audience: o.audience ?? "responsavel", type: o.type ?? "sem_resposta_minutos", severity: "urgente", message: "antigo",
      dedupeKey: `legado-${Math.random()}`, createdAt: o.createdAt ?? new Date(), ...(o.resolved ? { resolvedAt: new Date() } : {}) }).returning();

  it("preenche a chave no formato de waitKeyOf, um por espera (gestão primeiro), e o lead passa a contar como atrasado", async () => {
    const d = await legado("+5571999970001", "2026-10-01T12:00:00.123456Z");
    const [resp] = await alerta(d.id, { audience: "responsavel" });
    const [gest] = await alerta(d.id, { audience: "gestao" });
    const [gestor] = await db.insert(users).values({ name: "G", email: "g@c.com", role: "gestor", passwordHash: "x" }).returning();
    expect(await countLateLeads({ id: gestor.id, perms: permsFor("gestor") })).toBe(0);
    await run();
    const rows = await db.select().from(alerts).where(eq(alerts.dealId, d.id));
    expect(rows.find((r) => r.id === gest.id)!.waitKey).toBe(waitKeyOf(d.id, d.awaitingReplySince!));
    expect(rows.find((r) => r.id === gest.id)!.pushedAt).not.toBeNull(); // sem push de alerta antigo
    expect(rows.find((r) => r.id === resp.id)!.waitKey).toBeNull(); // um aberto por chave (alerts_wait_uq)
    expect(await countLateLeads({ id: gestor.id, perms: permsFor("gestor") })).toBe(1);
  });

  it("idempotente e não mexe em resolvido, outro tipo, lead sem espera, alerta de espera anterior, nem em quem já tem chave", async () => {
    const d = await legado("+5571999970002", "2026-10-01T12:00:00Z");
    const [velho] = await alerta(d.id, { createdAt: new Date("2026-09-30T12:00:00Z") }); // de uma espera anterior
    const [resolvido] = await alerta(d.id, { resolved: true });
    const [outro] = await alerta(d.id, { type: "parado_dias" });
    const semEspera = await legado("+5571999970003", "2026-10-01T12:00:00Z");
    await db.update(deals).set({ awaitingReplySince: null }).where(eq(deals.id, semEspera.id));
    const [semEsperaAlerta] = await alerta(semEspera.id);
    const comChave = await legado("+5571999970004", "2026-10-01T12:00:00Z");
    await db.insert(alerts).values({ dealId: comChave.id, audience: "responsavel", type: "sem_resposta_minutos", severity: "urgente", message: "novo", dedupeKey: "novo", waitKey: waitKeyOf(comChave.id, comChave.awaitingReplySince!) });
    const [antigoDoMesmo] = await alerta(comChave.id);
    await run(); await run();
    const byId = async (id: string) => (await db.select().from(alerts).where(eq(alerts.id, id)))[0].waitKey;
    for (const a of [velho, resolvido, outro, semEsperaAlerta, antigoDoMesmo]) expect(await byId(a.id)).toBeNull();
  });
});
