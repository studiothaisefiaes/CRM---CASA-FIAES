// src/server/domain/authorship-backfill.ts
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import { auditLog, contacts, dealEvents, deals, messages, users } from "../db/schema";
import { parseSignature, signatureKey } from "@/lib/signature";
import { teamShortName } from "@/lib/authorship";
import { sentViaOf, signatureMap, type SentVia } from "./authorship";
import { logEvent } from "./events";
import { reassignWaitAlerts } from "./wait-alerts";

export type OwnerReplyRow = { dona: string; respondeu: string; conversas: number };
export type BackfillPlan = {
  since: string;
  /** Mensagens da Casa que ganham autora (assinatura) e/ou o "por onde saiu". */
  messages: { id: string; sentByUserId: string | null; sentVia: SentVia | null; before: { sentByUserId: string | null; sentVia: string | null } }[];
  /** Assinaturas no formato certo que ninguém da equipe usa (nome → quantas mensagens): ficam sem autora. */
  unknownSignatures: Record<string, number>;
  /** Conversas abertas sem dona que ganham a dona pela última resposta com autora. */
  owners: { dealId: string; ownerId: string }[];
  /** Conversas abertas cujo "quem respondeu por último" muda. */
  replies: { dealId: string; lastReplyById: string; lastReplyVia: SentVia }[];
  /** Dona × quem respondeu por último (pela assinatura), antes e depois. */
  before: OwnerReplyRow[]; after: OwnerReplyRow[];
};
export type BackfillBackup = {
  criadoEm: string; desde: string;
  mensagens: { id: string; sentByUserId: string | null; sentVia: string | null }[];
  conversas: { id: string; ownerId: string | null; lastReplyById: string | null; lastReplyVia: string | null }[];
};

type MsgRow = { id: string; deal_id: string | null; body: string | null; from_phone: boolean; sent_via: string | null; sent_by_user_id: string | null };
const NONE = "ninguém / sem assinatura";

function table(m: Map<string, number>): OwnerReplyRow[] {
  return [...m].map(([k, conversas]) => { const [dona, respondeu] = k.split("\u0000"); return { dona, respondeu, conversas }; })
    .sort((a, b) => a.dona.localeCompare(b.dona, "pt-BR") || b.conversas - a.conversas || a.respondeu.localeCompare(b.respondeu, "pt-BR"));
}

/**
 * Ensaio (só leitura): quem assinou cada mensagem da Casa do período (e de todas as conversas abertas) e quem vira a dona.
 * A dona sai da ÚLTIMA mensagem da Casa com autora: áudio ou foto sem assinatura depois não apagam quem respondeu.
 */
export async function planBackfill(opts: { days: number; now?: Date }): Promise<BackfillPlan> {
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - opts.days * 86_400_000);
  const sigs = await signatureMap();
  const people = await db.select({ id: users.id, name: users.name, signature: users.signature, active: users.active }).from(users);
  const names = new Map(people.map((u) => [u.id, teamShortName(u)]));
  const active = new Set(people.filter((u) => u.active).map((u) => u.id));
  const rows = (await db.execute(sql`
    select m.id, m.deal_id, m.body, m.from_phone, m.sent_via, m.sent_by_user_id
    from messages m left join deals d on d.id = m.deal_id
    where m.direction = 'out'
      and (m.created_at >= ${since.toISOString()}::timestamptz or (d.id is not null and d.closed_at is null and d.archived_at is null))
    order by m.created_at desc, m.id desc`)).rows as MsgRow[];

  const unknown: Record<string, number> = {};
  const authorOf = new Map<string, string | null>();
  const viaOf = new Map<string, SentVia | null>();
  const msgs: BackfillPlan["messages"] = [];
  for (const r of rows) {
    const sig = r.sent_by_user_id ? null : parseSignature(r.body);
    const signer = sig ? sigs.get(signatureKey(sig)) ?? null : null;
    if (sig && !signer) unknown[sig] = (unknown[sig] ?? 0) + 1;
    const by = r.sent_by_user_id ?? signer?.id ?? null;
    const via = (r.sent_via as SentVia | null) ?? sentViaOf({ fromPhone: r.from_phone, authorId: by });
    authorOf.set(r.id, by); viaOf.set(r.id, via);
    if (by !== r.sent_by_user_id || via !== r.sent_via) msgs.push({ id: r.id, sentByUserId: by, sentVia: via, before: { sentByUserId: r.sent_by_user_id, sentVia: r.sent_via } });
  }

  // Última mensagem da Casa com autora, por conversa (as linhas vêm da mais nova para a mais antiga).
  const last = new Map<string, { by: string; via: SentVia }>();
  for (const r of rows) {
    const by = authorOf.get(r.id);
    if (!r.deal_id || last.has(r.deal_id) || !by) continue;
    last.set(r.deal_id, { by, via: viaOf.get(r.id) ?? "celular" });
  }

  const open = await db.select({ id: deals.id, ownerId: deals.ownerId, lastReplyById: deals.lastReplyById, lastReplyVia: deals.lastReplyVia })
    .from(deals).innerJoin(contacts, eq(contacts.id, deals.contactId))
    .where(and(isNull(deals.closedAt), isNull(deals.archivedAt), eq(contacts.ignored, false)));
  const owners: BackfillPlan["owners"] = [], replies: BackfillPlan["replies"] = [];
  const before = new Map<string, number>(), after = new Map<string, number>();
  const label = (id: string | null, none: string) => (id ? names.get(id) ?? "?" : none);
  const bump = (m: Map<string, number>, dona: string, resp: string) => { const k = `${dona}\u0000${resp}`; m.set(k, (m.get(k) ?? 0) + 1); };
  for (const d of open) {
    const l = last.get(d.id) ?? null;
    const newOwner = d.ownerId ?? (l && active.has(l.by) ? l.by : null);
    if (!d.ownerId && newOwner) owners.push({ dealId: d.id, ownerId: newOwner });
    if (l && (l.by !== d.lastReplyById || l.via !== d.lastReplyVia)) replies.push({ dealId: d.id, lastReplyById: l.by, lastReplyVia: l.via });
    bump(before, label(d.ownerId, "Sem dono"), label(l?.by ?? null, NONE));
    bump(after, label(newOwner, "Sem dono"), label(l?.by ?? null, NONE));
  }
  return { since: since.toISOString(), messages: msgs, unknownSignatures: unknown, owners, replies, before: table(before), after: table(after) };
}

