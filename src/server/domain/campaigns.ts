import { openReturnInviteTx } from "./return-invite";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import { alerts, auditLog, campaignRecipients, campaigns, channels, contacts, messages, settings, users, type Campaign } from "../db/schema";
import { can } from "@/lib/permissions";
import { isOpen } from "@/lib/business-hours";
import { renderReply } from "@/lib/quick-reply";
import { firstName } from "@/lib/authorship";
import { alertText } from "@/lib/alert-copy";
import { isHiddenNumber } from "@/lib/phone-client";
import { getBusinessHours } from "./hours";
import { getSendCap } from "./messaging-settings";
import { whatsapp } from "../whatsapp/evolution";
import { emit } from "./events";
import { UserFacingError } from "./errors";

export const MASS_SETTING = "envio_massa";
export const CAMPAIGN_MIN_INTERVAL_S = 120;
export const CAMPAIGN_DEFAULT_INTERVAL_S = 180;
export const CAMPAIGN_MAX_RECIPIENTS = 300;
export const CAMPAIGN_DAILY_CAP = 150;
export const CAMPAIGN_RECENT_DAYS = 7;
export const CAMPAIGN_BODY_MAX = 1000;
const STUCK_MS = 15 * 60_000;
const DAY_MS = 86_400_000;
const OFFSET_MS = 3 * 3_600_000;

type Actor = { id: string; perms: readonly string[] };
export type Audience = { q?: string | null; onlyClients?: boolean; tag?: string | null; contactIds?: string[] };
export type ExclusionReason = "nao_e_cliente" | "numero_oculto" | "conversa_aberta" | "recebeu_recente" | "nunca_escreveu" | "sem_consentimento" | "pausada";
export const EXCLUSION_LABEL: Record<ExclusionReason, string> = {
  nao_e_cliente: "marcadas como “Não é cliente” ou Equipe",
  numero_oculto: "com número oculto no WhatsApp",
  conversa_aberta: "com conversa aberta (a equipe está atendendo)",
  recebeu_recente: `receberam mensagem em massa nos últimos ${CAMPAIGN_RECENT_DAYS} dias`,
  nunca_escreveu: "nunca escreveram para a Casa (risco de bloqueio)",
  sem_consentimento: "disseram Não a campanhas por WhatsApp",
  pausada: "com as automáticas pausadas",
};
export type AudiencePreview = { found: number; eligible: number; excluded: { reason: ExclusionReason; label: string; n: number }[]; sample: { id: string; name: string | null; phone: string }[]; tooMany: boolean };
export type CampaignSender = (i: { instance: string; phone: string; text: string }) => Promise<{ externalId: string | null }>;
const defaultSender: CampaignSender = ({ instance, phone, text }) => whatsapp().sendText(instance, phone, text);

/* ---------- Chave em Configurações (nasce desligada) ---------- */
export async function getMassSettings(): Promise<{ enabled: boolean }> {
  const [r] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, MASS_SETTING));
  return { enabled: (r?.value as { enabled?: boolean } | undefined)?.enabled === true };
}
export async function saveMassSettings(input: { enabled: boolean }, userId: string): Promise<void> {
  const value = { enabled: input.enabled === true };
  await db.insert(settings).values({ key: MASS_SETTING, value }).onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
  await db.insert(auditLog).values({ userId, action: value.enabled ? "ligou" : "desligou", entity: "settings", entityId: MASS_SETTING, data: value });
}
async function assertCanSend(actor: Actor) {
  if (!can(actor.perms, "mensagem.massa")) throw new UserFacingError("Você não tem permissão para mandar mensagem em massa.");
  if (!(await getMassSettings()).enabled) throw new UserFacingError("Mensagem em massa está desligada em Configurações › Mensagem em massa.");
}

/* ---------- Quem recebe ---------- */
/** Contatos do filtro (busca por nome/telefone/e-mail, só clientes, etiqueta) ou os escolhidos à mão. A busca por trecho de mensagem não vale aqui. */
async function audienceIds(a: Audience): Promise<string[]> {
  if (a.contactIds?.length) return [...new Set(a.contactIds)];
  const conds = [sql`c.kind = 'cliente'`];
  const term = a.q?.trim().slice(0, 80) ?? "";
  if (term) {
    const like = `%${term.replace(/[\\%_]/g, "\\$&")}%`;
    const digits = term.replace(/\D/g, "");
    conds.push(sql`(coalesce(c.name, '') ilike ${like} or coalesce(c.email, '') ilike ${like}${digits.length >= 3 ? sql` or c.phone_e164 like ${`%${digits}%`}` : sql``})`);
  }
  if (a.onlyClients) conds.push(sql`c.is_client`);
  if (a.tag?.trim()) conds.push(sql`exists (select 1 from contact_tags ct join tags t on t.id = ct.tag_id where ct.contact_id = c.id and lower(t.name) = lower(${a.tag.trim()}))`);
  const r = await db.execute(sql`select c.id from contacts c where ${sql.join(conds, sql` and `)} order by c.created_at, c.id limit 5000`);
  return (r.rows as { id: string }[]).map((x) => x.id);
}

