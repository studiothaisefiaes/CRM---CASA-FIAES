import { and, asc, eq } from "drizzle-orm";
import { db, type Db, type Tx } from "../../db";
import { auditLog, paymentFees, type PaymentFee } from "../../db/schema";
import { CARD_BRANDS } from "@/lib/comanda-math";
import type { Actor } from "../agenda/actor";
import { UserFacingError } from "../errors";

/** Taxa do cartão da Casa por forma, bandeira e parcelado (Serviços › Formas de pagamento › Taxas do cartão). */
export async function listPaymentFees(q: Tx | Db = db): Promise<PaymentFee[]> {
  return q.select().from(paymentFees).orderBy(asc(paymentFees.method), asc(paymentFees.brand), asc(paymentFees.parcelado));
}

/** Põe, muda ou apaga (feeBp null) a taxa. Vale só para os pagamentos novos; cada mudança vai para a auditoria com de/para. */
export async function savePaymentFee(input: { method: "credito" | "debito"; brand: string; parcelado: boolean; feeBp: number | null }, actor: Actor): Promise<void> {
  if (input.method !== "credito" && input.method !== "debito") throw new UserFacingError("Escolha crédito ou débito.");
  if (!(CARD_BRANDS as readonly string[]).includes(input.brand)) throw new UserFacingError("Escolha a bandeira do cartão.");
  if (input.method === "debito" && input.parcelado) throw new UserFacingError("Débito não tem parcelado.");
  if (input.feeBp != null && !(Number.isInteger(input.feeBp) && input.feeBp >= 0 && input.feeBp <= 10000)) throw new UserFacingError("Use de 0% a 100%.");
  await db.transaction(async (tx) => {
    const key = and(eq(paymentFees.method, input.method), eq(paymentFees.brand, input.brand), eq(paymentFees.parcelado, input.parcelado));
    const [before] = await tx.select().from(paymentFees).where(key).for("update");
    if ((before?.feeBp ?? null) === input.feeBp) return;
    if (input.feeBp == null) await tx.delete(paymentFees).where(key);
    else await tx.insert(paymentFees).values({ method: input.method, brand: input.brand, parcelado: input.parcelado, feeBp: input.feeBp, updatedBy: actor.id })
      .onConflictDoUpdate({ target: [paymentFees.method, paymentFees.brand, paymentFees.parcelado], set: { feeBp: input.feeBp, updatedBy: actor.id, updatedAt: new Date() } });
    await tx.insert(auditLog).values({ userId: actor.id, action: "taxa_cartao", entity: "payment_fee", entityId: before?.id ?? null,
      data: { forma: input.method, bandeira: input.brand, parcelado: input.parcelado, de: before?.feeBp ?? null, para: input.feeBp } });
  });
}

/** A taxa que vale agora para este pagamento (parcelado = mais de 1 parcela). Pix, dinheiro etc. e bandeira sem taxa: null. */
export async function feeBpTx(q: Tx | Db, p: { method: string; brand: string | null; installments: number | null }): Promise<number | null> {
  if ((p.method !== "credito" && p.method !== "debito") || !p.brand) return null;
  const parcelado = p.method === "credito" && (p.installments ?? 1) > 1;
  const [row] = await q.select({ bp: paymentFees.feeBp }).from(paymentFees)
    .where(and(eq(paymentFees.method, p.method), eq(paymentFees.brand, p.brand), eq(paymentFees.parcelado, parcelado)));
  return row?.bp ?? null;
}
