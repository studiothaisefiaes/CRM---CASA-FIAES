import { db } from "@/server/db";
import { cashSessions, comandaItems, comandaPayments, comandas } from "@/server/db/schema";

/** Atalhos do Financeiro (testes): comanda já fechada/cancelada/aberta com itens e pagamentos, direto no banco. */
let n = 0;
export async function comanda(v: {
  day: string; by: string; status?: "fechada" | "aberta" | "cancelada"; cashSessionId?: string | null; changeCents?: number; discountCents?: number;
  clientName?: string | null; contactId?: string | null; cancelReason?: string | null; cancelledBy?: string | null;
  pays?: { method: string; valueCents: number; cancelled?: boolean; cashSessionId?: string | null; changeCents?: number; feeCents?: number | null }[];
  items?: { label: string; kind?: string; unitCents: number | null; qty?: number; discountCents?: number; professionalId?: string | null; serviceId?: string | null; cancelled?: boolean; addedBy?: string; commissionCents?: number | null; commissionBp?: number | null; commissionBaseCents?: number | null; clientPackageId?: string | null; packageDefId?: string | null; netCents?: number | null; productId?: string | null }[];
}) {
  const status = v.status ?? "fechada";
  const items = v.items ?? [];
  const total = items.filter((i) => !i.cancelled).reduce((a, i) => a + Math.max(0, (i.unitCents ?? 0) * (i.qty ?? 1) - (i.discountCents ?? 0)), 0) - (v.discountCents ?? 0);
  const [c] = await db.insert(comandas).values({
    day: v.day, number: ++n, status, openedBy: v.by, clientName: v.clientName ?? null, contactId: v.contactId ?? null, cashSessionId: v.cashSessionId ?? null,
    changeCents: v.changeCents ?? 0, discountCents: v.discountCents ?? 0, totalCents: status === "aberta" ? null : total,
    closedBy: status === "fechada" ? v.by : null, closedAt: status === "fechada" ? new Date(`${v.day}T15:00:00Z`) : null,
    cancelledBy: status === "cancelada" ? v.cancelledBy ?? v.by : null, cancelledAt: status === "cancelada" ? new Date(`${v.day}T16:00:00Z`) : null, cancelReason: v.cancelReason ?? null,
  }).returning();
  const its = items.length ? await db.insert(comandaItems).values(items.map((i, k) => ({
    comandaId: c.id, createdAt: new Date(Date.parse(`${v.day}T13:00:00Z`) + k), kind: i.kind ?? "servico", label: i.label, unitCents: i.unitCents, qty: i.qty ?? 1, discountCents: i.discountCents ?? 0,
    totalCents: status === "fechada" && i.unitCents != null ? Math.max(0, i.unitCents * (i.qty ?? 1) - (i.discountCents ?? 0)) : null,
    professionalId: i.professionalId ?? null, serviceId: i.serviceId ?? null, addedBy: i.addedBy ?? v.by, commissionCents: i.commissionCents ?? null, commissionBp: i.commissionBp ?? null, commissionBaseCents: i.commissionBaseCents ?? null,
    clientPackageId: i.clientPackageId ?? null, packageDefId: i.packageDefId ?? null, netCents: i.netCents ?? null, productId: i.productId ?? null,
    cancelledAt: i.cancelled ? new Date(`${v.day}T14:00:00Z`) : null, cancelledBy: i.cancelled ? v.by : null,
  }))).returning() : [];
  // Plano 3: o pagamento entra no caixa de quem recebeu (padrão: o da comanda) e o troco fica no último dinheiro vivo (como no fechamento e na 0055).
  const pays = v.pays ?? [];
  const lastCash = pays.map((p, k) => (p.method === "dinheiro" && !p.cancelled ? k : -1)).reduce((a, k) => Math.max(a, k), -1);
  if (pays.length) await db.insert(comandaPayments).values(pays.map((p, k) => ({
    // O Financeiro conta o pagamento pelo dia dele (QA r58, C-2): no atalho, o pagamento é do dia da comanda.
    comandaId: c.id, method: p.method, valueCents: p.valueCents, createdBy: v.by, createdAt: new Date(Date.parse(`${v.day}T14:00:00Z`) + k), cancelledAt: p.cancelled ? new Date() : null,
    cashSessionId: p.cashSessionId === undefined ? v.cashSessionId ?? null : p.cashSessionId,
    feeCents: p.feeCents ?? null, brand: p.method === "credito" || p.method === "debito" ? "visa" : null,
    changeCents: p.changeCents ?? (k === lastCash ? Math.min(v.changeCents ?? 0, p.valueCents) : 0),
  })));
  return { ...c, items: its };
}

export async function caixa(v: { day: string; by: string; openingCents?: number; status?: "aberto" | "fechado"; differenceCents?: number | null }) {
  const [s] = await db.insert(cashSessions).values({
    day: v.day, openedBy: v.by, openingCents: v.openingCents ?? 0, status: v.status ?? "fechado", openedAt: new Date(`${v.day}T12:00:00Z`),
    closedBy: v.status === "aberto" ? null : v.by, closedAt: v.status === "aberto" ? null : new Date(`${v.day}T21:00:00Z`), differenceCents: v.differenceCents ?? null,
  }).returning();
  return s;
}
