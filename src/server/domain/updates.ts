import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { contacts, deals, auditLog } from "../db/schema";
import { normalizePhone } from "./phone";
import { logEvent, emit } from "./events";
import { findOpenDeal, stageByKey } from "./deals";

const dateOrNull = z.union([z.string().datetime({ offset: true }), z.literal(""), z.null()]).transform((v) => (v ? new Date(v) : null));
const uuidOrNull = z.union([z.string().uuid(), z.literal(""), z.null()]).transform((v) => v || null);

export const dealPatchSchema = z.object({
  name: z.string().trim().max(120).nullable().optional(),
  email: z.union([z.string().trim().email("E-mail inválido"), z.literal("")]).nullable().optional(),
  instagram: z.string().trim().max(60).nullable().optional(),
  birthday: z.union([z.string().regex(/^\d{1,2}\/\d{1,2}(\/\d{4})?$/, "Use dia/mês, ex.: 14/11"), z.literal(""), z.null()]).optional(),
  observations: z.string().max(4000).nullable().optional(),
  objectionId: uuidOrNull.optional(),
  lostReasonId: uuidOrNull.optional(),
  ownerId: uuidOrNull.optional(),
  origin: z.string().trim().min(1).max(40).optional(),
  valueCents: z.union([z.number().int().min(0).max(1_000_000_000), z.null()]).optional(),
  paymentMethod: z.union([z.enum(["pix", "cartao", "boleto", "dinheiro"]), z.literal(""), z.null()]).optional(),
  scheduledAt: dateOrNull.optional(),
  chargeAt: dateOrNull.optional(),
  recontactAt: dateOrNull.optional(),
});
export type DealPatch = z.input<typeof dealPatchSchema>;

const FIELD_LABELS: Record<string, string> = {
  name: "Nome", email: "E-mail", instagram: "Instagram", birthday: "Aniversário", observations: "Observações", objectionId: "Objeção",
  lostReasonId: "Motivo de perda", ownerId: "Responsável", origin: "Origem", valueCents: "Valor", paymentMethod: "Forma de pagamento",
  scheduledAt: "Agendamento", chargeAt: "Data de cobrança", recontactAt: "Data de recontato",
};

export async function updateDeal(dealId: string, raw: DealPatch, userId: string) {
  const patch = dealPatchSchema.parse(raw);
  await db.transaction(async (tx) => {
    const [deal] = await tx.select().from(deals).where(eq(deals.id, dealId));
    if (!deal) throw new Error("Lead não encontrado");
    const contactSet: Partial<typeof contacts.$inferInsert> = {};
    if (patch.name !== undefined) contactSet.name = patch.name || null;
    if (patch.email !== undefined) contactSet.email = patch.email || null;
    if (patch.instagram !== undefined) contactSet.instagram = patch.instagram ? patch.instagram.replace(/^@/, "").replace(/^https?:\/\/(www\.)?instagram\.com\//, "").replace(/\/$/, "") : null;
    if (patch.birthday !== undefined) {
      if (!patch.birthday) Object.assign(contactSet, { birthDay: null, birthMonth: null, birthYear: null });
      else {
        const [d, m, y] = patch.birthday.split("/").map(Number);
        const test = new Date(Date.UTC(y || 2000, m - 1, d));
        if (test.getUTCMonth() !== m - 1 || test.getUTCDate() !== d) throw new Error("Data de aniversário inválida");
        Object.assign(contactSet, { birthDay: d, birthMonth: m, birthYear: y || null });
      }
    }
    if (Object.keys(contactSet).length) await tx.update(contacts).set(contactSet).where(eq(contacts.id, deal.contactId));
    const dealSet: Partial<typeof deals.$inferInsert> = {};
    for (const k of ["observations", "objectionId", "lostReasonId", "ownerId", "origin", "valueCents", "scheduledAt", "chargeAt", "recontactAt"] as const) {
      if (patch[k] !== undefined) (dealSet as Record<string, unknown>)[k] = patch[k];
    }
    if (patch.paymentMethod !== undefined) dealSet.paymentMethod = patch.paymentMethod || null;
    if (Object.keys(dealSet).length) await tx.update(deals).set(dealSet).where(eq(deals.id, dealId));
    const changed = Object.keys(patch).filter((k) => (patch as Record<string, unknown>)[k] !== undefined);
    if (changed.length) {
      await logEvent(tx, dealId, patch.ownerId !== undefined ? "responsavel_alterado" : "campo_alterado", { campos: changed.map((k) => FIELD_LABELS[k] ?? k) }, userId);
      await tx.insert(auditLog).values({ userId, action: "atualizou", entity: "deal", entityId: dealId, data: { campos: changed } });
    }
  });
  await emit("lead_atualizado", { dealId });
}

/** Lead criado na mão (ex.: cliente que ligou ou chegou na recepção). */
export async function createManualLead(input: { phone: string; name?: string; origin?: string }, userId: string) {
  const phone = normalizePhone(input.phone);
  if (!phone) throw new Error("Telefone inválido. Use DDD + número, ex.: 71 99999-9999");
  const dealId = await db.transaction(async (tx) => {
    const [c] = await tx.insert(contacts).values({ phoneE164: phone, name: input.name?.trim() || null })
      // Lead criado na mão = a gestão considera cliente: tira a marca de "não é cliente", se houver.
      .onConflictDoUpdate({ target: contacts.phoneE164, set: { name: input.name?.trim() || undefined, ignored: false } }).returning();
    const existing = await findOpenDeal(c.id, tx);
    if (existing) return existing.id;
    const lead = await stageByKey("atendimento", tx);
    const [d] = await tx.insert(deals).values({ contactId: c.id, stageId: lead.id, ownerId: userId, origin: input.origin || "Recepção" }).returning();
    await logEvent(tx, d.id, "lead_criado", { origin: d.origin, manual: true }, userId);
    return d.id;
  });
  await emit("lead_criado", { dealId });
  return dealId;
}
