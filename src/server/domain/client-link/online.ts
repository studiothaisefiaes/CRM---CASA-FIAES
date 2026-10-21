import { createHmac, randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { db } from "../../db";
import { alerts, appointments, auditLog, contacts, lists, professionals, professionalServices, profiles, settings, users, visits } from "../../db/schema";
import { allow } from "../../auth/rate-limit";
import { env } from "../../env";
import { UserFacingError } from "../errors";
import { emit } from "../events";
import { normalizePhone } from "../phone";
import { assertCanBook, getAgendaMode } from "../agenda/mode";
import { lockAgendaTx } from "../agenda/locks";
import { cancelMany, changeStatus, dayRulesPort } from "../agenda/ports";
import { checkStart, freeSlots } from "@/lib/free-slots";
import { MAX_FORM_AGE_MS, MIN_FILL_MS, pickAnyPro, type AnyProCandidate } from "@/lib/online-booking";
import { onlineAlertKey } from "@/lib/alert-links";
import { hmToMinutes, shiftDay, todayBahia } from "@/lib/agenda";
import { slotMs } from "@/lib/schedule";
import { hhmm, minuteIn, timeOf, titleCase } from "@/lib/pro-day";
import { shortDay } from "@/lib/client-link";
import { getOnlineBooking } from "./settings";
import { priceText } from "@/lib/service-price";
import { serviceTermsFor } from "../service-terms";

export const ONLINE_IP_LIMIT = 5;
export const ONLINE_OPEN_PER_PHONE = 2;
/** Consultas de horários por IP em 10 min (página pública /agendar; cada consulta roda o motor por profissional). */
export const ONLINE_SLOTS_IP_LIMIT = 60;
const SLOTS_WINDOW_MS = 10 * 60_000;
const HOUR_MS = 3_600_000;

/** `priceText` (0084): o preço como a cliente vê ("a partir de R$ 150,00", "sob consulta"). O custo do serviço nunca entra aqui. */
export type OnlineOptions = {
  services: { id: string; label: string; durationMin: number; bufferMin: number | null; priceCents: number | null; priceText: string | null }[];
  professionals: { id: string; name: string; serviceIds: string[] }[];
  firstDay: string; lastDay: string;
};
export type OnlineRequestInput = { serviceId: string; professionalId: string | null; day: string; time: string; name: string; phone: string; note: string; honeypot: string; formToken: string };
export type OnlineRequestItem = { visitId: string; client: string; phone: string | null; service: string; professional: string; startsAt: string; note: string | null };

const sign = (t: number) => createHmac("sha256", env().SESSION_SECRET).update(`agendar:${t}`).digest("base64url").slice(0, 22);
/** Carimbo do formulário (anti-robô): quando a página abriu, assinado pelo servidor. */
export const issueFormToken = (now = new Date()) => `${now.getTime()}.${sign(now.getTime())}`;
function formAge(token: string, now: Date): number | null {
  const [t, s] = token.split(".");
  const n = Number(t);
  return Number.isFinite(n) && s === sign(n) ? now.getTime() - n : null;
}

async function stepMin(): Promise<number> {
  const [r] = await db.select({ v: settings.value }).from(settings).where(eq(settings.key, "agenda_regras"));
  const n = Number((r?.v as { passoMin?: unknown } | undefined)?.passoMin);
  return Number.isInteger(n) && n >= 5 ? n : 30;
}

/** O que a página /agendar oferece: os serviços marcados (com duração; sem duração não entra) e as profissionais marcadas. Desligado ou agenda em modo consulta: null (404). */
export async function onlineOptions(now = new Date()): Promise<OnlineOptions | null> {
  const cfg = await getOnlineBooking();
  if (!cfg.enabled || (await getAgendaMode()) === "consulta") return null;
  const services = cfg.servicos.length ? await db.select({ id: lists.id, label: lists.label, durationMin: lists.durationMin, bufferMin: lists.bufferMin, priceCents: lists.priceCents, priceKind: lists.priceKind })
    .from(lists).where(and(inArray(lists.id, cfg.servicos), eq(lists.kind, "service"), eq(lists.active, true))).orderBy(asc(lists.label)) : [];
  const pros = cfg.profissionais.length ? await db.select({ id: professionals.id, name: professionals.name }).from(professionals)
    .where(and(inArray(professionals.id, cfg.profissionais), eq(professionals.active, true))).orderBy(asc(professionals.name)) : [];
  const links = pros.length ? await db.select().from(professionalServices).where(inArray(professionalServices.professionalId, pros.map((p) => p.id))) : [];
  const today = todayBahia(now);
  return {
    services: services.flatMap(({ priceKind, ...s }) => (s.durationMin ? [{ ...s, durationMin: s.durationMin, priceText: priceText(s.priceCents, priceKind) }] : [])),
    professionals: pros.map((p) => ({ id: p.id, name: titleCase(p.name), serviceIds: links.filter((l) => l.professionalId === p.id).map((l) => l.serviceId) })),
    firstDay: today, lastDay: shiftDay(today, cfg.diasAFrente),
  };
}

/**
 * Horários de um dia para o serviço: só "livre" (nada de encaixe ou fora do horário), com a antecedência. "Qualquer uma" junta as profissionais.
 * Com `ip` (a página pública), no máximo `ONLINE_SLOTS_IP_LIMIT` consultas por IP em 10 min.
 */
export async function onlineSlots(input: { serviceId: string; professionalId: string | null; day: string }, now = new Date(), ip?: string): Promise<string[]> {
  if (ip !== undefined && !allow(`agendar-horarios:${ip}`, ONLINE_SLOTS_IP_LIMIT, SLOTS_WINDOW_MS, now.getTime())) throw new UserFacingError("Muitas tentativas. Espere alguns minutos.");
  const opts = await onlineOptions(now);
  const service = opts?.services.find((s) => s.id === input.serviceId);
  if (!opts || !service || input.day < opts.firstDay || input.day > opts.lastDay) return [];
  const cfg = await getOnlineBooking();
  const step = await stepMin();
  const notBeforeMin = input.day === opts.firstDay ? minuteIn(now.getTime()) + cfg.antecedenciaMin : null;
  const times = new Set<number>();
  for (const p of opts.professionals.filter((x) => x.serviceIds.includes(service.id) && (!input.professionalId || x.id === input.professionalId))) {
    // 0084: cada profissional com o tempo dela (o próprio, senão o do serviço).
    const durationMin = (await serviceTermsFor(db, service.id, p.id)).durationMin ?? service.durationMin;
    const r = freeSlots(await dayRulesPort(db, p.id, input.day), { durationMin, bufferMin: service.bufferMin, stepMin: step, notBeforeMin });
    if (r.ok) for (const s of r.slots) if (s.kind === "livre") times.add(s.start);
  }
  return [...times].sort((a, b) => a - b).map(hhmm);
}

/**
 * Pedido pelo site. Vira visita `origin = 'online'` com o horário em `solicitado`, que segura a vaga até a Casa responder, e avisa quem
 * marca na Agenda. Sem código de verificação e sem WhatsApp automático: quem confirma é uma pessoa.
 * Anti-abuso: campo isca, pelo menos 3 s preenchendo, 5 pedidos por IP por hora e no máximo 2 abertos por celular.
 * Contato que já existe nunca tem o nome trocado; contato novo nasce só com nome e celular.
 */
export async function createOnlineRequest(input: OnlineRequestInput, ctx: { ip: string; now?: Date }): Promise<{ message: string }> {
  const now = ctx.now ?? new Date();
  const ok = { message: "Pedido enviado! A Casa vai confirmar pelo WhatsApp." };
  const opts = await onlineOptions(now);
  if (!opts) throw new UserFacingError("O agendamento online está desligado.");
  if (input.honeypot.trim()) return ok; // robô: parece que deu certo, e nada é gravado
  const age = formAge(input.formToken, now);
  if (age === null || age > MAX_FORM_AGE_MS) throw new UserFacingError("A página ficou aberta muito tempo. Atualize e tente de novo.");
  if (age < MIN_FILL_MS) throw new UserFacingError("Confira os dados e toque em Pedir horário de novo.");
  if (!allow(`agendar:${ctx.ip}`, ONLINE_IP_LIMIT, HOUR_MS, now.getTime())) throw new UserFacingError("Muitos pedidos. Tente de novo mais tarde ou fale com a Casa pelo WhatsApp.");
  const name = input.name.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 80) throw new UserFacingError("Escreva seu nome.");
  const phone = normalizePhone(input.phone);
  if (!phone) throw new UserFacingError("Celular inválido. Use DDD + número, ex.: 71 99999-9999");
  const service = opts.services.find((s) => s.id === input.serviceId);
  if (!service) throw new UserFacingError("Escolha um serviço da lista.");
  if (input.day < opts.firstDay || input.day > opts.lastDay) throw new UserFacingError("Escolha um dia da lista.");
  const startMin = hmToMinutes(input.time);
  if (startMin == null) throw new UserFacingError("Escolha um horário da lista.");
  const candidates = opts.professionals.filter((p) => p.serviceIds.includes(service.id) && (!input.professionalId || p.id === input.professionalId));
  if (!candidates.length) throw new UserFacingError("Escolha uma profissional da lista.");
  const note = input.note.trim().slice(0, 300) || null;
  const cfg = await getOnlineBooking();
  const step = await stepMin();
  const notBeforeMin = input.day === opts.firstDay ? minuteIn(now.getTime()) + cfg.antecedenciaMin : null;
  const startsAt = new Date(slotMs(input.day, "00:00") + startMin * 60_000);
  const positions = new Map((await db.select({ id: professionals.id, pos: professionals.agendaPosition }).from(professionals)
    .where(inArray(professionals.id, candidates.map((c) => c.id)))).map((r) => [r.id, r.pos]));
  const visitId = await db.transaction(async (tx) => {
    await tx.insert(contacts).values({ phoneE164: phone, name }).onConflictDoNothing({ target: contacts.phoneE164 });
    const [c] = await tx.select({ id: contacts.id }).from(contacts).where(eq(contacts.phoneE164, phone));
    const [{ n }] = (await tx.execute(sql`select count(*)::int as n from appointments a join visits v on v.id = a.visit_id
      where a.contact_id = ${c.id} and a.status = 'solicitado' and v.origin = 'online' and a.starts_at > ${now.toISOString()}::timestamptz`)).rows as { n: number }[];
    if (n >= ONLINE_OPEN_PER_PHONE) throw new UserFacingError("Você já tem 2 pedidos esperando a Casa responder. Aguarde a resposta ou fale com a Casa pelo WhatsApp.");
    await lockAgendaTx(tx, { professionalIds: candidates.map((p) => p.id).sort(), contactId: c.id, days: [input.day] });
    const free: AnyProCandidate[] = [];
    const termsOf = new Map<string, { durationMin: number; priceCents: number | null }>();
    for (const p of candidates) {
      const t = await serviceTermsFor(tx, service.id, p.id);
      const durationMin = t.durationMin ?? service.durationMin;
      termsOf.set(p.id, { durationMin, priceCents: t.priceCents });
      const rules = await dayRulesPort(tx, p.id, input.day);
      const chk = checkStart(rules, startMin, { durationMin, bufferMin: service.bufferMin, stepMin: step, notBeforeMin, clientId: c.id });
      if (chk.ok && chk.kind === "livre") free.push({ id: p.id, name: p.name, agendaPosition: positions.get(p.id) ?? null, dayCount: rules.busy.length });
    }
    const professionalId = pickAnyPro(free);
    if (!professionalId) throw new UserFacingError("Esse horário acabou de ser ocupado. Escolha outro.");
    const [v] = await tx.insert(visits).values({ contactId: c.id, clientName: name, day: input.day, origin: "online", notes: note }).returning({ id: visits.id });
    const id = randomUUID();
    await tx.insert(appointments).values({
      id, externalKey: `crm:${id}`, origin: "crm", status: "solicitado", visitId: v.id, contactId: c.id, clientName: name, professionalId,
      serviceId: service.id, serviceLabel: service.label, startsAt, durationMin: termsOf.get(professionalId)!.durationMin, bufferMin: service.bufferMin, priceCents: termsOf.get(professionalId)!.priceCents, notes: note,
    });
    await tx.insert(auditLog).values({ userId: null, action: "pedido_online", entity: "visit", entityId: v.id, data: { servico: service.label, dia: input.day, hora: input.time } });
    const team = await tx.select({ id: users.id }).from(users).innerJoin(profiles, eq(profiles.id, users.profileId))
      .where(and(eq(users.active, true), sql`${profiles.permissions} @> array['agenda.marcar']::text[]`));
    const message = `${name.split(" ")[0]} pediu ${service.label} em ${shortDay(startsAt)} às ${timeOf(startsAt.getTime())} pelo site. Confirme ou recuse na Agenda.`;
    for (const u of team) await tx.insert(alerts).values({ userId: u.id, audience: "responsavel", type: "pedido_online", severity: "info", message, dedupeKey: onlineAlertKey(v.id, u.id) }).onConflictDoNothing();
    return v.id;
  });
  await emit("agenda_alterada", { day: input.day, visitId });
  await emit("alerta", {});
  return ok;
}

