import { and, asc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { db } from "../../db";
import { auditLog, clientPackages, lists, packageDefs, type PackageDef, type PackageDefItem } from "../../db/schema";
import { isUuid } from "@/lib/uuid";
import { todayBahia } from "@/lib/agenda";
import { packageSituation } from "../../queries/avec";
import { groupPackagePurchases } from "@/lib/package-purchases";
import type { Actor } from "../agenda/actor";
import { UserFacingError } from "../errors";

const DM = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "UTC" });
const dm = (day: string) => DM.format(new Date(`${day}T12:00:00Z`));
const isDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

export type PackageDefInput = { id?: string | null; name: string; priceCents: number | null; validityDays: number | null; items: PackageDefItem[]; active?: boolean;
  /** Para a IA explicar o pacote (aba Serviços › Pacotes). Sem o campo (editor do Caixa), a descrição fica como está. */ description?: string | null };
export const PACKAGE_DESCRIPTION_MAX = 600;

/** Caixa › Pacotes à venda (gestão, `config.sistema` na ação): disponível mesmo com o caixa no Avec, para a Casa preparar. */
export async function savePackageDef(input: PackageDefInput, actor: Actor): Promise<{ id: string }> {
  const name = input.name?.trim();
  if (!name) throw new UserFacingError("Dê um nome ao pacote.");
  if (!input.items?.length) throw new UserFacingError("Escolha ao menos um serviço.");
  if (input.priceCents != null && (!Number.isInteger(input.priceCents) || input.priceCents < 0)) throw new UserFacingError("Preço inválido.");
  if (input.validityDays != null && !(Number.isInteger(input.validityDays) && input.validityDays >= 1 && input.validityDays <= 3650)) throw new UserFacingError("Validade de 1 a 3650 dias (ou vazia).");
  const svcs = new Map((await db.select({ id: lists.id, label: lists.label }).from(lists).where(inArray(lists.id, input.items.map((i) => i.serviceId).filter(isUuid)))).map((s) => [s.id, s.label]));
  const seen = new Set<string>();
  for (const it of input.items) {
    const label = svcs.get(it.serviceId);
    if (!label) throw new UserFacingError("Escolha o serviço.");
    if (seen.has(it.serviceId)) throw new UserFacingError(`${label} aparece duas vezes.`);
    seen.add(it.serviceId);
    if (!(Number.isInteger(it.sessions) && it.sessions >= 1 && it.sessions <= 100)) throw new UserFacingError("Sessões de 1 a 100.");
    if (it.unitCents != null && (!Number.isInteger(it.unitCents) || it.unitCents < 0)) throw new UserFacingError("Valor por sessão inválido.");
  }
  const description = input.description === undefined ? undefined : input.description?.replace(/\s+/g, " ").trim() || null;
  if (description && description.length > PACKAGE_DESCRIPTION_MAX) throw new UserFacingError(`Descrição: no máximo ${PACKAGE_DESCRIPTION_MAX} letras.`);
  const values = { name, priceCents: input.priceCents, validityDays: input.validityDays, items: input.items.map((i) => ({ serviceId: i.serviceId, sessions: i.sessions, unitCents: i.unitCents ?? null })), active: input.active ?? true,
    ...(description !== undefined ? { description } : {}) };
  return db.transaction(async (tx) => {
    if (input.id) {
      const [old] = await tx.select().from(packageDefs).where(eq(packageDefs.id, input.id));
      if (!old) throw new UserFacingError("Pacote não encontrado.");
      await tx.update(packageDefs).set(values).where(eq(packageDefs.id, input.id));
      await tx.insert(auditLog).values({ userId: actor.id, action: "pacote_editado", entity: "package_def", entityId: input.id, data: { de: { nome: old.name, preco: old.priceCents, ativo: old.active }, para: { nome: name, preco: input.priceCents, ativo: values.active } } });
      return { id: input.id };
    }
    const [d] = await tx.insert(packageDefs).values({ ...values, createdBy: actor.id }).returning({ id: packageDefs.id });
    await tx.insert(auditLog).values({ userId: actor.id, action: "pacote_criado", entity: "package_def", entityId: d.id, data: { nome: name } });
    return d;
  });
}

export async function listPackageDefs(o: { activeOnly?: boolean } = {}): Promise<(PackageDef & { serviceLabels: string[] })[]> {
  const defs = await db.select().from(packageDefs).where(o.activeOnly ? eq(packageDefs.active, true) : undefined).orderBy(asc(packageDefs.name));
  const ids = [...new Set(defs.flatMap((d) => d.items.map((i) => i.serviceId)))];
  const labels = new Map(ids.length ? (await db.select({ id: lists.id, label: lists.label }).from(lists).where(inArray(lists.id, ids))).map((s) => [s.id, s.label]) : []);
  return defs.map((d) => ({ ...d, serviceLabels: d.items.map((i) => labels.get(i.serviceId) ?? "Serviço removido") }));
}

