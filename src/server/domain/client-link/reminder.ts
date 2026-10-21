import { genericClientSql } from "@/lib/generic-client";
import { and, asc, desc, eq, gt, gte, inArray, isNull, lt, lte, sql } from "drizzle-orm";
import { activeAutomationFilter } from "../../rules/retired";
import { db } from "../../db";
import { appointments, auditLog, automations, contacts, deals, outbox, settings, visits } from "../../db/schema";
import { UserFacingError } from "../errors";
import { enqueueAutomated } from "../outbox";
import { visitIdFor } from "../agenda/ports";
import { hourText, mapsLink, onlyFirstName, serviceParts, shortDay } from "@/lib/client-link";
import { isEveOf, reminderSendAt, renderReminder } from "@/lib/reminder-d1";
import { slotMs } from "@/lib/schedule";
import { createClientLink, visitAppointments } from "./links";
import { holderIdOf } from "../people-on-number";
import { ALREADY_CAME, REMINDER_SOURCE, RESCHEDULED_SOURCE, reminderStillValid, VISIT_STARTED } from "./reminder-check";
import { getCasaInfo, getLembreteD1, lembreteSchema, type LembreteD1 } from "./settings";
import { assertViradaParaLigar, assertViradaPronta, desfazerVirada } from "../virada";

/** Até quantos dias à frente o job olha (o lembrete sai 24 h antes; folga para a semana). */
const LOOKAHEAD_MS = 8 * 86_400_000;
/** Horário marcado em cima da hora: sem lembrete se faltar menos disso. */
const MIN_AHEAD_MS = 2 * 3_600_000;
/** O job roda a cada 15 min: o momento de envio que passou há menos disso ainda vale (sai agora). */
const LATE_TOLERANCE_MS = 20 * 60_000;
const ACTIVE = ["agendado", "confirmado"];

const isScheduleSender = (a: { trigger: unknown; actions: unknown }) =>
  (a.trigger as { type?: string } | null)?.type === "agendamento_em_horas"
  && Array.isArray(a.actions) && (a.actions as { type?: string }[]).some((x) => x.type === "enviar_mensagem" || x.type === "enviar_enquete_confirmacao");

/**
 * Liga, desliga ou edita o lembrete do horário. Nunca liga junto com o lembrete ou a enquete das automações: a cliente receberia
 * duas mensagens (a mesma trava de `config.ts`, advisory 7120013). Virada (Task 10): ligar exige o checklist completo (ChatGuru e Avec
 * desligados, texto conferido, teste recebido), um teste de verdade dentro do prazo e `confirmouEnvio` (o aviso de envio real da tela);
 * salvar ligado exige o checklist completo. Desligar nunca pede nada, zera o checklist e o que está na fila cancela na hora de enviar.
 */
