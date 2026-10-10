import { it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db"; import { dealEvents, deals, users, lists } from "../db/schema";
import { recordInbound, recordOutbound } from "./deals"; import { updateDeal, closeSale, setAttendance } from "./updates";
import { claimDeal } from "./assign"; import { resetDb } from "../../../test/db";
let ana = "", bia = "";
beforeEach(async () => { await resetDb(); [{ id: ana }, { id: bia }] = await db.insert(users).values([{ name: "Ana", email: "a@c.com", role: "atendente", passwordHash: "x" }, { name: "Bia", email: "b@c.com", role: "atendente", passwordHash: "x" }]).returning(); });
const lead = async () => { const r = await recordInbound({ channelId: null, externalId: Math.random().toString(), phoneRaw: "71999992222", body: "oi" }); if (!("dealId" in r)) throw new Error(); return r.dealId; };
it("auditoria guarda de/para", async () => {
  const id = await lead();
  await updateDeal(id, { observations: "quer luzes" }, ana);
  await updateDeal(id, { observations: "quer luzes e corte" }, bia);
  const ev = (await db.select().from(dealEvents).where(eq(dealEvents.type, "campo_alterado"))).at(-1)!;
  expect(ev.payload).toEqual({ campos: [{ campo: "observations", de: "quer luzes", para: "quer luzes e corte" }] });
  expect(ev.userId).toBe(bia);
});
it("auditoria ignora campos que não mudaram", async () => {
  const id = await lead();
  await updateDeal(id, { observations: "x" }, ana);
  await updateDeal(id, { observations: "x" }, ana);
  expect((await db.select().from(dealEvents).where(eq(dealEvents.type, "campo_alterado"))).length).toBe(1);
});
it("assumir atribui a resposta dada pelo celular", async () => {
  const id = await lead();
  await updateDeal(id, { ownerId: ana }, ana); // o rodízio escolhe ao acaso; fixa a dona antes de assumir
  const r = await claimDeal(id, bia);
  expect(r.previousOwnerId).toBe(ana);
  await recordOutbound({ phoneRaw: "557199992222@s.whatsapp.net", channelId: null, externalId: "X", body: "oi", fromPhone: true });
  const [resp] = await db.select().from(dealEvents).where(eq(dealEvents.type, "resposta"));
  expect(resp.userId).toBe(bia);
  expect(resp.payload).toMatchObject({ stage: "lead" });
  expect(resp.payload).toHaveProperty("slaSeconds");
  const [as] = await db.select().from(dealEvents).where(eq(dealEvents.type, "assumiu"));
  expect(as.userId).toBe(bia);
});
it("fechar venda grava serviço, valor e pagamento, sem duplicar", async () => {
  const id = await lead();
  const [svc] = await db.select().from(lists).where(eq(lists.kind, "service"));
  await closeSale(id, { serviceId: svc.id, valueCents: 115850, paymentMethod: "pix", paidNow: true }, ana);
  await closeSale(id, { serviceId: svc.id, valueCents: 115850, paymentMethod: "pix", paidNow: true }, ana);
  const [d] = await db.select().from(deals).where(eq(deals.id, id));
  expect(d).toMatchObject({ serviceId: svc.id, valueCents: 115850, paymentMethod: "pix", paidCents: 115850 });
  expect(d.paidAt).not.toBeNull(); expect(d.closedAt).not.toBeNull();
  expect((await db.select().from(dealEvents).where(eq(dealEvents.type, "venda"))).length).toBe(1);
});
it("fechar venda sem pagar agora não marca pago", async () => {
  const id = await lead();
  const [svc] = await db.select().from(lists).where(eq(lists.kind, "service"));
  await closeSale(id, { serviceId: svc.id, valueCents: 5000, paymentMethod: "cartao", paidNow: false }, ana);
  const [d] = await db.select().from(deals).where(eq(deals.id, id));
  expect(d.paidAt).toBeNull(); expect(d.paidCents).toBeNull();
});
it("origem ≠ canal: mensagem comum fica sem origem identificada", async () => {
  const id = await lead();
  const [d] = await db.select().from(deals).where(eq(deals.id, id));
  expect(d.sourceId).toBeNull(); expect(d.sourceLabel).toBeNull();
  expect(d.origin).toBe("WhatsApp");
});
it("comparecimento valida o valor e registra evento", async () => {
  const id = await lead();
  await setAttendance(id, "faltou", ana);
  const [d] = await db.select().from(deals).where(eq(deals.id, id));
  expect(d.attendance).toBe("faltou"); expect(d.attendanceAt).not.toBeNull();
  expect((await db.select().from(dealEvents).where(eq(dealEvents.type, "comparecimento"))).length).toBe(1);
  await expect(setAttendance(id, "xis" as never, ana)).rejects.toThrow();
  await expect(updateDeal(id, { attendance: "xis" as never }, ana)).rejects.toThrow();
});