/** Quem pode receber agora. Ficam de fora (nessa ordem): "Não é cliente", número oculto, conversa aberta, quem recebeu nos últimos 7 dias, quem nunca escreveu para a Casa (só manda para quem já conversou: regra do ChatGuru contra bloqueio), quem disse Não a campanhas por WhatsApp e quem está com as automáticas pausadas (a massa é automática para a cliente). Vale mesmo com as funções de consentimento e pausa desligadas. */
async function classify(ids: string[], now: Date): Promise<{ eligible: string[]; excluded: Map<ExclusionReason, number> }> {
  const excluded = new Map<ExclusionReason, number>();
  if (!ids.length) return { eligible: [], excluded };
  const since = new Date(now.getTime() - CAMPAIGN_RECENT_DAYS * DAY_MS).toISOString();
  const rows = (await db.execute(sql`
    select c.id, (c.kind <> 'cliente') as ignored, c.phone_e164,
      exists (select 1 from deals d where d.contact_id = c.id and d.closed_at is null and d.archived_at is null and d.conversation_archived_at is null) as open_deal,
      exists (select 1 from campaign_recipients cr where cr.contact_id = c.id and cr.status = 'enviada' and cr.sent_at > ${since}::timestamptz) as recent,
      exists (select 1 from messages m where m.contact_id = c.id and m.direction = 'in') as wrote,
      (c.consent_whatsapp is false) as no_consent, (c.automations_paused_until > ${now.toISOString()}::timestamptz) as paused
    from contacts c where c.id in ${ids}`)).rows as { id: string; ignored: boolean; phone_e164: string; open_deal: boolean; recent: boolean; wrote: boolean; no_consent: boolean; paused: boolean }[];
  const eligible: string[] = [];
  for (const r of rows) {
    const reason: ExclusionReason | null = r.ignored ? "nao_e_cliente" : isHiddenNumber(r.phone_e164) ? "numero_oculto" : r.open_deal ? "conversa_aberta"
      : r.recent ? "recebeu_recente" : !r.wrote ? "nunca_escreveu" : r.no_consent ? "sem_consentimento" : r.paused ? "pausada" : null;
    if (reason) excluded.set(reason, (excluded.get(reason) ?? 0) + 1); else eligible.push(r.id);
  }
  return { eligible, excluded };
}

export async function previewAudience(a: Audience, now = new Date()): Promise<AudiencePreview> {
  const ids = await audienceIds(a);
  const { eligible, excluded } = await classify(ids, now);
  const sample = eligible.length ? await db.select({ id: contacts.id, name: contacts.name, phone: contacts.phoneE164 }).from(contacts).where(inArray(contacts.id, eligible.slice(0, 5))) : [];
  return {
    found: ids.length, eligible: eligible.length, sample, tooMany: eligible.length > CAMPAIGN_MAX_RECIPIENTS,
    excluded: [...excluded].map(([reason, n]) => ({ reason, label: EXCLUSION_LABEL[reason], n })),
  };
}

