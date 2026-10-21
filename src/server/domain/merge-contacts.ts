import { and, asc, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { db, type Tx } from "../db";
import {
  alerts, appointments, auditLog, avecRejectedRows, clientCreditEntries, clientDebtEntries, clientLinks, clientNotes, clientPackages, clientPhotos, comandas, contactMerges,
  contactNotes, contacts, deals, formAnswers, leadSources, loyaltyEntries, messages, packageUses, salesItems, satisfactionAnswers, salesPayments, tasks, visits, type Contact,
} from "../db/schema";
import { UserFacingError } from "./errors";
import { assertFuncao } from "./funcoes";
import { emit, logEvent } from "./events";
import { refreshContactStats } from "./contact-stats";
import { recomputeWaitTx } from "./lid-merge";
import { ALERT_NOTES_MAX } from "./contact-profile";
import { isPersonPhone } from "@/lib/phone-client";
import { KIND_LABEL } from "@/lib/contact-kind";
import { samePerson } from "@/lib/same-person";
import { isUuid } from "@/lib/uuid";

/**
 * Unir cadastros (Fase C, item 25a): dois cadastros da mesma cliente viram um só. Tudo da que sai passa para a que fica (conversas,
 * mensagens, horários, comandas, vendas, pacotes, pontos, fichas, fotos, notas, etiquetas, pessoas a mais), os campos vazios da que fica
 * são completados e a que sai é apagada. `contact_merges` guarda a junção: mensagem nova e importação do Avec com o telefone, o @lid ou o
 * nome da que saiu caem na que ficou (`mergedTargetFor`), mesmo com a função desligada. Não dá para desfazer.
 */

type Q = Tx | typeof db;

/**
 * Cada "tabela.coluna" que aponta para `contacts.id` e que `mergeContacts` trata (move, junta ou deixa a cascata apagar porque é recalculada).
 * O teste `merge-contacts-coverage` trava se aparecer FK nova para contacts fora desta lista.
 */
export const MERGE_HANDLED_FKS: readonly string[] = [
  "deals.contact_id", "messages.contact_id", "tasks.contact_id", "lead_sources.referrer_contact_id",
  "contact_tags.contact_id", "contact_notes.contact_id", "campaign_recipients.contact_id",
  "visits.contact_id", "appointments.contact_id", "comandas.contact_id", "client_credit_entries.contact_id", "client_debt_entries.contact_id", "satisfaction_answers.contact_id",
  "client_packages.contact_id", "package_uses.contact_id", "sales_items.contact_id", "sales_payments.contact_id",
  "avec_rejected_rows.contact_id", "client_notes.contact_id", "contact_stats.contact_id",
  "form_answers.contact_id", "client_photos.contact_id", "loyalty_entries.contact_id",
  "contacts.shares_phone_with", "contact_merges.kept_id",
];

export type MergeMoving = Record<"conversas" | "mensagens" | "horarios" | "comandas" | "vendas" | "pacotes" | "pontos" | "fichas" | "fotos" | "notas", number>;
export type MergeSide = { id: string; name: string | null; phone: string; kind: Contact["kind"]; isPerson: boolean };
export type MergePreview = { keep: MergeSide; drop: MergeSide; moving: MergeMoving; blockers: string[] };

const side = (c: Contact): MergeSide => ({ id: c.id, name: c.name, phone: c.phoneE164, kind: c.kind, isPerson: isPersonPhone(c.phoneE164) });
/** Resposta vazia (a "limpa" do CRM, T5): conta como sem resposta. */
const blankAnswer = (v: unknown) => v == null || (typeof v === "string" && !v.trim()) || (Array.isArray(v) && v.length === 0);
const blank = (v: unknown) => v == null || (typeof v === "string" && !v.trim());
const ddmm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

/** O que vai junto: os números da que sai (pontos = saldo somado de todos os programas). */
async function movingOf(q: Q, dropId: string): Promise<MergeMoving> {
  const [r] = (await q.execute(sql`select
    (select count(*) from deals where contact_id = ${dropId})::int as conversas,
    (select count(*) from messages where contact_id = ${dropId})::int as mensagens,
    (select count(*) from appointments where contact_id = ${dropId})::int as horarios,
    (select count(*) from comandas where contact_id = ${dropId})::int as comandas,
    (select count(*) from sales_items where contact_id = ${dropId})::int as vendas,
    (select count(*) from client_packages where contact_id = ${dropId})::int as pacotes,
    (select coalesce(sum(delta), 0) from loyalty_entries where contact_id = ${dropId})::int as pontos,
    (select count(*) from form_answers where contact_id = ${dropId} and value not in ('""'::jsonb, '[]'::jsonb))::int as fichas,
    (select count(*) from client_photos where contact_id = ${dropId} and deleted_at is null)::int as fotos,
    ((select count(*) from client_notes where contact_id = ${dropId}) + (select count(*) from contact_notes where contact_id = ${dropId}))::int as notas`)).rows as MergeMoving[];
  return { conversas: r.conversas, mensagens: r.mensagens, horarios: r.horarios, comandas: r.comandas, vendas: r.vendas, pacotes: r.pacotes, pontos: r.pontos, fichas: r.fichas, fotos: r.fotos, notas: r.notas };
}

/** O que impede unir (a tela mostra; `mergeContacts` recusa com a primeira). */
async function blockersOf(q: Q, keep: Contact, drop: Contact): Promise<string[]> {
  const out: string[] = [];
  if (keep.id === drop.id) return ["É o mesmo cadastro: escolha outro para unir."];
  if (keep.kind !== drop.kind) out.push(`Os cadastros são de tipos diferentes (${KIND_LABEL[keep.kind]} e ${KIND_LABEL[drop.kind]}). Mude o tipo de um deles antes de unir.`);
  const days = (await q.execute(sql`select distinct day::text as day from comandas where status = 'aberta' and contact_id = ${keep.id}
    and day in (select day from comandas where status = 'aberta' and contact_id = ${drop.id}) order by 1`)).rows as { day: string }[];
  if (days.length) out.push(`As duas têm comanda aberta no dia ${days.map((d) => ddmm(d.day)).join(", ")}. Feche uma das comandas antes de unir.`);
  if (isPersonPhone(keep.phoneE164) && !isPersonPhone(drop.phoneE164)) out.push("Fica o cadastro que tem o número de WhatsApp: troque a ordem.");
  return out;
}

async function loadPair(q: Q, keepId: string, dropId: string, lock = false): Promise<{ keep: Contact; drop: Contact }> {
  if (!isUuid(keepId) || !isUuid(dropId)) throw new UserFacingError("Cliente não encontrada.");
  const base = q.select().from(contacts).where(inArray(contacts.id, [keepId, dropId])).orderBy(asc(contacts.id));
  const rows = lock ? await base.for("update") : await base;
  const keep = rows.find((c) => c.id === keepId), drop = rows.find((c) => c.id === dropId);
  if (!keep || !drop) throw new UserFacingError("Cliente não encontrada. Atualize a página.");
  return { keep, drop };
}

/** A prévia da tela: quem fica, quem sai, o que vai junto e o que impede. */
export async function previewMerge(keepId: string, dropId: string): Promise<MergePreview> {
  await assertFuncao("unir");
  const { keep, drop } = await loadPair(db, keepId, dropId);
  return { keep: side(keep), drop: side(drop), moving: await movingOf(db, drop.id), blockers: await blockersOf(db, keep, drop) };
}

/** Avisos: as linhas se juntam sem repetir; o que passar de 300 caracteres volta como sobra (vai para as anotações). */
function joinAlerts(keep: string | null, drop: string | null): { alertNotes: string | null; overflow: string[] } {
  const lines = (s: string | null) => (s ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  const key = (l: string) => l.toLocaleLowerCase("pt-BR").replace(/\s+/g, " ");
  const out = lines(keep), seen = new Set(out.map(key)), overflow: string[] = [];
  for (const l of lines(drop)) {
    if (seen.has(key(l))) continue;
    seen.add(key(l));
    if ([...out, l].join("\n").length <= ALERT_NOTES_MAX) out.push(l); else overflow.push(l);
  }
  return { alertNotes: out.length ? out.join("\n") : null, overflow };
}

/** Os campos da que fica depois de unir: o vazio é completado com o da outra; o preenchido fica. */
function mergedFields(keep: Contact, drop: Contact): { patch: Partial<typeof contacts.$inferInsert> } {
  const patch: Partial<typeof contacts.$inferInsert> = {};
  for (const f of ["name", "email", "instagram", "cpf", "nickname", "hairType", "phoneAlt", "preferredProfessionalId", "waLid"] as const) {
    if (blank(keep[f]) && !blank(drop[f])) patch[f] = drop[f];
  }
  if (keep.birthDay == null && keep.birthMonth == null && drop.birthDay != null) Object.assign(patch, { birthDay: drop.birthDay, birthMonth: drop.birthMonth, birthYear: drop.birthYear });
  else if (keep.birthYear == null && drop.birthYear != null && keep.birthDay === drop.birthDay && keep.birthMonth === drop.birthMonth) patch.birthYear = drop.birthYear;
  if (keep.imageUse == null && drop.imageUse != null) Object.assign(patch, { imageUse: drop.imageUse, imageUseOn: drop.imageUseOn });

  const { alertNotes, overflow } = joinAlerts(keep.alertNotes, drop.alertNotes);
  if (alertNotes !== keep.alertNotes) patch.alertNotes = alertNotes;
  const dropNotes = drop.notes?.trim();
  const notes = [keep.notes?.trim(), dropNotes && !(keep.notes ?? "").includes(dropNotes) ? dropNotes : null, overflow.length ? `Avisos do cadastro unido:\n${overflow.join("\n")}` : null]
    .filter(Boolean).join("\n\n") || null;
  if (notes !== keep.notes) patch.notes = notes;

  // Importação: o de cada sistema que a que fica tem continua; o que ela não tem vem da outra (o da outra também vai para o snapshot).
  const kf = keep.importedFields ?? {}, df = drop.importedFields ?? {};
  if ((!kf.avec && df.avec) || (!kf.chatguru && df.chatguru)) patch.importedFields = { ...df, ...kf, avec: kf.avec ?? df.avec, chatguru: kf.chatguru ?? df.chatguru };

  if (!keep.isClient && drop.isClient) patch.isClient = true;
  if (drop.clientSince && (!keep.clientSince || drop.clientSince < keep.clientSince)) patch.clientSince = drop.clientSince;
  if (drop.lastServiceAt && (!keep.lastServiceAt || drop.lastServiceAt > keep.lastServiceAt)) patch.lastServiceAt = drop.lastServiceAt;
  return { patch };
}

/**
 * Une `dropId` (sai) em `keepId` (fica), numa transação só. Recusa: o mesmo cadastro, tipos diferentes, comanda aberta das duas no mesmo
 * dia e ficar com uma "pessoa a mais" quando a outra tem número de WhatsApp (a tela troca a ordem). Depois do commit recalcula os
 * números das clientes e avisa as telas.
 */
export async function mergeContacts(i: { keepId: string; dropId: string }, userId: string, now: Date = new Date()): Promise<{ moved: MergeMoving }> {
  const r = await db.transaction(async (tx) => {
    await assertFuncao("unir", tx);
    const { keep, drop } = await loadPair(tx, i.keepId, i.dropId, true);
    const blockers = await blockersOf(tx, keep, drop);
    if (blockers.length) throw new UserFacingError(blockers[0]);
    const moved = await movingOf(tx, drop.id);
    const K = keep.id, D = drop.id;

    // A cadeia: junções que caíam na que sai passam a cair na que fica (inclusive as pessoas a mais que eram do número dela).
    await tx.update(contactMerges).set({ keptId: K }).where(eq(contactMerges.keptId, D));
    await tx.execute(sql`update contact_merges set snapshot = jsonb_set(snapshot, '{contact,sharesPhoneWith}', to_jsonb(${K}::text))
      where snapshot->'contact'->>'sharesPhoneWith' = ${D}`);

    // Conversas: as duas abertas viram uma só (como no @lid). As mensagens vão para a aberta que fica; a outra é arquivada.
    const openOf = async (contactId: string) => (await tx.select().from(deals)
      .where(and(eq(deals.contactId, contactId), isNull(deals.closedAt), isNull(deals.archivedAt))).orderBy(desc(deals.createdAt)).limit(1))[0];
    const keepOpen = await openOf(K), dropOpen = await openOf(D);
    if (keepOpen && dropOpen) {
      await tx.update(messages).set({ dealId: keepOpen.id }).where(eq(messages.dealId, dropOpen.id));
      await tx.update(tasks).set({ dealId: keepOpen.id }).where(and(eq(tasks.dealId, dropOpen.id), isNull(tasks.doneAt)));
      await tx.update(alerts).set({ resolvedAt: now }).where(and(eq(alerts.dealId, dropOpen.id), isNull(alerts.resolvedAt)));
      await tx.update(deals).set({ archivedAt: now }).where(eq(deals.id, dropOpen.id));
      await logEvent(tx, dropOpen.id, "contato_mesclado", { para: keepOpen.id, cadastro: K }, userId);
    }
    await tx.update(deals).set({ contactId: K }).where(eq(deals.contactId, D));
    // A mesma mensagem importada nos dois cadastros: a da que sai perde a chave (nada é apagado).
    await tx.execute(sql`update messages m set import_key = null where m.contact_id = ${D} and m.import_key is not null
      and exists (select 1 from messages k where k.contact_id = ${K} and k.import_key = m.import_key)`);
    await tx.update(messages).set({ contactId: K }).where(eq(messages.contactId, D));

    // Visitas do mesmo dia: os horários (e a comanda, o link, as fotos e a consultoria) passam para a visita da que fica.
    const visitMap = new Map<string, string>();
    for (const v of await tx.select().from(visits).where(eq(visits.contactId, D))) {
      const [kv] = await tx.select().from(visits).where(and(eq(visits.contactId, K), eq(visits.day, v.day))).orderBy(asc(visits.createdAt)).limit(1);
      if (!kv) continue;
      visitMap.set(v.id, kv.id);
      const vNotes = v.notes?.trim();
      const notes = !vNotes || (kv.notes ?? "").includes(vNotes) ? kv.notes : [kv.notes?.trim(), vNotes].filter(Boolean).join("\n");
      await tx.update(visits).set({ notes, dealId: kv.dealId ?? v.dealId, updatedAt: now }).where(eq(visits.id, kv.id));
      await tx.update(appointments).set({ visitId: kv.id }).where(eq(appointments.visitId, v.id));
      await tx.update(comandas).set({ visitId: kv.id }).where(eq(comandas.visitId, v.id));
      await tx.update(clientLinks).set({ visitId: kv.id }).where(eq(clientLinks.visitId, v.id));
      await tx.update(clientPhotos).set({ visitId: kv.id }).where(eq(clientPhotos.visitId, v.id));
    }

    // Fichas (chave composta): a resposta da que fica vence; a da outra vai para o snapshot. A "limpa" (vazia) conta como sem resposta.
    const lostAnswers: { de: "fica" | "sai"; questionId: string; visitId: string | null; value: unknown; source: string; externalKey: string | null }[] = [];
    const keepAnswers = await tx.select().from(formAnswers).where(eq(formAnswers.contactId, K));
    for (const a of await tx.select().from(formAnswers).where(eq(formAnswers.contactId, D))) {
      const visitId = a.visitId ? (visitMap.get(a.visitId) ?? a.visitId) : null;
      const k = keepAnswers.find((x) => x.questionId === a.questionId && x.visitId === visitId);
      if (k && !(blankAnswer(k.value) && !blankAnswer(a.value))) {
        lostAnswers.push({ de: "sai", questionId: a.questionId, visitId, value: a.value, source: a.source, externalKey: a.externalKey });
        await tx.delete(formAnswers).where(eq(formAnswers.id, a.id));
        continue;
      }
      if (k) {
        lostAnswers.push({ de: "fica", questionId: k.questionId, visitId, value: k.value, source: k.source, externalKey: k.externalKey });
        await tx.delete(formAnswers).where(eq(formAnswers.id, k.id));
      }
      // A chave do Avec (`avec:ficha:<que saiu>:…`) fica: a próxima importação acha a resposta pela mesma linha do Avec.
      await tx.update(formAnswers).set({ contactId: K, visitId }).where(eq(formAnswers.id, a.id));
    }
    if (visitMap.size) await tx.delete(visits).where(inArray(visits.id, [...visitMap.keys()]));
    await tx.update(visits).set({ contactId: K }).where(eq(visits.contactId, D));

    // O resto muda de dono. Pontos: a linha do saldo do Avec da outra fica com a chave dela (`avec:fid:<que saiu>`), ao lado da da que fica.
    await tx.update(appointments).set({ contactId: K }).where(eq(appointments.contactId, D));
    await tx.update(comandas).set({ contactId: K }).where(eq(comandas.contactId, D));
    await tx.update(clientCreditEntries).set({ contactId: K }).where(eq(clientCreditEntries.contactId, D));
    await tx.update(clientDebtEntries).set({ contactId: K }).where(eq(clientDebtEntries.contactId, D));
    await tx.update(satisfactionAnswers).set({ contactId: K }).where(eq(satisfactionAnswers.contactId, D));
    await tx.update(clientPackages).set({ contactId: K }).where(eq(clientPackages.contactId, D));
    await tx.update(packageUses).set({ contactId: K }).where(eq(packageUses.contactId, D));
    await tx.update(salesItems).set({ contactId: K }).where(eq(salesItems.contactId, D));
    await tx.update(salesPayments).set({ contactId: K }).where(eq(salesPayments.contactId, D));
    await tx.update(loyaltyEntries).set({ contactId: K }).where(eq(loyaltyEntries.contactId, D));
    await tx.update(clientPhotos).set({ contactId: K }).where(eq(clientPhotos.contactId, D));
    await tx.update(clientNotes).set({ contactId: K }).where(eq(clientNotes.contactId, D));
    await tx.update(contactNotes).set({ contactId: K }).where(eq(contactNotes.contactId, D));
    await tx.update(tasks).set({ contactId: K }).where(eq(tasks.contactId, D));
    await tx.update(leadSources).set({ referrerContactId: K }).where(eq(leadSources.referrerContactId, D));
    await tx.update(avecRejectedRows).set({ contactId: K }).where(eq(avecRejectedRows.contactId, D));
    await tx.execute(sql`insert into contact_tags (contact_id, tag_id, created_by, created_at)
      select ${K}::uuid, tag_id, created_by, created_at from contact_tags where contact_id = ${D}::uuid on conflict do nothing`);
    await tx.execute(sql`delete from contact_tags where contact_id = ${D}::uuid`);
    await tx.execute(sql`insert into campaign_recipients (campaign_id, contact_id, status, message_id, error, sent_at)
      select campaign_id, ${K}::uuid, status, message_id, error, sent_at from campaign_recipients where contact_id = ${D}::uuid on conflict do nothing`);
    await tx.execute(sql`delete from campaign_recipients where contact_id = ${D}::uuid`);
    // Pessoas a mais do número da que sai passam para a que fica.
    await tx.update(contacts).set({ sharesPhoneWith: K }).where(and(eq(contacts.sharesPhoneWith, D), ne(contacts.id, K)));

    const { patch } = mergedFields(keep, drop);
    await tx.insert(contactMerges).values({
      keptId: K, droppedId: D, droppedPhone: drop.phoneE164, droppedWaLid: drop.waLid, droppedName: drop.name,
      snapshot: { contact: drop, avec: drop.importedFields?.avec ?? null, formAnswers: lostAnswers }, mergedBy: userId, mergedAt: now,
    });
    // Apagar antes de completar a que fica: o @lid (índice único) passa da que sai para a que fica.
    await tx.delete(contacts).where(eq(contacts.id, D));
    if (Object.keys(patch).length) await tx.update(contacts).set(patch).where(eq(contacts.id, K));

    const target = keepOpen ?? dropOpen ?? null;
    if (target) {
      await recomputeWaitTx(tx, target);
      await logEvent(tx, target.id, "contato_mesclado", { de: D }, userId);
    }
    await tx.insert(auditLog).values({ userId, action: "cadastros_unidos", entity: "contacts", entityId: K, data: { saiu: D, nome: drop.name, levou: moved } });
    return { moved, dealId: target?.id ?? null };
  });
  try { await refreshContactStats({ now }); } catch (e) { console.error("[unir] números das clientes", e); }
  await emit("lead_atualizado", r.dealId ? { dealId: r.dealId } : {});
  return { moved: r.moved };
}

/* ── redirecionamento: vale mesmo com a função desligada (os cadastros já unidos não voltam) ── */

export type MergedRecord = { keptId: string; droppedId: string; droppedName: string | null };

/** A junção mais recente de quem saiu com este telefone (a que ficou, a que saiu e o nome dela). */
export async function mergedRecordFor(q: Q, phone: string): Promise<MergedRecord | null> {
  const [r] = await q.select({ keptId: contactMerges.keptId, droppedId: contactMerges.droppedId, droppedName: contactMerges.droppedName }).from(contactMerges)
    .where(eq(contactMerges.droppedPhone, phone)).orderBy(desc(contactMerges.mergedAt), desc(contactMerges.id)).limit(1);
  return r ?? null;
}

/** O cadastro que ficou com o telefone de uma cliente que saiu numa junção; null se o telefone nunca saiu. */
export async function mergedTargetFor(q: Q, phone: string): Promise<string | null> {
  return (await mergedRecordFor(q, phone))?.keptId ?? null;
}

/** O mesmo pelo @lid (número oculto) da que saiu. */
export async function mergedTargetForLid(q: Q, lid: string): Promise<string | null> {
  const [r] = await q.select({ keptId: contactMerges.keptId }).from(contactMerges)
    .where(eq(contactMerges.droppedWaLid, lid)).orderBy(desc(contactMerges.mergedAt), desc(contactMerges.id)).limit(1);
  return r?.keptId ?? null;
}

/**
 * A pessoa que saiu numa junção, pelo NOME, no número `phone` (titular `holderId`): a que tinha este telefone ou era "pessoa a mais" deste
 * titular. Assim o Avec com o número do titular e o nome da que saiu cai na que ficou, em vez de criar outra pessoa a mais.
 */
export async function mergedPersonFor(q: Q, p: { phone: string; holderId: string; name: string | null }): Promise<MergedRecord | null> {
  if (!p.name) return null;
  const rows = await q.select({ keptId: contactMerges.keptId, droppedId: contactMerges.droppedId, droppedName: contactMerges.droppedName }).from(contactMerges)
    .where(or(eq(contactMerges.droppedPhone, p.phone), sql`${contactMerges.snapshot}->'contact'->>'sharesPhoneWith' = ${p.holderId}`))
    .orderBy(desc(contactMerges.mergedAt), desc(contactMerges.id));
  return rows.find((r) => samePerson(r.droppedName, p.name)) ?? null;
}

/** Todas as junções (nome da que saiu → a que ficou), para achar pelo nome na importação do Avec. */
export function allMerges(q: Q): Promise<MergedRecord[]> {
  return q.select({ keptId: contactMerges.keptId, droppedId: contactMerges.droppedId, droppedName: contactMerges.droppedName }).from(contactMerges)
    .orderBy(desc(contactMerges.mergedAt), desc(contactMerges.id));
}

/** As junções de vários telefones de uma vez (importação do Avec): telefone → a mais recente. */
export async function mergedRecordsFor(q: Q, phones: string[]): Promise<Map<string, MergedRecord>> {
  const out = new Map<string, MergedRecord>();
  for (let k = 0; k < phones.length; k += 1000) {
    const rows = await q.select({ phone: contactMerges.droppedPhone, keptId: contactMerges.keptId, droppedId: contactMerges.droppedId, droppedName: contactMerges.droppedName })
      .from(contactMerges).where(inArray(contactMerges.droppedPhone, phones.slice(k, k + 1000))).orderBy(desc(contactMerges.mergedAt), desc(contactMerges.id));
    for (const r of rows) if (!out.has(r.phone)) out.set(r.phone, { keptId: r.keptId, droppedId: r.droppedId, droppedName: r.droppedName });
  }
  return out;
}
