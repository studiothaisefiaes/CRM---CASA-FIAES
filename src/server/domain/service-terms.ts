import { and, eq, inArray } from "drizzle-orm";
import type { Db, Tx } from "../db";
import { lists, professionalServices } from "../db/schema";
import { isUuid } from "../../lib/uuid";
import type { PriceKind } from "../../lib/service-price";
import { isFuncaoOn } from "./funcoes";

export type ServiceTerms = { priceCents: number | null; durationMin: number | null; bufferMin: number | null; priceKind: PriceKind | null };

/**
 * Preço, tempo, folga e tipo de preço de um serviço com uma profissional (0084, Fase C item 24): vale o preço e o tempo próprios dela
 * (Serviços › Quem faz) e, sem eles, os do serviço. A folga e o tipo de preço são sempre os do serviço. Com a função "Preço e tempo por
 * profissional" desligada, só os do serviço. Serviço que não existe: tudo vazio. Uma consulta de cada vez (pode estar numa transação).
 */
export async function serviceTermsFor(q: Tx | Db, serviceId: string, professionalId: string | null): Promise<ServiceTerms> {
  const [s] = isUuid(serviceId)
    ? await q.select({ priceCents: lists.priceCents, durationMin: lists.durationMin, bufferMin: lists.bufferMin, priceKind: lists.priceKind }).from(lists).where(eq(lists.id, serviceId))
    : [];
  if (!s) return { priceCents: null, durationMin: null, bufferMin: null, priceKind: null };
  const [own] = professionalId && isUuid(professionalId) && (await isFuncaoOn("preco_por_profissional", q))
    ? await q.select({ priceCents: professionalServices.priceCents, durationMin: professionalServices.durationMin }).from(professionalServices)
      .where(and(eq(professionalServices.serviceId, serviceId), eq(professionalServices.professionalId, professionalId)))
    : [];
  return {
    priceCents: own?.priceCents ?? s.priceCents ?? null, durationMin: own?.durationMin ?? s.durationMin ?? null,
    bufferMin: s.bufferMin ?? null, priceKind: s.priceKind ?? null,
  };
}

/**
 * O tempo próprio de cada profissional num serviço, de uma vez (Procurar horário, sugestão da IA), só com a função "Preço e tempo por
 * profissional" ligada. Só as que têm tempo próprio entram no mapa; para as outras, quem chama usa o do serviço.
 */
export async function proDurations(q: Tx | Db, serviceId: string, professionalIds: string[]): Promise<Map<string, number>> {
  const ids = professionalIds.filter(isUuid);
  if (!isUuid(serviceId) || !ids.length || !(await isFuncaoOn("preco_por_profissional", q))) return new Map();
  const rows = await q.select({ id: professionalServices.professionalId, d: professionalServices.durationMin }).from(professionalServices)
    .where(and(eq(professionalServices.serviceId, serviceId), inArray(professionalServices.professionalId, ids)));
  return new Map(rows.flatMap((r) => (r.d != null ? [[r.id, r.d] as const] : [])));
}