/** A recepção responde (`agenda.marcar`). Confirmar vira "agendado" pela porta do 6B (segue o modo da agenda e avisa a profissional); recusar cancela com o motivo "recusado". */
export async function decideOnlineRequest(visitId: string, decision: "confirmar" | "recusar", actorId: string, now = new Date(), motivo?: string | null): Promise<void> {
  // QA r58, I-6: recusar pede confirmação e o motivo (fica na nota do cancelamento).
  const note = motivo?.trim().replace(/\s+/g, " ").slice(0, 300) || null;
  if (decision === "recusar" && !note) throw new UserFacingError("Escreva o motivo da recusa.");
  const rows = await db.select({ id: appointments.id }).from(appointments).where(and(eq(appointments.visitId, visitId), eq(appointments.status, "solicitado")));
  if (!rows.length) throw new UserFacingError("Esse pedido já foi respondido.");
  if (decision === "confirmar") {
    await assertCanBook();
    for (const r of rows) await changeStatus({ appointmentId: r.id, status: "agendado", actorId, via: "recepcao", now });
  } else {
    await cancelMany({ appointmentIds: rows.map((r) => r.id), reason: "recusado", note, actorId, via: "recepcao", now });
  }
  await db.update(alerts).set({ resolvedAt: now, readAt: now }).where(and(sql`${alerts.dedupeKey} like ${`online:${visitId}:%`}`, isNull(alerts.resolvedAt)));
  await emit("alerta", {});
}

