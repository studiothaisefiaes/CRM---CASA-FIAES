import { db } from "@/server/db";
import { appointments, contacts, professionals, salesItems, salesPayments } from "@/server/db/schema";

/** Fixtures FICTÍCIAS do Salão (nomes "Teste", telefones inventados). Chave externa única por linha. */
let seq = 0;
const key = (p: string) => `teste:${p}:${++seq}`;

export async function pro(name: string) {
  const [p] = await db.insert(professionals).values({ name }).returning({ id: professionals.id });
  return p.id;
}
export async function client(name: string, phone: string) {
  const [c] = await db.insert(contacts).values({ name, phoneE164: phone, isClient: true }).returning({ id: contacts.id });
  return c.id;
}
export async function item(v: {
  day: string; comanda?: string | null; item?: string; value: number; discount?: number | null; total?: number | null; kind?: string; category?: string | null;
  proId?: string | null; proName?: string | null; contactId?: string | null; clientName?: string | null; fromPackage?: boolean;
  commissionPct?: number | null; commissionCents?: number | null; origin?: string;
}) {
  await db.insert(salesItems).values({
    soldOn: v.day, comanda: v.comanda === undefined ? "1" : v.comanda, item: v.item ?? "Corte", kind: v.kind ?? "servico", category: v.category ?? null,
    professionalId: v.proId ?? null, professionalName: v.proName ?? null, contactId: v.contactId ?? null, clientName: v.clientName ?? null,
    valueCents: v.value, discountCents: v.discount ?? null, totalCents: v.total === undefined ? v.value - (v.discount ?? 0) : v.total,
    fromPackage: v.fromPackage ?? false, commissionPct: v.commissionPct ?? null, commissionCents: v.commissionCents ?? null,
    origin: v.origin ?? "avec", externalKey: key("item"),
  });
}
export async function payment(v: { day: string; value: number; method?: string | null; comanda?: string; paidOn?: string | null }) {
  await db.insert(salesPayments).values({
    comandaOn: v.day, paidOn: v.paidOn === undefined ? v.day : v.paidOn, comanda: v.comanda ?? "1", method: v.method === undefined ? "Pix" : v.method,
    valueCents: v.value, externalKey: key("pag"),
  });
}
/** Horário às `hm` de Salvador (UTC-3) no dia. */
export async function appt(v: { day: string; hm?: string; status: string; contactId?: string | null; proId?: string | null; service?: string; clientName?: string | null }) {
  const startsAt = new Date(Date.parse(`${v.day}T${v.hm ?? "10:00"}:00Z`) + 3 * 3_600_000);
  await db.insert(appointments).values({
    contactId: v.contactId ?? null, professionalId: v.proId ?? null, serviceLabel: v.service ?? "Corte", startsAt, status: v.status,
    clientName: v.clientName ?? null, externalKey: key("res"),
  });
}
