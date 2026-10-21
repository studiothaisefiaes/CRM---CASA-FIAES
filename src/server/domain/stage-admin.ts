import { and, asc, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type Tx } from "../db";
import { auditLog, automations, automationVersions, stages } from "../db/schema";
import { KIND_LABEL, STAGE_KINDS } from "../../lib/stage-kind-labels";
import { UserFacingError } from "./errors";
import { isAttemptKind } from "../../lib/attempts";

export const stageCreateSchema = z.object({
  name: z.string().trim().min(2, "Use pelo menos 2 letras no nome.").max(40, "Use até 40 letras no nome."),
  kind: z.enum(STAGE_KINDS, { error: "Escolha o tipo da etapa." }),
  /** Fica logo depois desta (nunca antes da primeira do mesmo tipo). null = logo depois da primeira do mesmo tipo. */
  afterId: z.string().uuid().nullable(),
  visibleProfileIds: z.array(z.string().uuid()).max(20).nullable(),
});

const slug = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 30) || "etapa";
type Cond = { type?: string; stages?: string[] };
type Auto = typeof automations.$inferSelect;

/** Grava a automação com condições novas como uma versão nova, editada pela pessoa (o seed não sobrescreve automação editada). */
async function saveConditionsTx(tx: Tx, a: Auto, conditions: Cond[], userId: string) {
  const version = a.version + 1;
  await tx.update(automations).set({ conditions: conditions as Record<string, unknown>[], version, updatedBy: userId, updatedAt: new Date() }).where(eq(automations.id, a.id));
  await tx.insert(automationVersions).values({ automationId: a.id, version, snapshot: { name: a.name, enabled: a.enabled, trigger: a.trigger, conditions, actions: a.actions }, userId });
}

/**
 * Etapa nova (Configurações › Etapas, Lote 4). Fica depois da primeira do mesmo tipo (a que o sistema usa); copia dela prazo, limite e cor
 * e entra nas mesmas condições "etapa em" das automações: sem isso, cliente esperando na etapa nova não geraria aviso.
 */
