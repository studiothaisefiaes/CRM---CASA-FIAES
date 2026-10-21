import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "./index";
import { stages, lists, automations, profiles, settings } from "./schema";
import { GESTAO_OPTIONAL, GESTAO_REQUIRED, LEGACY_CONFIG_PERM, ONE_TIME_GRANTS, SYSTEM_PROFILES } from "@/lib/permissions";
import { DEFAULT_STAGES, DEFAULT_LISTS, DEFAULT_QUICK_REPLIES, DEFAULT_AUTOMATIONS } from "./seed-data";

/** Marca de que a troca de permissões do Lote 4 já rodou: a gestão pode tirar o dia a dia da Atendente e o próximo deploy não devolve. */
export const CONFIG_SPLIT_MARK = "migracao_permissoes_config";

/**
 * Lote 4 (idempotente). Em qualquer perfil, "config.editar" vira "config.diaadia" + "config.sistema" (o mesmo acesso de antes). Uma vez só
 * (marca em `settings`), Atendente e Recepção ganham "config.diaadia": a spec põe o dia a dia com quem atende.
 */
async function migrateConfigPerms(db: Db) {
  await db.execute(sql`update profiles
    set permissions = array(select distinct p from unnest(array_remove(permissions, ${LEGACY_CONFIG_PERM}::text) || array['config.diaadia', 'config.sistema']::text[]) p order by p)
    where ${LEGACY_CONFIG_PERM}::text = any(permissions)`);
  const [done] = await db.select({ key: settings.key }).from(settings).where(eq(settings.key, CONFIG_SPLIT_MARK));
  if (done) return;
  await db.execute(sql`update profiles set permissions = array(select distinct p from unnest(permissions || array['config.diaadia']::text[]) p order by p)
    where key in ('atendente', 'recepcao')`);
  await db.insert(settings).values({ key: CONFIG_SPLIT_MARK, value: { em: new Date().toISOString() } }).onConflictDoNothing();
}

/**
 * Na Casa (0035): num banco que já tinha o funil, a etapa nasce logo depois de Agendado e as seguintes andam uma posição.
 * Só na criação (a gestão pode reordenar depois); banco novo já vem na ordem do DEFAULT_STAGES.
 */
async function placeNaCasa(db: Db, created: string[]) {
  if (!created.includes("na_casa") || created.includes("agendado")) return;
  const [ag] = await db.select({ position: stages.position }).from(stages).where(eq(stages.key, "agendado"));
  if (!ag) return;
  await db.update(stages).set({ position: sql`${stages.position} + 1` }).where(and(sql`${stages.position} > ${ag.position}`, sql`${stages.key} <> 'na_casa'`));
  await db.update(stages).set({ position: ag.position + 1 }).where(eq(stages.key, "na_casa"));
}

/** Idempotente: pode rodar quantas vezes quiser sem duplicar nem sobrescrever edições do gestor. */
export async function seed(db: Db) {
  // Perfis de sistema: cria os que faltam sem mexer nas permissões editadas; a Gestão sempre tem tudo (ninguém fica trancado para fora), menos o rodízio de leads, que é opcional.
  await db.insert(profiles).values(SYSTEM_PROFILES.map((p) => ({ key: p.key, name: p.name, permissions: [...p.permissions], isSystem: true })))
    .onConflictDoNothing({ target: profiles.key });
  await migrateConfigPerms(db);
  const [gestao] = await db.select({ permissions: profiles.permissions }).from(profiles).where(eq(profiles.key, "gestao"));
  const optional = GESTAO_OPTIONAL.filter((p) => gestao?.permissions.includes(p));
  await db.update(profiles).set({ permissions: [...GESTAO_REQUIRED, ...optional], isSystem: true }).where(eq(profiles.key, "gestao"));
  await grantOnce(db);
  const created = await db.insert(stages).values(DEFAULT_STAGES.map((s) => ({ ...s }))).onConflictDoNothing({ target: stages.key }).returning({ key: stages.key });
  await placeNaCasa(db, created.map((c) => c.key));
  const listRows = [
    ...Object.entries(DEFAULT_LISTS).flatMap(([kind, labels]) =>
      labels.map((label, position) => ({ kind: kind as keyof typeof DEFAULT_LISTS, label, position }))),
    ...DEFAULT_QUICK_REPLIES.map((q, position) => ({ kind: "quick_reply" as const, label: q.label, body: q.body, category: q.folder, position })),
  ];
  await db.insert(lists).values(listRows).onConflictDoNothing();
  await db.insert(automations).values(DEFAULT_AUTOMATIONS.map((a) => ({ ...a }))).onConflictDoNothing({ target: automations.key });
  // Padrões que mudaram entre versões do sistema: atualiza só as automações que a gestão nunca editou.
  for (const a of DEFAULT_AUTOMATIONS) {
    await db.update(automations).set({ name: a.name, trigger: a.trigger, conditions: a.conditions ?? [], actions: a.actions })
      .where(and(eq(automations.key, a.key), eq(automations.version, 1), isNull(automations.updatedBy)));
  }
  const [{ n }] = (await db.execute(sql`select count(*)::int as n from stages`)).rows as { n: number }[];
  return { stages: n };
}

/** Onde o seed guarda o que já deu aos perfis existentes ("<perfil>:<permissão>"). */
export const GRANTS_KEY = "perfis_permissoes_concedidas";

/**
 * Permissões novas para Atendente e Recepção que já existem: entram UMA vez. O que a gestão tirar depois não volta, porque a lista do que
 * já foi dado fica em `settings` (perfil novo já nasce com elas pelo SYSTEM_PROFILES e a concessão só registra).
 */
async function grantOnce(db: Db) {
  const [row] = await db.select().from(settings).where(eq(settings.key, GRANTS_KEY));
  const given = new Set(Array.isArray(row?.value) ? (row.value as unknown[]).filter((x): x is string => typeof x === "string") : []);
  const before = given.size;
  for (const g of ONE_TIME_GRANTS) {
    const tag = `${g.profile}:${g.perm}`;
    if (given.has(tag)) continue;
    await db.update(profiles).set({ permissions: sql`array_append(${profiles.permissions}, ${g.perm})` })
      .where(and(eq(profiles.key, g.profile), sql`not (${g.perm} = any(${profiles.permissions}))`));
    given.add(tag);
  }
  if (given.size === before && row) return;
  const value = [...given];
  await db.insert(settings).values({ key: GRANTS_KEY, value }).onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
}