/** Worker: pedido sem resposta até o início é cancelado sozinho ("recusado", nota "a Casa não respondeu a tempo"). */
export async function expireOnlineRequests(now = new Date()): Promise<{ cancelled: number }> {
  const rows = await db.select({ id: appointments.id }).from(appointments).innerJoin(visits, eq(visits.id, appointments.visitId))
    .where(and(eq(appointments.status, "solicitado"), eq(visits.origin, "online"), lte(appointments.startsAt, now)));
  if (!rows.length) return { cancelled: 0 };
  return cancelMany({ appointmentIds: rows.map((r) => r.id), reason: "recusado", note: "a Casa não respondeu a tempo", actorId: null, via: "recepcao", now });
}

/** "Pedidos do site" da Agenda: os pedidos esperando resposta, do mais perto para o mais longe. */
export async function listOnlineRequests(): Promise<OnlineRequestItem[]> {
  const rows = await db.select({ visitId: visits.id, client: visits.clientName, phone: contacts.phoneE164, service: appointments.serviceLabel, pro: professionals.name, startsAt: appointments.startsAt, note: visits.notes })
    .from(appointments).innerJoin(visits, eq(visits.id, appointments.visitId)).leftJoin(contacts, eq(contacts.id, appointments.contactId))
    .leftJoin(professionals, eq(professionals.id, appointments.professionalId))
    .where(and(eq(appointments.status, "solicitado"), eq(visits.origin, "online"))).orderBy(asc(appointments.startsAt));
  return rows.map((r) => ({ visitId: r.visitId, client: r.client ?? "Cliente", phone: r.phone, service: r.service, professional: r.pro ? titleCase(r.pro) : "Qualquer uma", startsAt: r.startsAt.toISOString(), note: r.note }));
}