export type PackageCard = { id: string; name: string; priceCents: number | null; validityDays: number | null; description: string | null; active: boolean;
  items: PackageDefItem[]; serviceLabels: string[]; /** Sessões do pacote (com mais de um serviço, cada visita usa um de cada). */ sessions: number; activeClients: number };

/** Aba Serviços › Pacotes: os pacotes (ativos primeiro) e quantas clientes têm cada um ativo agora (como "Ativos" em /pacotes; cancelado não conta). */
export async function listPackageCards(now: Date = new Date()): Promise<PackageCard[]> {
  const [defs, sold] = await Promise.all([
    listPackageDefs(),
    db.select({ defId: clientPackages.packageDefId, contactId: clientPackages.contactId, clientName: clientPackages.clientName, id: clientPackages.id, totalSessions: clientPackages.totalSessions,
      usedSessions: clientPackages.usedSessions, validUntil: clientPackages.validUntil, packageName: clientPackages.packageName, serviceLabel: clientPackages.serviceLabel,
      priceCents: clientPackages.priceCents, purchasedOn: clientPackages.purchasedOn }).from(clientPackages).where(and(isNotNull(clientPackages.packageDefId), isNull(clientPackages.cancelledAt))),
  ]);
  const today = todayBahia(now);
  const clients = new Map<string, Set<string>>();
  // Por compra (uma linha por serviço no Avec): situação com as sessões da compra.
  for (const g of groupPackagePurchases(sold)) {
    const s = packageSituation(g, today).situation;
    if (s === "vencido" || s === "esgotado") continue;
    for (const p of g.rows) clients.set(p.defId!, (clients.get(p.defId!) ?? new Set()).add(p.contactId ?? p.clientName ?? p.id));
  }
  return defs.sort((a, b) => Number(b.active) - Number(a.active)).map((d) => ({
    id: d.id, name: d.name, priceCents: d.priceCents, validityDays: d.validityDays, description: d.description, active: d.active, items: d.items, serviceLabels: d.serviceLabels,
    sessions: Math.max(1, ...d.items.map((i) => i.sessions)), activeClients: clients.get(d.id)?.size ?? 0,
  }));
}

/** Novo prazo para um pacote vencido (só a gestão, `caixa.gerir` na ação; 7.4, regra 9). */
export async function extendPackage(clientPackageId: string, input: { validUntil: string }, actor: Actor): Promise<void> {
  if (!isDay(input.validUntil)) throw new UserFacingError("Escolha a data do novo prazo.");
  await db.transaction(async (tx) => {
    const [p] = isUuid(clientPackageId) ? await tx.select().from(clientPackages).where(eq(clientPackages.id, clientPackageId)).for("update") : [];
    if (!p || p.cancelledAt) throw new UserFacingError("Pacote não encontrado.");
    if (p.validUntil && input.validUntil <= p.validUntil) throw new UserFacingError(`O novo prazo tem de ser depois do atual (${dm(p.validUntil)}).`);
    await tx.update(clientPackages).set({ validUntil: input.validUntil, updatedAt: new Date() }).where(eq(clientPackages.id, p.id));
    await tx.insert(auditLog).values({ userId: actor.id, action: "pacote_novo_prazo", entity: "client_package", entityId: p.id, data: { de: p.validUntil, para: input.validUntil } });
  });
}

/** Valor por sessão (base da comissão) dos pacotes que vieram do Avec sem esse valor (7.4, regra 10). */
export async function setPackageSessionValue(clientPackageId: string, unitCents: number | null, actor: Actor): Promise<void> {
  if (unitCents != null && (!Number.isInteger(unitCents) || unitCents < 0)) throw new UserFacingError("Valor por sessão inválido.");
  const [p] = isUuid(clientPackageId) ? await db.select().from(clientPackages).where(eq(clientPackages.id, clientPackageId)) : [];
  if (!p) throw new UserFacingError("Pacote não encontrado.");
  await db.update(clientPackages).set({ unitCents, updatedAt: new Date() }).where(eq(clientPackages.id, p.id));
  await db.insert(auditLog).values({ userId: actor.id, action: "pacote_valor_sessao", entity: "client_package", entityId: p.id, data: { de: p.unitCents, para: unitCents } });
}
