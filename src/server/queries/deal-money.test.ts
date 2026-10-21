import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { contacts, dealEvents, deals, stages } from "../db/schema";
import { getDealDetail } from "./deal";
import { getBoard } from "./board";
import { canSeeDealMoney } from "@/lib/permissions";
import { permsFor } from "../../../test/perms";
import { resetDb } from "../../../test/db";
import { etapasAntigasAtivas } from "../../../test/legacy-stages"; // histórico de antes da nova organização (16/10)

/** Valor de venda só para quem vê valores ou registra venda (atendente e recepção veem o que fecham); perfil sem venda nem valores, não. */
describe("valor da venda no lead e no Quadro", () => {
  let dealId = "", oldId = "";
  beforeEach(async () => {
    await resetDb(); await etapasAntigasAtivas();
    const [st] = await db.select().from(stages).where(eq(stages.key, "fechado"));
    const [ct] = await db.insert(contacts).values({ name: "Vera", phoneE164: "+5571999990555" }).returning();
    const [old] = await db.insert(deals).values({ contactId: ct.id, stageId: st.id, valueCents: 30_000, closedAt: new Date(Date.now() - 86_400_000 * 40), createdAt: new Date(Date.now() - 86_400_000 * 41) }).returning();
    const [d] = await db.insert(deals).values({ contactId: ct.id, stageId: st.id, valueCents: 48_000, closedAt: new Date() }).returning();
    dealId = d.id; oldId = old.id;
  });

  it("quem pode: gestão, atendente e recepção (registram venda); quem não pode: perfil sem venda nem valores", () => {
    expect(canSeeDealMoney(permsFor("gestor"))).toBe(true);
    expect(canSeeDealMoney(permsFor("atendente"))).toBe(true);
    expect(canSeeDealMoney(permsFor("recepcao"))).toBe(true);
    expect(canSeeDealMoney(["atendimento.ver", "quadro.ver"])).toBe(false);
  });

  it("sem permissão, o detalhe do lead vem sem valor (nem no histórico de leads)", async () => {
    await db.update(deals).set({ paidCents: 48_000 }).where(eq(deals.id, dealId));
    const d = (await getDealDetail(dealId, { money: false }))!;
    expect(d.deal.valueCents).toBeNull();
    expect(d.deal.paidCents).toBeNull(); // valor pago também é R$
    expect(d.history.find((h) => h.id === oldId)!.valueCents).toBeNull();
    const full = (await getDealDetail(dealId))!;
    expect(full.deal.valueCents).toBe(48_000);
  });

  it("sem permissão, o card do Quadro vem sem valor", async () => {
    const semVenda = { id: "00000000-0000-4000-8000-000000000001", perms: ["atendimento.ver", "quadro.ver", "atendimento.todas"] as const };
    const board = await getBoard({}, { ...semVenda, perms: [...semVenda.perms] });
    const card = board.flatMap((s) => s.cards).find((x) => x.id === dealId)!;
    expect(card.valueCents).toBeNull();
    const gest = await getBoard({}, { id: semVenda.id, perms: permsFor("gestor") });
    expect(gest.flatMap((s) => s.cards).find((x) => x.id === dealId)!.valueCents).toBe(48_000);
  });

  it("sem permissão, o histórico não mostra valores (mudança de valor e venda) e o detalhe avisa que é sem valores", async () => {
    await db.insert(dealEvents).values([
      { dealId, type: "campo_alterado", payload: { campos: [{ campo: "valueCents", de: 10_000, para: 15_000 }, { campo: "observations", de: null, para: "oi" }] } },
      { dealId, type: "venda", payload: { valueCents: 48_000 } },
    ]);
    const d = (await getDealDetail(dealId, { money: false }))!;
    expect(d.money).toBe(false);
    const campo = d.events.find((e) => e.type === "campo_alterado")!.payload as { campos: { campo: string }[] };
    expect(campo.campos.map((c) => c.campo)).toEqual(["observations"]);
    expect((d.events.find((e) => e.type === "venda")!.payload as Record<string, unknown>).valueCents).toBeUndefined();
    expect((await getDealDetail(dealId))!.money).toBe(true);
  });
});