/* ---------- Montar, confirmar, pausar, cancelar ---------- */
/** Monta o rascunho com a lista congelada. Nada sai até a segunda confirmação (`confirmCampaign`). */
export async function createCampaign(input: { name: string; body: string; audience: Audience; intervalSeconds?: number }, actor: Actor, now = new Date()): Promise<{ id: string; total: number }> {
  await assertCanSend(actor);
  const name = input.name.trim().slice(0, 80);
  if (!name) throw new UserFacingError("Dê um nome para a mensagem em massa (só a equipe vê).");
  const body = input.body.trim();
  if (!body) throw new UserFacingError("Escreva a mensagem.");
  if (body.length > CAMPAIGN_BODY_MAX) throw new UserFacingError(`Mensagem muito longa (máximo ${CAMPAIGN_BODY_MAX.toLocaleString("pt-BR")} caracteres).`);
  if (/\{(data_horario|profissional)\}/.test(body)) throw new UserFacingError("Em mensagem em massa só vale {primeiro_nome} e {saudacao}: cada cliente tem um horário diferente.");
  const interval = input.intervalSeconds ?? CAMPAIGN_DEFAULT_INTERVAL_S;
  if (!Number.isInteger(interval) || interval < CAMPAIGN_MIN_INTERVAL_S) throw new UserFacingError("O intervalo mínimo entre uma mensagem e outra é de 2 minutos.");
  const { eligible } = await classify(await audienceIds(input.audience), now);
  if (!eligible.length) throw new UserFacingError("Ninguém do filtro pode receber (veja quem ficou de fora e por quê).");
  if (eligible.length > CAMPAIGN_MAX_RECIPIENTS) throw new UserFacingError(`No máximo ${CAMPAIGN_MAX_RECIPIENTS} clientes por vez. Filtre mais.`);
  return db.transaction(async (tx) => {
    const [c] = await tx.insert(campaigns).values({ name, body, intervalSeconds: interval, audience: input.audience as Record<string, unknown>, total: eligible.length, createdBy: actor.id, createdAt: now }).returning({ id: campaigns.id });
    await tx.insert(campaignRecipients).values(eligible.map((contactId) => ({ campaignId: c.id, contactId })));
    await tx.insert(auditLog).values({ userId: actor.id, action: "criou", entity: "campanha", entityId: c.id, data: { name, total: eligible.length } });
    return { id: c.id, total: eligible.length };
  });
}

/** Segunda confirmação: marcar o risco de bloqueio e digitar quantas clientes vão receber. Uma de cada vez: se outra estiver saindo, esta espera. */
export async function confirmCampaign(id: string, input: { typedTotal: number; acceptRisk: boolean; startAt?: Date | null }, actor: Actor, now = new Date()): Promise<{ startAt: Date; endsAround: Date }> {
  await assertCanSend(actor);
  const [c] = await db.select().from(campaigns).where(eq(campaigns.id, id));
  if (!c || c.status !== "rascunho") throw new UserFacingError("Essa mensagem em massa não está esperando confirmação.");
  if (!input.acceptRisk) throw new UserFacingError("Marque que entende o risco de bloqueio do número.");
  if (input.typedTotal !== c.total) throw new UserFacingError(`Digite ${c.total} (o número de clientes que vão receber) para confirmar.`);
  const startAt = input.startAt && input.startAt > now ? input.startAt : now;
  await db.update(campaigns).set({ status: "agendada", startAt, confirmedBy: actor.id, confirmedAt: now }).where(and(eq(campaigns.id, id), eq(campaigns.status, "rascunho")));
  await db.insert(auditLog).values({ userId: actor.id, action: "confirmou", entity: "campanha", entityId: id, data: { total: c.total, startAt: startAt.toISOString() } });
  return { startAt, endsAround: new Date(startAt.getTime() + c.total * c.intervalSeconds * 1000) };
}

async function setStatus(id: string, from: string[], to: string, actor: Actor, action: string) {
  if (!can(actor.perms, "mensagem.massa")) throw new UserFacingError("Você não tem permissão para mandar mensagem em massa.");
  const [c] = await db.update(campaigns).set({ status: to, ...(to === "cancelada" ? { finishedAt: new Date() } : {}) })
    .where(and(eq(campaigns.id, id), inArray(campaigns.status, from))).returning({ id: campaigns.id });
  if (!c) throw new UserFacingError("Não deu: a mensagem em massa mudou de situação. Atualize a página.");
  await db.insert(auditLog).values({ userId: actor.id, action, entity: "campanha", entityId: id, data: { para: to } });
}
export const pauseCampaign = (id: string, actor: Actor) => setStatus(id, ["agendada", "enviando"], "pausada", actor, "pausou");
export async function resumeCampaign(id: string, actor: Actor) { await assertCanSend(actor); await setStatus(id, ["pausada"], "enviando", actor, "retomou"); }
export async function cancelCampaign(id: string, actor: Actor) {
  await setStatus(id, ["rascunho", "agendada", "enviando", "pausada"], "cancelada", actor, "cancelou");
  await db.update(campaignRecipients).set({ status: "pulada", error: "Mensagem em massa cancelada." }).where(and(eq(campaignRecipients.campaignId, id), eq(campaignRecipients.status, "pendente")));
}

/* ---------- Envio (worker) ---------- */
const bahiaDayStart = (now: Date) => new Date(Math.floor((now.getTime() - OFFSET_MS) / DAY_MS) * DAY_MS + OFFSET_MS);
type Waiting = "desligada" | "casa_fechada" | "limite_do_dia" | "teto_por_hora" | "intervalo";
export type DrainResult = { sent: number; failed: number; skipped: number; waiting?: Waiting };