const valuesOf = (rows: { id: string; uid: string | null; via: string | null }[]) =>
  sql.join(rows.map((r) => sql`(${r.id}::uuid, ${r.uid}::uuid, ${r.via}::text)`), sql`, `);

/**
 * Aplica o plano numa transação. `writeBackup` recebe os valores ATUAIS de tudo que vai mudar e roda antes de qualquer UPDATE:
 * se falhar, nada é gravado. Não cria aviso nem mexe em etapa (o motor não dispara); a dona nova recebe os alertas de espera abertos.
 */
export async function applyBackfill(plan: BackfillPlan, writeBackup: (b: BackfillBackup) => Promise<void>, actorId: string | null = null) {
  const msgIds = plan.messages.map((m) => m.id);
  const dealIds = [...new Set([...plan.owners.map((o) => o.dealId), ...plan.replies.map((r) => r.dealId)])];
  return db.transaction(async (tx) => {
    const curMsgs = msgIds.length ? await tx.select({ id: messages.id, sentByUserId: messages.sentByUserId, sentVia: messages.sentVia }).from(messages).where(inArray(messages.id, msgIds)) : [];
    const curDeals = dealIds.length ? await tx.select({ id: deals.id, ownerId: deals.ownerId, lastReplyById: deals.lastReplyById, lastReplyVia: deals.lastReplyVia }).from(deals).where(inArray(deals.id, dealIds)).for("update") : [];
    await writeBackup({ criadoEm: new Date().toISOString(), desde: plan.since, mensagens: curMsgs, conversas: curDeals });
    for (let i = 0; i < plan.messages.length; i += 500) {
      const chunk = plan.messages.slice(i, i + 500).map((m) => ({ id: m.id, uid: m.sentByUserId, via: m.sentVia }));
      await tx.execute(sql`update messages m set sent_by_user_id = v.uid, sent_via = v.via from (values ${valuesOf(chunk)}) as v(id, uid, via) where m.id = v.id`);
    }
    let owners = 0;
    for (const o of plan.owners) {
      // Só se continuar sem dona: alguém pode ter assumido entre o ensaio e agora.
      const hit = await tx.update(deals).set({ ownerId: o.ownerId }).where(and(eq(deals.id, o.dealId), isNull(deals.ownerId))).returning({ id: deals.id });
      if (!hit.length) continue;
      owners++;
      await reassignWaitAlerts(tx, o.dealId, o.ownerId);
      await logEvent(tx, o.dealId, "assumiu", { de: null, para: o.ownerId, motivo: "assinatura", migracao: true }, o.ownerId);
    }
    for (const r of plan.replies) await tx.update(deals).set({ lastReplyById: r.lastReplyById, lastReplyVia: r.lastReplyVia }).where(eq(deals.id, r.dealId));
    await tx.insert(auditLog).values({ userId: actorId, action: "autoria_assinaturas", entity: "deal", entityId: null,
      data: { mensagens: plan.messages.length, donas: owners, ultimasRespostas: plan.replies.length, desde: plan.since } });
    return { messages: plan.messages.length, owners, replies: plan.replies.length };
  });
}

/** Desfaz a partir do backup: volta autora, "por onde saiu", dona e última resposta, e apaga os eventos "assumiu" do acerto. */
export async function restoreBackfill(b: BackfillBackup): Promise<{ messages: number; deals: number }> {
  return db.transaction(async (tx) => {
    for (let i = 0; i < b.mensagens.length; i += 500) {
      const chunk = b.mensagens.slice(i, i + 500).map((m) => ({ id: m.id, uid: m.sentByUserId, via: m.sentVia }));
      await tx.execute(sql`update messages m set sent_by_user_id = v.uid, sent_via = v.via from (values ${valuesOf(chunk)}) as v(id, uid, via) where m.id = v.id`);
    }
    for (const d of b.conversas) {
      await tx.update(deals).set({ ownerId: d.ownerId, lastReplyById: d.lastReplyById, lastReplyVia: d.lastReplyVia as SentVia | null }).where(eq(deals.id, d.id));
    }
    const ids = b.conversas.map((d) => d.id);
    if (ids.length) await tx.delete(dealEvents).where(and(inArray(dealEvents.dealId, ids), eq(dealEvents.type, "assumiu"), sql`${dealEvents.payload}->>'migracao' = 'true'`));
    return { messages: b.mensagens.length, deals: b.conversas.length };
  });
}
