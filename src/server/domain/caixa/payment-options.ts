import { and, asc, eq, ne, sql } from "drizzle-orm";
import { db } from "../../db";
import { auditLog, paymentMethodOptions, type PaymentMethodOption } from "../../db/schema";
import type { Actor } from "../agenda/actor";
import { UserFacingError } from "../errors";

/** "Outra forma" de pagamento (Plano 3): a gestão cadastra em Serviços e pacotes › Formas de pagamento; o caixa escolhe entre as ativas. */
export async function listPaymentOptions(o: { activeOnly?: boolean } = {}): Promise<PaymentMethodOption[]> {
  return db.select().from(paymentMethodOptions).where(o.activeOnly ? eq(paymentMethodOptions.active, true) : undefined)
    .orderBy(asc(paymentMethodOptions.position), sql`lower(${paymentMethodOptions.label})`);
}

/** Cria ou renomeia/desativa (nunca apaga: pagamentos antigos apontam para ela). Nome de 2 a 40 letras, sem repetir. */
export async function savePaymentOption(input: { id?: string | null; label: string; active?: boolean }, actor: Actor): Promise<{ id: string }> {
  const label = (input.label ?? "").trim().replace(/\s+/g, " ");
  if (label.length < 2 || label.length > 40) throw new UserFacingError("Escreva o nome da forma (2 a 40 letras).");
  return db.transaction(async (tx) => {
    const [dup] = await tx.select({ id: paymentMethodOptions.id }).from(paymentMethodOptions)
      .where(and(sql`lower(${paymentMethodOptions.label}) = lower(${label})`, input.id ? ne(paymentMethodOptions.id, input.id) : undefined));
    if (dup) throw new UserFacingError(`Já existe a forma ${label}.`);
    let id = input.id ?? null;
    let before: PaymentMethodOption | null = null;
    if (id) {
      [before] = await tx.select().from(paymentMethodOptions).where(eq(paymentMethodOptions.id, id)).for("update");
      if (!before) throw new UserFacingError("Forma não encontrada.");
      await tx.update(paymentMethodOptions).set({ label, active: input.active ?? before.active }).where(eq(paymentMethodOptions.id, id));
    } else {
      [{ id }] = await tx.insert(paymentMethodOptions).values({ label, active: input.active ?? true, createdBy: actor.id }).returning({ id: paymentMethodOptions.id });
    }
    await tx.insert(auditLog).values({ userId: actor.id, action: "forma_pagamento_salva", entity: "payment_method_option", entityId: id,
      data: { de: before ? { nome: before.label, ativa: before.active } : null, para: { nome: label, ativa: input.active ?? before?.active ?? true } } });
    return { id: id! };
  });
}