/**
 * Worker (a cada minuto): manda NO MÁXIMO UMA mensagem por rodada, da mensagem em massa confirmada mais antiga.
 * Para se: a chave foi desligada, a Casa está fechada, já saíram 150 hoje, o teto por hora (o mesmo das automáticas, somado) bateu
 * ou o intervalo ainda não passou. Nunca reenvia: envio interrompido vira "falhou".
 */
export async function drainCampaigns(now = new Date(), send: CampaignSender = defaultSender): Promise<DrainResult> {
  const out: DrainResult = { sent: 0, failed: 0, skipped: 0 };
  await db.update(campaignRecipients).set({ status: "falhou", error: "Envio interrompido: confira no WhatsApp antes de mandar de novo." })
    .where(and(eq(campaignRecipients.status, "enviando"), sql`${campaignRecipients.sentAt} < ${new Date(now.getTime() - STUCK_MS).toISOString()}::timestamptz`));
  if (!(await getMassSettings()).enabled) return { ...out, waiting: "desligada" };
  if (!isOpen(now.getTime(), await getBusinessHours())) return { ...out, waiting: "casa_fechada" };
  let [c] = await db.select().from(campaigns).where(eq(campaigns.status, "enviando")).orderBy(asc(campaigns.confirmedAt)).limit(1);
  if (!c) {
    const r = await db.execute(sql`update campaigns set status = 'enviando' where id = (
      select id from campaigns where status = 'agendada' and start_at <= ${now.toISOString()}::timestamptz order by confirmed_at limit 1) returning id`);
    const id = (r.rows[0] as { id: string } | undefined)?.id;
    if (!id) return out;
    [c] = await db.select().from(campaigns).where(eq(campaigns.id, id));
  }
  const [{ today }] = (await db.execute(sql`select count(*)::int as today from campaign_recipients where status = 'enviada' and sent_at >= ${bahiaDayStart(now).toISOString()}::timestamptz`)).rows as { today: number }[];
  if (today >= CAMPAIGN_DAILY_CAP) return { ...out, waiting: "limite_do_dia" };
  const hourAgo = new Date(now.getTime() - 3_600_000).toISOString();
  const [{ hour }] = (await db.execute(sql`select ((select count(*) from campaign_recipients where status = 'enviada' and sent_at > ${hourAgo}::timestamptz)
    + (select count(*) from outbox where status = 'sent' and sent_at > ${hourAgo}::timestamptz))::int as hour`)).rows as { hour: number }[];
  if (hour >= await getSendCap()) return { ...out, waiting: "teto_por_hora" };
  const [{ last }] = (await db.execute(sql`select max(sent_at) as last from campaign_recipients where campaign_id = ${c.id} and status in ('enviada', 'falhou', 'enviando')`)).rows as { last: string | Date | null }[];
  if (last && now.getTime() - new Date(last).getTime() < c.intervalSeconds * 1000) return { ...out, waiting: "intervalo" };
  // Reserva a próxima (FOR UPDATE SKIP LOCKED): dois workers nunca mandam para a mesma pessoa.
  const next = await db.transaction(async (tx) => {
    const [r] = await tx.select().from(campaignRecipients).where(and(eq(campaignRecipients.campaignId, c.id), eq(campaignRecipients.status, "pendente")))
      .orderBy(asc(campaignRecipients.contactId)).limit(1).for("update", { skipLocked: true });
    if (!r) return null;
    await tx.update(campaignRecipients).set({ status: "enviando", sentAt: now }).where(and(eq(campaignRecipients.campaignId, c.id), eq(campaignRecipients.contactId, r.contactId)));
    return r;
  });
  if (!next) { await finishCampaign(c, now); return out; }
  const result = await sendOne(c, next.contactId, now, send);
  out[result]++;
  return out;
}

