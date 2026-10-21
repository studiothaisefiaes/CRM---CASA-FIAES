import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { auditLog, lists } from "../db/schema";
import { UserFacingError } from "./errors";
import { isUuid } from "../../lib/uuid";
import { isPriceKind, type PriceKind } from "../../lib/service-price";

/**
 * Serviço (Listas › Serviços): preço, duração, folga depois e categoria. Cada campo é opcional: `undefined` não mexe, `null`/vazio volta a
 * "não informado" (nunca chutar; o Avec também preenche quando traz).
 * 0084 (Fase C item 24): custo (só com `servicos.custo`, conferido na action), como o preço aparece (null = fixo) e "Pode ser feito junto
 * com outro" (null = não informado; só com a função `junto_com_outro` ligada, conferido em services.ts).
 */
export type ServiceDetailsPatch = {
  priceCents?: number | null; durationMin?: number | null; category?: string | null; bufferMin?: number | null;
  costCents?: number | null; priceKind?: PriceKind | null; parallelOk?: boolean | null;
};

export const SERVICE_DURATION_MAX = 12 * 60;
/** Folga depois do serviço (arrumar o posto): de 0 a 2 h; vazio = sem folga. */
export const SERVICE_BUFFER_MAX = 120;
export const SERVICE_PRICE_MAX_CENTS = 100_000_00;
export const SERVICE_CATEGORY_MAX = 60;

/** Confere e limpa preço, duração, folga e categoria (o que veio vira o `set` do update). Também usado pela aba Serviços. */
export function serviceDetailsSet(patch: ServiceDetailsPatch): Partial<typeof lists.$inferInsert> {
  const set: Partial<typeof lists.$inferInsert> = {};
  if (patch.priceCents !== undefined) {
    const v = patch.priceCents;
    if (v !== null && (!Number.isInteger(v) || v < 0 || v > SERVICE_PRICE_MAX_CENTS)) throw new UserFacingError("Confira o preço: use um valor como 150,00.");
    set.priceCents = v;
  }
  if (patch.durationMin !== undefined) {
    const v = patch.durationMin;
    if (v !== null && (!Number.isInteger(v) || v < 1 || v > SERVICE_DURATION_MAX)) throw new UserFacingError("Confira a duração: de 1 a 720 minutos.");
    set.durationMin = v;
  }
  if (patch.bufferMin !== undefined) {
    const v = patch.bufferMin;
    if (v !== null && (!Number.isInteger(v) || v < 0 || v > SERVICE_BUFFER_MAX)) throw new UserFacingError("Confira a folga: de 0 a 120 minutos.");
    set.bufferMin = v;
  }
  if (patch.costCents !== undefined) {
    const v = patch.costCents;
    if (v !== null && (!Number.isInteger(v) || v < 0 || v > SERVICE_PRICE_MAX_CENTS)) throw new UserFacingError("Confira o custo: use um valor como 40,00.");
    set.costCents = v;
  }
  if (patch.priceKind !== undefined) {
    const v = patch.priceKind;
    if (v !== null && !isPriceKind(v)) throw new UserFacingError("Escolha como o preço aparece: Fixo, A partir de ou Sob consulta.");
    set.priceKind = v === "fixo" ? null : v;
  }
  if (patch.parallelOk !== undefined) {
    const v = patch.parallelOk;
    if (v !== null && typeof v !== "boolean") throw new UserFacingError("Escolha se pode ser feito junto com outro: Sim, Não ou Não informado.");
    set.parallelOk = v;
  }
  if (patch.category !== undefined) {
    const v = (patch.category ?? "").trim().replace(/\s+/g, " ");
    if (v.length > SERVICE_CATEGORY_MAX) throw new UserFacingError(`Use até ${SERVICE_CATEGORY_MAX} caracteres na categoria.`);
    set.category = v || null;
  }
  return set;
}

export async function saveServiceDetails(id: string, patch: ServiceDetailsPatch, userId: string): Promise<void> {
  const set = serviceDetailsSet(patch);
  if (!isUuid(id)) throw new UserFacingError("Serviço não encontrado.");
  const [row] = await db.select({ id: lists.id, label: lists.label }).from(lists).where(and(eq(lists.id, id), eq(lists.kind, "service")));
  if (!row) throw new UserFacingError("Serviço não encontrado.");
  if (!Object.keys(set).length) return;
  await db.update(lists).set(set).where(eq(lists.id, id));
  await db.insert(auditLog).values({ userId, action: "editou", entity: "list", entityId: id, data: { label: row.label, ...set } });
}
