import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { deals, users } from "../db/schema";
import { recordInbound } from "./deals";
import { resetDb } from "../../../test/db";
import { etapasAntigasAtivas } from "../../../test/legacy-stages"; // histórico de antes da nova organização (16/10)

// A sessão e o cache do Next só existem dentro de uma requisição: aqui a ação roda com uma atendente fixa.
const session = vi.hoisted(() => ({ user: null as null | { id: string; name: string; email: string; perms: string[] } }));
vi.mock("@/server/auth/session", () => {
  const get = async () => { if (!session.user) throw new Error("Sua sessão expirou. Entre de novo."); return session.user; };
  return { assertUser: get, assertPerm: get, assertAnyPerm: get };
});
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { moveDealAction } from "@/app/(app)/funil/actions";
import { permsFor } from "../../../test/perms";
import { assertDirectMove, OWN_ACTION_STAGE_KINDS } from "./stage-move";

let dealId = "";
beforeEach(async () => {
  await resetDb(); await etapasAntigasAtivas();
  const [ana] = await db.insert(users).values({ name: "Ana", email: "ana@c.com", role: "atendente", passwordHash: "x" }).returning();
  session.user = { id: ana.id, name: ana.name, email: ana.email, perms: permsFor("atendente") };
  const r = await recordInbound({ channelId: null, externalId: "M1", phoneRaw: "71999770001", body: "oi" });
  if (!("dealId" in r)) throw new Error("sem lead");
  dealId = r.dealId;
});
const stageKeyOf = async () => (await db.execute<{ key: string }>(`select s.key from deals d join stages s on s.id = d.stage_id where d.id = '${dealId}'`)).rows[0].key;

describe("moveDealAction: destinos que pedem dados", () => {
  it("recusa agendado, fechado e perdido: exigem a ação própria (data, valor/pagamento ou motivo)", async () => {
    for (const key of ["agendado", "fechado", "perdido"]) {
      const r = await moveDealAction(dealId, key);
      expect(r).toEqual({ ok: false, error: "Use a ação própria" });
    }
    expect(await stageKeyOf()).toBe("lead");
    const [d] = await db.select().from(deals).where(eq(deals.id, dealId));
    expect(d.closedAt).toBeNull();
    expect(d.scheduledAt).toBeNull();
  });

  it("segue movendo as etapas comuns, e reabrir também", async () => {
    expect(await moveDealAction(dealId, "atendimento")).toEqual({ ok: true });
    expect(await stageKeyOf()).toBe("atendimento");
    expect(await moveDealAction(dealId, "followup_1")).toEqual({ ok: true });
    expect(await stageKeyOf()).toBe("followup_1");
  });

  it("etapa que não existe não é 'ação própria': erro comum, sem mover", async () => {
    const r = await moveDealAction(dealId, "nao_existe");
    expect(r.ok).toBe(false);
    expect(await stageKeyOf()).toBe("lead");
  });
});

describe("assertDirectMove", () => {
  it("lista as etapas que pedem a ação própria", () => { expect([...OWN_ACTION_STAGE_KINDS].sort()).toEqual(["agendado", "fechado", "perdido"]); });
  it("Na Casa pode ser escolhida no menu de etapas (pedido do dono, 16/10)", async () => {
    expect((await moveDealAction(dealId, "na_casa")).ok).toBe(true);
    expect(await stageKeyOf()).toBe("na_casa");
  });
  it("passa para etapa comum e recusa as outras", async () => {
    await expect(assertDirectMove("atendimento")).resolves.toBeUndefined();
    await expect(assertDirectMove("perdido")).rejects.toThrow("Use a ação própria");
  });
});
