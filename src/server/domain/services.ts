import { and, asc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { db } from "../db";
import { auditLog, lists, professionalServices, professionals } from "../db/schema";
import { UserFacingError } from "./errors";
import { serviceDetailsSet, type ServiceDetailsPatch } from "./service-details";
import { isUuid } from "../../lib/uuid";
import { photoVersionOf, proPhotoUrl } from "../../lib/pro-photo";
import { searchKey } from "../../lib/services-view";
import type { PriceKind } from "../../lib/service-price";
import { assertFuncao } from "./funcoes";

/**
 * Aba Serviços (pedido do dono, 16/10): o catálogo da Casa com preço, duração, descrição curta (a IA usa) e quem faz.
 * Serviço continua sendo `lists` kind "service"; quem faz é `professional_services` (a comissão de quem fica não muda). Nada apaga: desativa.
 */
export const SERVICE_LABEL_MAX = 120;
export const SERVICE_DESCRIPTION_MAX = 300;
export const SERVICE_CYCLE_MAX = 365;

export type ServiceInput = ServiceDetailsPatch & {
  label?: string; description?: string | null; active?: boolean; cycleDays?: number | null; professionalIds?: string[];
  /** "A IA oferece só com" (vazio/null = quem faz o serviço) e quando vale: sempre ou só quando o assunto é o Método Fiaes. */
  aiProIds?: string[] | null; aiProScope?: "sempre" | "metodo" | null;
  /** "A IA pode citar" (0052): não = fica fora da lista de serviços e preços da IA (item interno, sem especialista). */
  aiCitavel?: boolean;
  /** Código do serviço na nota (cTribNac, 6 números) e NBS (9) próprios; vazio = vale o padrão de Configurações › Nota fiscal. */
  fiscalCtribNac?: string | null; fiscalNbs?: string | null;
};

const cleanLabel = (v: string) => {
  const l = v.trim().replace(/\s+/g, " ");
  if (!l) throw new UserFacingError("Dê um nome ao serviço.");
  if (l.length > SERVICE_LABEL_MAX) throw new UserFacingError(`Use até ${SERVICE_LABEL_MAX} caracteres no nome.`);
  return l;
};

function fieldsOf(input: ServiceInput): Partial<typeof lists.$inferInsert> {
  const set = serviceDetailsSet(input);
  if (input.label !== undefined) set.label = cleanLabel(input.label);
  if (input.description !== undefined) {
    const d = (input.description ?? "").trim().replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n");
    if (d.length > SERVICE_DESCRIPTION_MAX) throw new UserFacingError(`Use até ${SERVICE_DESCRIPTION_MAX} caracteres na descrição.`);
    set.description = d || null;
  }
  if (input.cycleDays !== undefined) {
    const c = input.cycleDays;
    if (c !== null && (!Number.isInteger(c) || c < 0 || c > SERVICE_CYCLE_MAX)) throw new UserFacingError("Confira o retorno: de 1 a 365 dias, ou vazio.");
    set.cycleDays = c || null;
  }
  if (input.fiscalCtribNac !== undefined) {
    const v = (input.fiscalCtribNac ?? "").trim();
    if (v && !/^[0-9]{6}$/.test(v)) throw new UserFacingError("O código do serviço na nota (cTribNac) tem 6 números.");
    set.fiscalCtribNac = v || null;
  }
  if (input.fiscalNbs !== undefined) {
    const v = (input.fiscalNbs ?? "").trim();
    if (v && !/^[0-9]{9}$/.test(v)) throw new UserFacingError("O NBS tem 9 números.");
    set.fiscalNbs = v || null;
  }
  if (input.active !== undefined) set.active = !!input.active;
  if (input.aiCitavel !== undefined) set.aiCitavel = !!input.aiCitavel;
  if (input.aiProIds !== undefined) {
    const ids = [...new Set(input.aiProIds ?? [])];
    if (ids.some((p) => !isUuid(p))) throw new UserFacingError("Profissional não encontrada.");
    set.aiProIds = ids.length ? ids : null;
    // Sem ninguém escolhido, a regra some inteira.
    if (!ids.length) set.aiProScope = null;
  }
  if (input.aiProScope !== undefined && set.aiProIds !== null) set.aiProScope = input.aiProScope === "metodo" ? "metodo" : input.aiProScope === "sempre" ? "sempre" : null;
  return set;
}

/** As profissionais da regra da IA existem? (ativa ou não: o histórico guarda). */
async function checkAiPros(tx: Tx, set: Partial<typeof lists.$inferInsert>, currentScope: "sempre" | "metodo" | null = null) {
  const ids = set.aiProIds ?? [];
  if (!ids.length) return;
  const found = await tx.select({ id: professionals.id }).from(professionals).where(inArray(professionals.id, ids));
  if (found.length !== ids.length) throw new UserFacingError("Profissional não encontrada.");
  // Sem dizer quando: mantém o que já estava (ou "sempre").
  if (!set.aiProScope) set.aiProScope = currentScope ?? "sempre";
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** "Pode ser feito junto com outro" (0084) só se grava com a função ligada (a ficha esconde o campo; o servidor recusa). */
async function assertParallelAllowed(tx: Tx, set: Partial<typeof lists.$inferInsert>) {
  if (set.parallelOk !== undefined) await assertFuncao("junto_com_outro", tx);
}

/** Outro serviço com o mesmo nome (sem acento, maiúscula e espaço sobrando). */
async function sameName(tx: Tx, label: string, exceptId: string | null) {
  const rows = await tx.select({ id: lists.id, label: lists.label, active: lists.active }).from(lists).where(eq(lists.kind, "service"));
  return rows.find((r) => r.id !== exceptId && searchKey(r.label) === searchKey(label)) ?? null;
}

async function setProfessionals(tx: Tx, serviceId: string, ids: string[], userId: string) {
  const want = [...new Set(ids)];
  if (want.some((p) => !isUuid(p))) throw new UserFacingError("Profissional não encontrada.");
  if (want.length) {
    const found = await tx.select({ id: professionals.id }).from(professionals).where(inArray(professionals.id, want));
    if (found.length !== want.length) throw new UserFacingError("Profissional não encontrada.");
  }
  await tx.delete(professionalServices).where(and(eq(professionalServices.serviceId, serviceId), want.length ? notInArray(professionalServices.professionalId, want) : sql`true`));
  if (want.length) await tx.insert(professionalServices).values(want.map((p) => ({ professionalId: p, serviceId, source: "manual", createdBy: userId }))).onConflictDoNothing();
}

/** Novo serviço. Nome de um que já existe desativado: ativa de novo com os dados novos (nunca duplica). */
export async function createService(input: ServiceInput & { label: string }, userId: string): Promise<{ id: string }> {
  const set = fieldsOf({ ...input, active: true });
  return db.transaction(async (tx) => {
    await assertParallelAllowed(tx, set);
    await checkAiPros(tx, set);
    const twin = await sameName(tx, set.label!, null);
    if (twin?.active) throw new UserFacingError(`Já existe um serviço com esse nome: ${twin.label}.`);
    let id: string;
    if (twin) {
      const { label: _ignored, ...rest } = set; // o nome guardado fica (é o mesmo, só com outra grafia)
      void _ignored;
      await tx.update(lists).set(rest).where(eq(lists.id, twin.id));
      id = twin.id;
    } else {
      const [{ max }] = (await tx.execute(sql`select coalesce(max(position), -1)::int as max from lists where kind = 'service'`)).rows as { max: number }[];
      [{ id }] = await tx.insert(lists).values({ ...set, kind: "service", label: set.label!, position: max + 1 }).returning({ id: lists.id });
    }
    if (input.professionalIds) await setProfessionals(tx, id, input.professionalIds, userId);
    await tx.insert(auditLog).values({ userId, action: "adicionou", entity: "list", entityId: id, data: { kind: "service", ...set, professionalIds: input.professionalIds } });
    return { id };
  });
}

/** Edita só o que veio (o preço na linha manda só o preço). */
export async function updateService(id: string, input: ServiceInput, userId: string): Promise<void> {
  const set = fieldsOf(input);
  if (!isUuid(id)) throw new UserFacingError("Serviço não encontrado.");
  await db.transaction(async (tx) => {
    const [row] = await tx.select({ id: lists.id, label: lists.label, aiProScope: lists.aiProScope }).from(lists).where(and(eq(lists.id, id), eq(lists.kind, "service")));
    if (!row) throw new UserFacingError("Serviço não encontrado.");
    await assertParallelAllowed(tx, set);
    if (set.aiProIds !== undefined) await checkAiPros(tx, set, row.aiProScope);
    if (set.label) {
      const twin = await sameName(tx, set.label, id);
      if (twin) throw new UserFacingError(`Já existe um serviço com esse nome: ${twin.label}.`);
    }
    if (Object.keys(set).length) await tx.update(lists).set(set).where(eq(lists.id, id));
    if (input.professionalIds) await setProfessionals(tx, id, input.professionalIds, userId);
    await tx.insert(auditLog).values({ userId, action: "editou", entity: "list", entityId: id, data: { label: row.label, ...set, ...(input.professionalIds ? { professionalIds: input.professionalIds } : {}) } });
  });
}

export type ServiceRow = {
  id: string; label: string; category: string | null; priceCents: number | null; durationMin: number | null; bufferMin: number | null;
  cycleDays: number | null; description: string | null; active: boolean; professionalIds: string[];
  /** "A IA oferece só com" (vazio = quem faz) e quando vale. */
  aiProIds: string[]; aiProScope: "sempre" | "metodo" | null;
  /** "A IA pode citar" (padrão sim). */
  aiCitavel: boolean;
  /** 0084: como o preço aparece (null = fixo) e "Pode ser feito junto com outro" (null = não informado). */
  priceKind: PriceKind | null; parallelOk: boolean | null;
  /** 0084: preço e tempo próprios de cada profissional (só as que têm algum), pelo id dela. */
  proTerms: Record<string, { priceCents: number | null; durationMin: number | null }>;
  /** 0084: custo. Só vem com `withCost` (quem tem `servicos.custo`); sem isso a chave nem existe. */
  costCents?: number | null;
  /** Dados fiscais próprios do serviço (vazio = padrão da Casa). */
  fiscalCtribNac: string | null; fiscalNbs: string | null;
};
export type ServicePro = { id: string; name: string; color: string | null; photoUrl: string | null };

/**
 * Tudo da aba: os serviços (ativos e desativados) com quem faz, e as profissionais ativas (para escolher e mostrar). `withCost`: traz o
 * custo (só para quem tem `servicos.custo`; sem isso o custo nem sai do banco).
 */
export async function listServicesPage(opts: { withCost?: boolean } = {}): Promise<{ services: ServiceRow[]; professionals: ServicePro[] }> {
  const [rows, pairs, pros, costs] = await Promise.all([
    db.select({ id: lists.id, label: lists.label, category: lists.category, priceCents: lists.priceCents, durationMin: lists.durationMin, bufferMin: lists.bufferMin,
      cycleDays: lists.cycleDays, description: lists.description, active: lists.active, aiProIds: lists.aiProIds, aiProScope: lists.aiProScope, aiCitavel: lists.aiCitavel,
      fiscalCtribNac: lists.fiscalCtribNac, fiscalNbs: lists.fiscalNbs, priceKind: lists.priceKind, parallelOk: lists.parallelOk }).from(lists).where(eq(lists.kind, "service")).orderBy(asc(lists.position), asc(lists.label)),
    db.select({ serviceId: professionalServices.serviceId, professionalId: professionalServices.professionalId, priceCents: professionalServices.priceCents, durationMin: professionalServices.durationMin }).from(professionalServices)
      .innerJoin(professionals, eq(professionals.id, professionalServices.professionalId)).where(eq(professionals.active, true)),
    db.select({ id: professionals.id, name: professionals.name, color: professionals.color, photoPath: professionals.photoPath, pos: professionals.agendaPosition })
      .from(professionals).where(eq(professionals.active, true)).orderBy(sql`${professionals.agendaPosition} nulls last`, asc(professionals.name)),
    opts.withCost ? db.select({ id: lists.id, costCents: lists.costCents }).from(lists).where(eq(lists.kind, "service")) : Promise.resolve(null),
  ]);
  const by = new Map<string, string[]>();
  const terms = new Map<string, ServiceRow["proTerms"]>();
  for (const p of pairs) {
    by.set(p.serviceId, [...(by.get(p.serviceId) ?? []), p.professionalId]);
    if (p.priceCents != null || p.durationMin != null) terms.set(p.serviceId, { ...terms.get(p.serviceId), [p.professionalId]: { priceCents: p.priceCents, durationMin: p.durationMin } });
  }
  const order = new Map(pros.map((p, i) => [p.id, i]));
  const cost = costs ? new Map(costs.map((c) => [c.id, c.costCents])) : null;
  return {
    services: rows.map((r) => ({
      ...r, aiProIds: r.aiProIds ?? [], professionalIds: (by.get(r.id) ?? []).sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0)), proTerms: terms.get(r.id) ?? {},
      ...(cost ? { costCents: cost.get(r.id) ?? null } : {}),
    })),
    professionals: pros.map((p) => ({ id: p.id, name: p.name, color: p.color, photoUrl: p.photoPath ? proPhotoUrl(p.id, photoVersionOf(p.photoPath)) : null })),
  };
}
