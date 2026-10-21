import { randomUUID } from "node:crypto";
import { addItem, addPayment, closeComanda, openWalkInComanda, type AddPaymentInput } from "@/server/domain/caixa/comandas";
import type { setupCaixa } from "./caixa-fixtures";
import { NOW } from "./agenda-fixtures";

type S = Awaited<ReturnType<typeof setupCaixa>>;

/**
 * Abre uma comanda avulsa, lança os itens e os pagamentos com a recepção e fecha.
 * `day` ("AAAA-MM-DD", às 9h de Salvador) muda o "agora" para montar comandas de outros dias. `leaveDebt`: o que faltar fica como dívida da cliente.
 */
export async function comandaFechada(
  s: S,
  o: { items: { serviceId: string; professionalId: string; unitCents?: number }[]; pays: AddPaymentInput[]; contactId?: string; day?: string; leaveDebt?: boolean },
): Promise<{ comandaId: string }> {
  const now = o.day ? new Date(`${o.day}T12:00:00Z`) : NOW;
  const w = await openWalkInComanda({ requestKey: randomUUID(), contactId: o.contactId ?? null }, s.caixaRecepcao, now);
  for (const i of o.items) await addItem(w.comandaId, { kind: "servico", serviceId: i.serviceId, professionalId: i.professionalId, unitCents: i.unitCents, reason: i.unitCents != null ? "preço combinado" : null }, s.caixaRecepcao, now);
  for (const p of o.pays) await addPayment(w.comandaId, p, s.caixaRecepcao, now);
  await closeComanda(w.comandaId, o.leaveDebt ? { leaveDebt: true } : {}, s.caixaRecepcao, now);
  return { comandaId: w.comandaId };
}