export async function saveLembreteD1(input: unknown, userId: string, opts?: { confirmouEnvio?: boolean }): Promise<void> {
  const v = lembreteSchema.parse(input);
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(7120013)`);
    if (v.enabled && (await tx.select().from(automations).where(and(eq(automations.enabled, true), activeAutomationFilter()))).some(isScheduleSender)) {
      throw new UserFacingError("Desligue antes o lembrete ou a enquete de agendamento das Automações: a cliente receberia duas mensagens.");
    }
    const before = await getLembreteD1(tx);
    if (v.enabled) {
      if (!before.enabled) {
        await assertViradaParaLigar(tx, "lembrete", now);
        if (opts?.confirmouEnvio !== true) throw new UserFacingError("Confirme o envio real para ligar.");
      } else await assertViradaPronta(tx, "lembrete");
    }
    await tx.insert(settings).values({ key: "lembrete_d1", value: v }).onConflictDoUpdate({ target: settings.key, set: { value: v, updatedAt: now } });
    await tx.insert(auditLog).values({ userId, action: v.enabled !== before.enabled ? (v.enabled ? "ligou" : "desligou") : "editou", entity: "settings", entityId: "lembrete_d1", data: v });
    if (!v.enabled && before.enabled) await desfazerVirada(tx, "lembrete", userId, now);
  });
}

/**
 * A conversa por onde a mensagem sai: a aberta; sem aberta, a mais recente que não foi arquivada (a cliente já falou com a Casa).
 * Cliente sem nenhuma conversa não recebe: o envio é sempre por uma conversa (criar uma criaria card no funil, decisão de 15/10).
 * Horário de pessoa a mais num número (filha, mãe…, 0051): sai pela conversa do titular, com o nome DELA no texto (`visitText`).
 */
export async function conversationOf(contactId: string | null): Promise<string | null> {
  if (!contactId) return null;
  contactId = await holderIdOf(contactId);
  const [d] = await db.select({ id: deals.id }).from(deals).where(and(eq(deals.contactId, contactId), isNull(deals.archivedAt)))
    .orderBy(sql`${deals.closedAt} is not null`, desc(deals.createdAt)).limit(1);
  return d?.id ?? null;
}

/** Já tem lembrete para esta visita e início? Só conta o que está na fila ou saiu: o cancelado (ex.: lembrete desligado) pode ser refeito. */
const exists = async (source: string) => (await db.select({ id: outbox.id }).from(outbox)
  .where(and(sql`${outbox.options}->>'source' = ${source}`, inArray(outbox.status, ["pending", "sending", "sent"]))).limit(1)).length > 0;

/**
 * Os textos da visita: primeiro nome, data, hora e serviços com as profissionais (e o link, só com `comLink`).
 * `link` dado (inclusive null): usa esse em vez de gerar um novo (o texto refeito na hora de enviar mantém o link de quando entrou na fila).
 */
async function visitText(visitId: string, tpl: string, cfg: LembreteD1, now: Date, link?: string | null): Promise<{ text: string; start: Date; contactId: string | null; firstId: string } | null> {
  const appts = (await visitAppointments(visitId)).filter((a) => ACTIVE.includes(a.status));
  if (!appts.length) return null;
  const start = appts[0].startsAt;
  if (link === undefined) link = cfg.comLink ? (await createClientLink({ appointmentId: appts[0].id, via: "lembrete_d1", actorId: null, now })).url : null;
  // Sem "Não informado" (serviço que o Avec não mandou vira "Atendimento") e sem serviço repetido (duplicata do Avec).
  const seen = new Set<string>();
  const items = appts.map((a) => ({ service: !a.service?.trim() || a.service.trim() === "Não informado" ? "Atendimento" : a.service, pro: onlyFirstName(a.pro) }))
    .filter((i) => { const k = `${i.service.trim().toLowerCase()}|${i.pro ?? ""}`; if (seen.has(k)) return false; seen.add(k); return true; });
  // Fase B: endereço e mapa da Página da cliente (o texto da Casa os usa); sem link do mapa, a busca do endereço no Maps.
  const casa = await getCasaInfo();
  const text = renderReminder(tpl, {
    primeiro_nome: onlyFirstName(appts[0].name) ?? "", data: shortDay(start), hora: hourText(start), servicos: serviceParts(items),
    endereco: casa.endereco ?? "", mapa: casa.mapa ?? (casa.endereco ? mapsLink(casa.endereco) : ""),
  }, link);
  return { text, start, contactId: appts[0].contactId, firstId: appts[0].id };
}

/**
 * Garante o lembrete da visita para o início atual: um só por visita e início (idempotente), 24 h antes na janela 8h–20h.
 * Lembrete pendente de um início antigo é cancelado ("O horário mudou").
 *
 * Só na véspera (17/10): o texto diz "amanhã". Enfileira só se o momento de envio cai na véspera da visita (relógio de Salvador) e ainda
 * não passou (tolerância de {@link LATE_TOLERANCE_MS}, o intervalo do job). Momento já passado não vira "manda agora": antes saía com
 * `notBefore = agora`, a fila fechava às 20h e o lembrete saía às 8h do próprio dia. Horário marcado depois do momento de envio fica
 * sem lembrete. Se a fila não enviar na véspera (worker parado, teto por hora, janela fechada), também não sai: na hora de enviar,
 * `reminderStillValid` cancela fora da véspera ("Já não é a véspera do horário."). Ex.: visita de segunda com a véspera no domingo,
 * dia em que a fila não envia, simplesmente não recebe lembrete. (Desde o 7B o lembrete sai com a Casa fechada, dentro da janela.)
 */
async function ensureReminder(visitId: string, cfg: LembreteD1, now: Date): Promise<"enfileirado" | "ja" | "sem_conversa" | "em_cima" | "fora_da_vespera" | "ja_veio"> {
  const visit = await visitAppointments(visitId);
  // Um lembrete por visita: se ela já chegou (ou foi atendida, ou faltou) num serviço, o "próximo" serviço do dia não ganha lembrete
  // (17/10: a Thamires recebeu às 08:46, já no salão). O pendente da visita sai da fila.
  if (visit.some((a) => VISIT_STARTED.includes(a.status))) {
    await db.update(outbox).set({ status: "cancelled", error: ALREADY_CAME })
      .where(and(eq(outbox.status, "pending"), sql`${outbox.options}->>'source' like ${`${REMINDER_SOURCE}${visitId}:%`}`));
    return "ja_veio";
  }
  const appts = visit.filter((a) => ACTIVE.includes(a.status));
  if (!appts.length) return "ja";
  const start = appts[0].startsAt;
  const source = `${REMINDER_SOURCE}${visitId}:${start.toISOString()}`;
  await db.update(outbox).set({ status: "cancelled", error: "O horário mudou." })
    .where(and(eq(outbox.status, "pending"), sql`${outbox.options}->>'source' like ${`${REMINDER_SOURCE}${visitId}:%`}`, sql`${outbox.options}->>'source' <> ${source}`));
  if (await exists(source)) return "ja";
  if (start.getTime() - now.getTime() < MIN_AHEAD_MS) return "em_cima";
  const sendAt = reminderSendAt(start.getTime());
  if (!isEveOf(sendAt.getTime(), start.getTime()) || sendAt.getTime() < now.getTime() - LATE_TOLERANCE_MS) return "fora_da_vespera";
  const dealId = await conversationOf(appts[0].contactId);
  if (!dealId) return "sem_conversa";
  const t = await visitText(visitId, cfg.texto, cfg, now);
  if (!t) return "ja";
  await enqueueAutomated({ dealId, kind: "text", text: t.text, source, guard: { visitStart: start }, notBefore: sendAt.getTime() > now.getTime() ? sendAt : now });
  return "enfileirado";
}

/** O link da cliente dentro de um texto já enfileirado (`…/c/<código de 8>`). */
const LINK_IN_TEXT = /https?:\/\/\S+\/c\/[2-9A-HJ-NP-Za-km-z]{8}/;

/**
 * Horário da mesma cliente no mesmo dia que ainda não tem visita (o Avec importou depois) entra na visita. Sem isso o texto refeito
 * na hora de enviar não o veria (a visita só junta quem já foi ligado a ela).
 */
async function attachLooseToVisit(visitId: string): Promise<void> {
  const [v] = await db.select({ contactId: visits.contactId, clientName: visits.clientName, day: visits.day }).from(visits).where(eq(visits.id, visitId));
  if (!v) return;
  const from = new Date(slotMs(v.day, "00:00"));
  const [loose] = await db.select({ id: appointments.id }).from(appointments)
    .where(and(v.contactId ? eq(appointments.contactId, v.contactId) : and(isNull(appointments.contactId), eq(appointments.clientName, v.clientName ?? "")),
      isNull(appointments.visitId), isNull(appointments.avecTwinOf), inArray(appointments.status, ACTIVE),
      gte(appointments.startsAt, from), lt(appointments.startsAt, new Date(from.getTime() + 86_400_000)))).limit(1);
  if (loose) await visitIdFor(loose.id); // junta todos os soltos do dia à visita do dia
}

/**
 * O texto do lembrete (ou do remarcado) refeito na hora de enviar, com TODOS os serviços ativos da visita naquele momento e o modelo atual.
 * 17/10: o texto era montado ao enfileirar (até 8 dias antes) e congelava; a Cristiana ganhou "Luzes e Mechas" com Thaise depois e
 * recebeu só "Coloração ou Tonalização com Sidney". Mantém o link do texto enfileirado. null: nada a refazer (quem chama mantém o texto).
 */
export async function reminderTextAtSend(source: string, stored: string, now: Date): Promise<string | null> {
  const cfg = await getLembreteD1();
  const link = stored.match(LINK_IN_TEXT)?.[0] ?? null;
  const idOf = (rest: string) => rest.slice(0, rest.indexOf(":"));
  if (source.startsWith(RESCHEDULED_SOURCE)) {
    const visitId = await visitIdFor(idOf(source.slice(RESCHEDULED_SOURCE.length)));
    await attachLooseToVisit(visitId);
    return (await visitText(visitId, cfg.textoRemarcado, cfg, now, link))?.text ?? null;
  }
  if (!source.startsWith(REMINDER_SOURCE)) return null;
  const visitId = idOf(source.slice(REMINDER_SOURCE.length));
  await attachLooseToVisit(visitId);
  return (await visitText(visitId, cfg.texto, cfg, now, link))?.text ?? null;
}

/**
 * Job `lembrete-d1` (worker, a cada 15 min). Só roda ligado. Pedido do dono (15/10): vale para TODO horário agendado ou confirmado
 * dos próximos dias (não só de quem tem conversa aberta), menos "Não é cliente"; horário do Avec ganha visita na hora; cada visita
 * recebe uma mensagem só, 24 h antes, na janela 8h–20h. Nunca repete.
 */
export async function runLembreteD1(now = new Date()): Promise<{ enqueued: number; skipped: number }> {
  const cfg = await getLembreteD1();
  if (!cfg.enabled) return { enqueued: 0, skipped: 0 };
  const rows = await db.select({ id: appointments.id, visitId: appointments.visitId }).from(appointments)
    .innerJoin(contacts, eq(contacts.id, appointments.contactId))
    .where(and(inArray(appointments.status, ACTIVE), isNull(appointments.avecTwinOf), eq(contacts.ignored, false), sql`not ${genericClientSql(appointments, contacts.name)}`,
      gt(appointments.startsAt, now), lte(appointments.startsAt, new Date(now.getTime() + LOOKAHEAD_MS))))
    .orderBy(asc(appointments.startsAt));
  const seen = new Set<string>();
  let enqueued = 0, skipped = 0;
  for (const r of rows) {
    const visitId = r.visitId ?? (await visitIdFor(r.id));
    if (seen.has(visitId)) continue;
    seen.add(visitId);
    if ((await ensureReminder(visitId, cfg, now)) === "enfileirado") enqueued++; else skipped++;
  }
  return { enqueued, skipped };
}

/**
 * Depois de remarcar (chamado pela porta do 6B, depois do commit): com o lembrete ligado, sai na hora "seu horário foi remarcado para…"
 * e o lembrete de 24 h vai para o horário novo (o antigo é cancelado). Nunca derruba a remarcação: quem chama engole o erro.
 */
export async function afterRescheduleReminder(appointmentId: string, previousStart: Date, now = new Date(), opts: { message?: boolean } = {}): Promise<void> {
  const cfg = await getLembreteD1();
  if (!cfg.enabled) return;
  const [a] = await db.select({ startsAt: appointments.startsAt, status: appointments.status, contactId: appointments.contactId, ignored: contacts.ignored })
    .from(appointments).leftJoin(contacts, eq(contacts.id, appointments.contactId)).where(eq(appointments.id, appointmentId));
  if (!a || !ACTIVE.includes(a.status) || a.ignored || a.startsAt.getTime() === previousStart.getTime() || a.startsAt.getTime() <= now.getTime()) return;
  // O lembrete do início antigo (inclusive o da visita do dia antigo, quando mudou de dia) sai da fila.
  const stale = await db.select({ id: outbox.id, options: outbox.options }).from(outbox)
    .where(and(eq(outbox.status, "pending"), sql`${outbox.options}->>'source' like ${`${REMINDER_SOURCE}%`}`, sql`${outbox.options}->>'visitStart' = ${previousStart.toISOString()}`));
  for (const o of stale) {
    const src = (o.options as { source?: string } | null)?.source;
    if (src && (await reminderStillValid(src, now))) await db.update(outbox).set({ status: "cancelled", error: "O horário mudou." }).where(and(eq(outbox.id, o.id), eq(outbox.status, "pending")));
  }
  const visitId = await visitIdFor(appointmentId);
  const source = `${RESCHEDULED_SOURCE}${appointmentId}:${a.startsAt.toISOString()}`;
  const dealId = await conversationOf(a.contactId);
  // Nova Agenda (16/10): mover arrastando nunca manda mensagem sozinho; com "Avisar a cliente" a tela só PREENCHE a conversa (rescheduledDraft).
  if (opts.message !== false && dealId && !(await exists(source))) {
    const t = await visitText(visitId, cfg.textoRemarcado, cfg, now);
    if (t) await enqueueAutomated({ dealId, kind: "text", text: t.text, source, guard: { visitStart: a.startsAt }, notBefore: now });
  }
  await ensureReminder(visitId, cfg, now);
}

/**
 * "Avisar a cliente" no mover da Agenda: o texto de remarcação (o mesmo do lembrete, sem link) e a conversa por onde ela fala com a Casa.
 * Só devolve: quem envia é a atendente, na conversa. Sem conversa ou sem horário ativo: null.
 */
export async function rescheduledDraft(appointmentId: string, now = new Date()): Promise<{ dealId: string; text: string } | null> {
  const [a] = await db.select({ contactId: appointments.contactId }).from(appointments).where(eq(appointments.id, appointmentId));
  const dealId = await conversationOf(a?.contactId ?? null);
  if (!dealId) return null;
  const cfg = await getLembreteD1();
  const t = await visitText(await visitIdFor(appointmentId), cfg.textoRemarcado, { ...cfg, comLink: false }, now);
  return t ? { dealId, text: t.text } : null;
}
