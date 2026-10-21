import { asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { auditLog, lists } from "../db/schema";
import { normText } from "./avec/normalize";
import { SERVICE_DESCRIPTION_MAX, SERVICE_LABEL_MAX } from "./services";
import { SERVICE_CATEGORY_MAX, SERVICE_DURATION_MAX, SERVICE_PRICE_MAX_CENTS } from "./service-details";

/**
 * Importação dos serviços do Avec (scripts/importar-servicos-avec.ts). Entrada: o JSON gerado na máquina a partir dos relatórios
 * ("Tabela de preços dos serviços" + o preço mais frequente nas vendas quando a tabela não tem). Casa pelo nome sem acento e maiúscula.
 * Só ACRESCENTA: cria o que falta e completa o que está vazio. Preço já preenchido no CRM nunca é trocado (a diferença só aparece no ensaio).
 * Nada é apagado nem desativado. Idempotente: um segundo ensaio depois de aplicar vem vazio.
 */
const row = z.object({
  servico: z.string().trim().min(1).max(SERVICE_LABEL_MAX),
  categoria: z.string().trim().max(SERVICE_CATEGORY_MAX).nullish(),
  precoCents: z.number().int().min(0).max(SERVICE_PRICE_MAX_CENTS).nullish(),
  duracaoMin: z.number().int().min(1).max(SERVICE_DURATION_MAX).nullish(),
  descricao: z.string().trim().nullish(),
});
export type ServiceImportRow = z.infer<typeof row>;
export const parseServiceImport = (json: unknown): ServiceImportRow[] => z.object({ servicos: z.array(row).min(1) }).parse(json).servicos;

type Fields = { category: string | null; priceCents: number | null; durationMin: number | null; description: string | null };
export type ServiceImportPlan = {
  novos: ({ label: string } & Fields)[];
  atualizados: { id: string; label: string; set: Partial<Fields> }[];
  divergencias: { label: string; crmCents: number; avecCents: number }[];
  iguais: number;
  repetidos: string[];
};
export type ServiceImportBackup = { criadoEm: string; antes: ({ id: string; label: string; active: boolean } & Fields)[] };

const desc = (d: string | null | undefined) => {
  const v = (d ?? "").replace(/\s+/g, " ").trim();
  return v ? (v.length > SERVICE_DESCRIPTION_MAX ? `${v.slice(0, SERVICE_DESCRIPTION_MAX - 1).trimEnd()}…` : v) : null;
};

export async function planServiceImport(rows: ServiceImportRow[]): Promise<ServiceImportPlan> {
  const existing = await db.select({ id: lists.id, label: lists.label, category: lists.category, priceCents: lists.priceCents, durationMin: lists.durationMin, description: lists.description })
    .from(lists).where(eq(lists.kind, "service")).orderBy(asc(lists.position));
  const byKey = new Map(existing.map((e) => [normText(e.label), e]));
  const plan: ServiceImportPlan = { novos: [], atualizados: [], divergencias: [], iguais: 0, repetidos: [] };
  const seen = new Set<string>();
  for (const r of rows) {
    const k = normText(r.servico);
    if (seen.has(k)) { plan.repetidos.push(r.servico); continue; }
    seen.add(k);
    const f: Fields = { category: r.categoria?.trim() || null, priceCents: r.precoCents && r.precoCents > 0 ? r.precoCents : null, durationMin: r.duracaoMin ?? null, description: desc(r.descricao) };
    const e = byKey.get(k);
    if (!e) { plan.novos.push({ label: r.servico.trim().replace(/\s+/g, " "), ...f }); continue; }
    const set: Partial<Fields> = {};
    if (e.priceCents == null && f.priceCents != null) set.priceCents = f.priceCents;
    if (e.priceCents != null && f.priceCents != null && e.priceCents !== f.priceCents) plan.divergencias.push({ label: e.label, crmCents: e.priceCents, avecCents: f.priceCents });
    if (!e.category && f.category) set.category = f.category;
    if (e.durationMin == null && f.durationMin != null) set.durationMin = f.durationMin;
    if (!e.description && f.description) set.description = f.description;
    if (Object.keys(set).length) plan.atualizados.push({ id: e.id, label: e.label, set }); else plan.iguais++;
  }
  return plan;
}

/** Grava o backup (o estado de antes dos que mudam) e só então aplica, numa transação. Sem backup, nada muda. */
export async function applyServiceImport(plan: ServiceImportPlan, writeBackup: (b: ServiceImportBackup) => Promise<void>): Promise<{ criados: number; atualizados: number }> {
  const ids = plan.atualizados.map((a) => a.id);
  const antes = ids.length ? await db.select({ id: lists.id, label: lists.label, active: lists.active, category: lists.category, priceCents: lists.priceCents, durationMin: lists.durationMin, description: lists.description })
    .from(lists).where(inArray(lists.id, ids)) : [];
  await writeBackup({ criadoEm: new Date().toISOString(), antes });
  return db.transaction(async (tx) => {
    for (const a of plan.atualizados) await tx.update(lists).set(a.set).where(eq(lists.id, a.id));
    if (plan.novos.length) {
      const [{ max }] = (await tx.execute(sql`select coalesce(max(position), -1)::int as max from lists where kind = 'service'`)).rows as { max: number }[];
      await tx.insert(lists).values(plan.novos.map((n, i) => ({ kind: "service" as const, position: max + 1 + i, active: true, ...n })));
    }
    await tx.insert(auditLog).values({ userId: null, action: "importou", entity: "list", entityId: null, data: { origem: "avec-servicos", criados: plan.novos.map((n) => n.label), atualizados: plan.atualizados.map((a) => ({ label: a.label, ...a.set })) } });
    return { criados: plan.novos.length, atualizados: plan.atualizados.length };
  });
}