async function sendOne(c: Campaign, contactId: string, now: Date, send: CampaignSender): Promise<"sent" | "failed" | "skipped"> {
  const mark = (status: "enviada" | "falhou" | "pulada" | "pendente", extra: Partial<typeof campaignRecipients.$inferInsert> = {}) =>
    db.update(campaignRecipients).set({ status, ...extra }).where(and(eq(campaignRecipients.campaignId, c.id), eq(campaignRecipients.contactId, contactId)));
  // Confere de novo na hora: ela pode ter começado a conversar, virado "Não é cliente" ou recebido outra em massa.
  const { eligible, excluded } = await classify([contactId], now);
  if (!eligible.length) {
    await mark("pulada", { sentAt: null, error: [...excluded.keys()].map((k) => EXCLUSION_LABEL[k]).join(", ") });
    return "skipped";
  }
  const [ch] = await db.select().from(channels).where(eq(channels.status, "conectado")).limit(1);
  if (!ch) {
    await mark("pendente", { sentAt: null });
    await db.update(campaigns).set({ status: "pausada" }).where(eq(campaigns.id, c.id));
    await db.insert(alerts).values({ userId: c.confirmedBy, audience: c.confirmedBy ? "responsavel" : "gestao", type: "massa_pausada", severity: "info",
      message: `Mensagem em massa “${c.name}” pausada: nenhum WhatsApp conectado. Conecte o número e toque em Retomar.`,
      dedupeKey: `massa:pausa:${c.id}:${now.toISOString().slice(0, 13)}` }).onConflictDoNothing();
    await emit("alerta", {});
    return "skipped";
  }
  const [ct] = await db.select({ name: contacts.name, phone: contacts.phoneE164 }).from(contacts).where(eq(contacts.id, contactId));
  const text = renderReply(c.body, { primeiroNome: firstName(ct.name), dataHorario: null, profissional: null }, now.getTime()).text;
  // Sem autora: aparece na conversa como mensagem automática da Casa. Conversa aberta não recebe (a lista exclui); depois de entregue,
  // a conversa encerrada ABRE em Aguardando cliente com o selo "Convite de retorno" (openReturnInviteTx).
  const [msg] = await db.insert(messages).values({ dealId: null, contactId, channelId: ch.id, direction: "out", kind: "text", body: text, status: "pending", createdAt: now }).returning({ id: messages.id });
  let externalId: string | null = null;
  try {
    ({ externalId } = await send({ instance: ch.instanceName, phone: ct.phone, text }));
  } catch (e) {
    const why = (e instanceof Error ? e.message : String(e)).slice(0, 200);
    await db.update(messages).set({ status: "failed", error: why }).where(eq(messages.id, msg.id));
    await mark("falhou", { messageId: msg.id, sentAt: now, error: why });
    return "failed";
  }
  await db.update(messages).set({ status: "sent" }).where(and(eq(messages.id, msg.id), eq(messages.status, "pending")));
  // O eco do WhatsApp pode já ter gravado o id: nunca derruba o registro do envio por isso.
  if (externalId) await db.update(messages).set({ externalId }).where(and(eq(messages.id, msg.id), isNull(messages.externalId))).catch(() => {});
  await mark("enviada", { messageId: msg.id, sentAt: now, error: null });
  const dealId = await db.transaction((tx) => openReturnInviteTx(tx, contactId, msg.id, now));
  await emit("lead_atualizado", { dealId });
  return "sent";
}

async function finishCampaign(c: Campaign, now: Date) {
  const [done] = await db.update(campaigns).set({ status: "concluida", finishedAt: now }).where(and(eq(campaigns.id, c.id), eq(campaigns.status, "enviando"))).returning({ id: campaigns.id });
  if (!done) return;
  const rows = (await db.execute(sql`select status, count(*)::int as n from campaign_recipients where campaign_id = ${c.id} group by status`)).rows as { status: string; n: number }[];
  const n = (s: string) => rows.find((r) => r.status === s)?.n ?? 0;
  await db.insert(alerts).values({ userId: c.confirmedBy, audience: c.confirmedBy ? "responsavel" : "gestao", type: "massa_concluida", severity: "info",
    message: alertText.campaignDone(c.name, n("enviada"), n("falhou")), dedupeKey: `massa:fim:${c.id}` }).onConflictDoNothing();
  await emit("alerta", {});
}

/* ---------- Lista (Configurações) ---------- */
export type CampaignSummary = { id: string; name: string; status: string; total: number; intervalSeconds: number; startAt: string | null; createdAt: string; createdByName: string; sent: number; failed: number; skipped: number };
export async function listCampaigns(limit = 20): Promise<CampaignSummary[]> {
  const r = await db.execute(sql`
    select c.id, c.name, c.status, c.total, c.interval_seconds as "intervalSeconds", c.start_at as "startAt", c.created_at as "createdAt", u.name as "createdByName",
      count(*) filter (where r.status = 'enviada')::int as sent, count(*) filter (where r.status = 'falhou')::int as failed, count(*) filter (where r.status = 'pulada')::int as skipped
    from campaigns c join ${users} u on u.id = c.created_by left join campaign_recipients r on r.campaign_id = c.id
    group by c.id, u.name order by c.created_at desc limit ${limit}`);
  return (r.rows as (Omit<CampaignSummary, "startAt" | "createdAt"> & { startAt: Date | null; createdAt: Date })[])
    .map((x) => ({ ...x, startAt: x.startAt ? new Date(x.startAt).toISOString() : null, createdAt: new Date(x.createdAt).toISOString() }));
}