export async function createStage(input: z.input<typeof stageCreateSchema>, userId: string): Promise<{ id: string; key: string }> {
  const v = stageCreateSchema.parse(input);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(7120031)`); // duas telas criando ao mesmo tempo não repetem chave nem ordem
    const all = await tx.select().from(stages).orderBy(asc(stages.position));
    if (all.some((s) => s.active && s.name.trim().toLowerCase() === v.name.toLowerCase())) throw new UserFacingError(`Já existe a etapa "${v.name}".`);
    const keys = new Set(all.map((s) => s.key));
    let key = slug(v.name);
    for (let i = 2; keys.has(key); i++) key = `${slug(v.name)}_${i}`;
    const after = v.afterId ? all.find((s) => s.id === v.afterId) : undefined;
    if (v.afterId && !after) throw new UserFacingError("A etapa de referência não existe mais.");
    const model = all.find((s) => s.active && s.kind === v.kind);
    const anchor = Math.max(after?.position ?? -1, model?.position ?? -1);
    const position = anchor >= 0 ? anchor + 1 : (all.at(-1)?.position ?? -1) + 1;
    await tx.update(stages).set({ position: sql`${stages.position} + 1` }).where(sql`${stages.position} >= ${position}`);
    const [row] = await tx.insert(stages).values({
      key, name: v.name, kind: v.kind, position, slaMinutes: model?.slaMinutes ?? 15, staleDays: model?.staleDays ?? null, color: model?.color ?? "#5c5c5c",
      active: true, visibleProfileIds: v.visibleProfileIds?.length ? [...new Set(v.visibleProfileIds)] : null,
    }).returning({ id: stages.id });
    if (model) {
      for (const a of await tx.select().from(automations)) {
        const conds = (a.conditions ?? []) as Cond[];
        if (!conds.some((c) => c.type === "etapa_em" && c.stages?.includes(model.key) && !c.stages.includes(key))) continue;
        await saveConditionsTx(tx, a, conds.map((c) => (c.type === "etapa_em" && c.stages?.includes(model.key) && !c.stages.includes(key) ? { ...c, stages: [...c.stages, key] } : c)), userId);
      }
    }
    await tx.insert(auditLog).values({ userId, action: "criou_etapa", entity: "stage", entityId: row.id, data: { key, name: v.name, kind: v.kind } });
    return { id: row.id, key };
  });
}

/**
 * Apagar etapa. Recusa: a única ativa do tipo (o sistema precisa dela), conversa aberta nela, automação que MOVE para ela, automação
 * que só vale para ela. Sai das condições "etapa em". Com histórico (alguma conversa já passou por ela) é desativada; sem, apagada.
 */
export async function deleteStage(id: string, userId: string): Promise<{ mode: "apagada" | "desativada" }> {
  return db.transaction(async (tx) => {
    const [s] = await tx.select().from(stages).where(eq(stages.id, id)).for("update");
    if (!s || !s.active) throw new UserFacingError("Essa etapa não existe mais.");
    const [same] = await tx.select({ id: stages.id }).from(stages).where(and(eq(stages.kind, s.kind), eq(stages.active, true), ne(stages.id, s.id))).limit(1);
    if (!same) throw new UserFacingError(`"${s.name}" é a única etapa do tipo ${KIND_LABEL[s.kind]}: o sistema precisa dela. Renomeie em vez de apagar.`);
    const [{ open }] = (await tx.execute(sql`select count(*)::int as open from deals where stage_id = ${s.id} and closed_at is null and archived_at is null`)).rows as { open: number }[];
    if (open > 0) throw new UserFacingError(`${open} ${open === 1 ? "conversa está" : "conversas estão"} em "${s.name}". Mova para outra etapa antes de apagar.`);
    const autos = await tx.select().from(automations);
    const mover = autos.find((a) => ((a.actions ?? []) as { type?: string; stage?: string }[]).some((x) => x.type === "mover_para_etapa" && x.stage === s.key));
    if (mover) throw new UserFacingError(`A automação "${mover.name}" move conversas para "${s.name}". Mude a automação antes.`);
    for (const a of autos) {
      const conds = (a.conditions ?? []) as Cond[];
      if (!conds.some((c) => c.type === "etapa_em" && c.stages?.includes(s.key))) continue;
      const next = conds.map((c) => (c.type === "etapa_em" && c.stages ? { ...c, stages: c.stages.filter((k) => k !== s.key) } : c));
      if (next.some((c) => c.type === "etapa_em" && !c.stages?.length)) throw new UserFacingError(`A automação "${a.name}" só vale para "${s.name}". Mude ou apague a automação antes.`);
      await saveConditionsTx(tx, a, next, userId);
    }
    const used = (await tx.execute(sql`select 1 from deals where stage_id = ${s.id} or archived_stage_id = ${s.id}
      union all select 1 from deal_events where type = 'etapa_alterada' and (payload->>'de' = ${s.key} or payload->>'para' = ${s.key}) limit 1`)).rows.length > 0;
    if (used) {
      const [{ max }] = (await tx.execute(sql`select coalesce(max(position), 0)::int as max from stages`)).rows as { max: number }[];
      await tx.update(stages).set({ active: false, position: max + 1 }).where(eq(stages.id, s.id));
    } else {
      await tx.delete(stages).where(eq(stages.id, s.id));
    }
    await tx.insert(auditLog).values({ userId, action: used ? "desativou_etapa" : "apagou_etapa", entity: "stage", entityId: s.id, data: { key: s.key, name: s.name } });
    return { mode: used ? "desativada" : "apagada" };
  });
}

/** Quais perfis veem a etapa no Quadro (null ou vazio = todos). */
export async function setStageProfiles(id: string, profileIds: string[] | null, userId: string): Promise<void> {
  const ids = z.array(z.string().uuid()).max(20).nullable().parse(profileIds);
  const [s] = await db.update(stages).set({ visibleProfileIds: ids?.length ? [...new Set(ids)] : null }).where(eq(stages.id, id)).returning({ id: stages.id });
  if (!s) throw new UserFacingError("Essa etapa não existe mais.");
  await db.insert(auditLog).values({ userId, action: "editou", entity: "stage", entityId: id, data: { perfis: ids } });
}

export const attemptDaysSchema = z.array(z.number().int("Use dias inteiros.").min(1, "Use de 1 a 60 dias.").max(60, "Use de 1 a 60 dias.")).length(3, "São 3 tentativas.")
  .refine((d) => d[0] < d[1] && d[1] < d[2], "Coloque cada tentativa depois da anterior (ex.: 1, 3 e 7 dias).").nullable();

/** Em que dias caem as 3 tentativas da etapa (Em conversa esperando a cliente, Orçamento). null = o padrão do tipo. */
export async function setStageAttemptDays(id: string, days: number[] | null, userId: string): Promise<void> {
  const [s] = await db.select().from(stages).where(eq(stages.id, id));
  if (!s) throw new UserFacingError("Essa etapa não existe mais.");
  if (!isAttemptKind(s.kind)) throw new UserFacingError("Tentativas existem só em Em conversa e Orçamento.");
  const v = attemptDaysSchema.parse(days);
  await db.update(stages).set({ attemptDays: v }).where(eq(stages.id, id));
  await db.insert(auditLog).values({ userId, action: "editou", entity: "stage", entityId: id, data: { tentativas: v } });
}
