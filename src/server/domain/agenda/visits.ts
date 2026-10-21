import { genericClientSql } from "@/lib/generic-client";
import { randomUUID } from "node:crypto";
import { and, asc, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type Tx } from "../../db";
import { appointments, auditLog, contacts, deals, lists, professionals, professionalServices, visits } from "../../db/schema";
import { UserFacingError } from "../errors";
import { normalizePhone } from "../phone";
import { assertProfessionalFor } from "../professionals";
import { normText } from "../avec/normalize";
import { dayOf, instantOf, minuteOfDay } from "@/lib/agenda";
import { ACTIVE_STATUSES, CANCEL_REASONS, checkCancel } from "@/lib/appointment-status";
import { conflictText, justTakenText, refusalText } from "@/lib/agenda-text";
import { firstName } from "@/lib/authorship";
import { can } from "@/lib/permissions";
import { assertCanBook } from "./mode";
import { lockAgendaTx } from "./locks";
import { checkSlotTx, proDayCounts, prosForService, type SlotCheckResult } from "./slots";
import { hhmm, pickAny, type SlotKind } from "@/lib/free-slots";
import { agendaFunnelTx } from "./funnel-hook";
import { afterAgendaChange } from "./notify";
import { canFitIn, type Actor } from "./actor";
import { PREFERENCES } from "@/lib/appointment-preference";
import { assertNotPaidTx, dropOpenItemsTx } from "../caixa/agenda-hooks";
import { queueProNotificationsTx } from "../pro/notifications";
import { holderIdOf } from "../people-on-number";
import { assertFuncao, isFuncaoOn } from "../funcoes";
import { serviceTermsFor } from "../service-terms";
import { assertCanSetMarker, assertLabelUsable, assertVisitTypeUsable } from "./labels";
import { VISIT_TYPES } from "@/lib/visit-type";
import { assertNoSelfOverlap, auxiliariesSchema, auxiliaryIdsTx, checkAuxiliariesTx, saveAuxiliariesTx, validateAuxiliariesTx, type AuxPro } from "./appointment-assistants";

/**
 * Marcar, remarcar e cancelar na Agenda (Lote 6B). Cada função é uma porta só, numa transação (6.4, regra 1): confere o modo,
 * trava a agenda, relê o banco e roda o motor, grava e audita, chama o gancho do funil e, depois do commit, avisa as telas.
 */
export const MAX_ITEMS = 4;
export const DURATION_STEP = 5;
export const DURATION_MAX = 720;
/** Conflito criado há menos disso: "Esse horário acabou de ser ocupado". */
export const JUST_TAKEN_MS = 2 * 60_000;

export type ClientRef = { contactId: string } | { name: string; phone: string };
const itemSchema = z.object({
  serviceId: z.string().uuid("Escolha o serviço."),
  professionalId: z.string().uuid().nullable(),
  durationMin: z.number().int().nullable().optional(),
  saveDuration: z.boolean().optional(),
  linkService: z.boolean().optional(),
  mode: z.enum(["depois", "junto"]).optional(),
  preference: z.enum(PREFERENCES).nullable().optional(),
  /** 0089: as auxiliares deste serviço, na ordem (ocupam a agenda delas no mesmo período). */
  assistantIds: auxiliariesSchema.optional(),
});
export const createVisitSchema = z.object({
  requestKey: z.string().uuid(),
  client: z.custom<ClientRef>((v) => !!v && typeof v === "object", "Escolha a cliente."),
  dealId: z.string().uuid().nullable().optional(),
  startsAt: z.string().datetime({ offset: true, message: "Escolha o dia e a hora." }),
  items: z.array(itemSchema).min(1, "Escolha o serviço.").max(MAX_ITEMS, `Até ${MAX_ITEMS} serviços por visita.`),
  notes: z.string().trim().max(1000, "Use até 1000 caracteres na observação.").nullable().optional(),
  fitIn: z.boolean().optional(),
  walkIn: z.boolean().optional(),
  /** Fase C (0080): marcador e tipo do horário, gravados em todos os horários da visita. */
  labelId: z.string().uuid().nullable().optional(),
  visitType: z.enum(VISIT_TYPES).nullable().optional(),
});
export type BookingItemInput = z.input<typeof itemSchema>;
export type CreateVisitInput = z.input<typeof createVisitSchema>;
export type CreateVisitResult = { visitId: string; appointmentIds: string[]; day: string; reused: boolean };

/** Já existe o mesmo horário (mesma cliente, início e serviço): a tela oferece "Abrir o horário". */
export class ExistingAppointmentError extends UserFacingError {
  constructor(message: string, readonly appointmentId: string, readonly day: string) { super(message); }
}

/** A cliente do horário: pelo contato, ou pelo telefone (nunca duplica, nunca troca o nome). Quem estava como "Não é cliente" volta a ser cliente. */
export async function resolveClientTx(tx: Tx, ref: ClientRef): Promise<{ id: string; name: string | null }> {
  if ("contactId" in ref && ref.contactId) {
    const [c] = await tx.update(contacts).set({ ignored: false }).where(eq(contacts.id, z.string().uuid().parse(ref.contactId))).returning({ id: contacts.id, name: contacts.name });
    if (!c) throw new UserFacingError("Cliente não encontrada.");
    return c;
  }
  const name = ("name" in ref ? ref.name : "").trim().replace(/\s+/g, " ");
  if (!name) throw new UserFacingError("Escreva o nome da cliente.");
  if (name.length > 120) throw new UserFacingError("Use até 120 caracteres no nome.");
  const phone = normalizePhone("phone" in ref ? ref.phone : "");
  if (!phone) throw new UserFacingError("Celular inválido. Use DDD + número, ex.: 71 99999-9999");
  const [c] = await tx.insert(contacts).values({ phoneE164: phone, name })
    .onConflictDoUpdate({ target: contacts.phoneE164, set: { ignored: false, name: sql`coalesce(${contacts.name}, excluded.name)` } })
    .returning({ id: contacts.id, name: contacts.name });
  return c;
}

type Svc = { id: string; label: string; durationMin: number | null; bufferMin: number | null; priceCents: number | null; parallelOk: boolean | null };
/**
 * Um serviço da visita já planejado. `durationMin` e `priceCents`: os da profissional escolhida (0084: o próprio dela, senão o do serviço);
 * no "Qualquer uma", os do serviço até a escolha, e então os de quem foi escolhida (o início dos seguintes anda junto).
 */
type Planned = { service: Svc; professionalId: string | null; durationMin: number; priceCents: number | null; start: Date; mode: "depois" | "junto";
  /** A duração foi digitada na folha (vale para quem for escolhida no "Qualquer uma"). */ fixedDuration: boolean; aux: AuxPro[] };

/** Recalcula os inícios a partir do item `from` ("logo depois" começa no fim da duração do anterior; "ao mesmo tempo", junto). */
function chainStarts(planned: Planned[], from: number) {
  for (let j = Math.max(1, from); j < planned.length; j++) {
    const prev = planned[j - 1], p = planned[j];
    p.start = p.mode === "junto" ? prev.start : new Date(prev.start.getTime() + prev.durationMin * 60_000);
  }
}

async function planItems(tx: Tx, input: z.output<typeof createVisitSchema>, actor: Actor): Promise<Planned[]> {
  const ids = [...new Set(input.items.map((i) => i.serviceId))];
  const rows = await tx.select({ id: lists.id, label: lists.label, durationMin: lists.durationMin, bufferMin: lists.bufferMin, priceCents: lists.priceCents, parallelOk: lists.parallelOk, active: lists.active })
    .from(lists).where(and(inArray(lists.id, ids), eq(lists.kind, "service")));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const parallelOn = await isFuncaoOn("junto_com_outro", tx);
  const out: Planned[] = [];
  for (const [k, it] of input.items.entries()) {
    const s = byId.get(it.serviceId);
    if (!s?.active) throw new UserFacingError("Esse serviço não está mais na lista. Escolha outro.");
    // 0084: com a profissional escolhida, o preço e o tempo dela (sem eles, os do serviço).
    const terms = it.professionalId ? await serviceTermsFor(tx, s.id, it.professionalId) : null;
    let durationMin = terms ? terms.durationMin : s.durationMin;
    // 20/10: a duração digitada na folha vale desta vez (o padrão é o da profissional, senão o do serviço).
    const typed = it.durationMin ?? null;
    if (typed != null || durationMin == null) {
      const d = typed;
      if (d == null) throw new UserFacingError(refusalText("sem_duracao", { proName: "", serviceLabel: s.label }));
      if (d < DURATION_STEP || d > DURATION_MAX || d % DURATION_STEP) throw new UserFacingError(refusalText("duracao_invalida", { proName: "", serviceLabel: s.label }));
      if (it.saveDuration && can(actor.perms, "config.diaadia") && d !== durationMin) await saveDurationTx(tx, s, it.professionalId, d, actor);
      durationMin = d;
    }
    const prev = out[k - 1];
    const mode = k === 0 ? "depois" : it.mode ?? "depois";
    if (prev && mode === "junto" && it.professionalId && it.professionalId === prev.professionalId) throw new UserFacingError("Ao mesmo tempo, as profissionais precisam ser diferentes.");
    // 0084: serviço marcado "não pode ser feito junto com outro" recusa o "Ao mesmo tempo" (vazio = como antes; função desligada = como antes).
    const alone = prev && mode === "junto" && parallelOn ? [s, prev.service].find((x) => x.parallelOk === false) : undefined;
    if (alone) throw new UserFacingError(`O serviço ${alone.label} não pode ser feito ao mesmo tempo que outro serviço.`);
    const start = !prev ? new Date(input.startsAt) : mode === "junto" ? prev.start : new Date(prev.start.getTime() + prev.durationMin * 60_000);
    if (it.professionalId) {
      if (it.linkService && can(actor.perms, "config.diaadia")) {
        await tx.insert(professionalServices).values({ professionalId: it.professionalId, serviceId: s.id, source: "manual", createdBy: actor.id }).onConflictDoNothing();
      }
      await assertProfessionalFor(tx, it.professionalId, s.id);
    }
    const aux = await validateAuxiliariesTx(tx, it.assistantIds ?? [], it.professionalId);
    out.push({ service: s, professionalId: it.professionalId, durationMin, priceCents: terms ? terms.priceCents : s.priceCents, start, mode, fixedDuration: typed != null, aux });
  }
  if (out.some((p) => dayOf(p.start) !== dayOf(out[0].start))) throw new UserFacingError("Todos os serviços da visita precisam ser no mesmo dia.");
  return out;
}

/**
 * "Guardar como padrão" (20/10). Serviço sem duração cadastrada: vira a duração do serviço (como no Lote 4). Com duração no serviço, a
 * profissional escolhida e a função "Preço e tempo por profissional" ligada: vira o tempo próprio dela neste serviço (Serviços › Quem faz);
 * senão, a duração do serviço. Audita como a tela de Configurações.
 */
async function saveDurationTx(tx: Tx, s: Svc, professionalId: string | null, d: number, actor: Actor) {
  if (s.durationMin != null && professionalId && (await isFuncaoOn("preco_por_profissional", tx))) {
    await tx.insert(professionalServices).values({ professionalId, serviceId: s.id, source: "manual", createdBy: actor.id, durationMin: d })
      .onConflictDoUpdate({ target: [professionalServices.professionalId, professionalServices.serviceId], set: { durationMin: d } });
    await tx.insert(auditLog).values({ userId: actor.id, action: "editou", entity: "professional_service", entityId: professionalId, data: { servico: s.label, serviceId: s.id, durationMin: d, origem: "agenda" } });
    return;
  }
  await tx.update(lists).set({ durationMin: d }).where(eq(lists.id, s.id));
  await tx.insert(auditLog).values({ userId: actor.id, action: "editou", entity: "list", entityId: s.id, data: { label: s.label, durationMin: d, origem: "agenda" } });
}

/**
 * O que fazer com o resultado do motor: recusa (com o texto do conflito ou da regra), ou aceita. Conflito e fora do horário só passam
 * com "Encaixar mesmo assim" (`fitIn`) E a permissão `agenda.encaixar` (6.4, regra 3); quem acabou de ocupar aparece pelo nome.
 */
export function decideBooking(check: SlotCheckResult, ctx: { proName: string; serviceLabel: string; fitIn: boolean; actor: Actor; now: Date }): { fitIn: boolean; outsideHours: boolean } {
  if (!check.ok) {
    const c = check.conflicts[0];
    throw new UserFacingError(check.reason === "conflito" && c ? conflictText(ctx.proName, c) : refusalText(check.reason, { proName: ctx.proName, serviceLabel: ctx.serviceLabel, blockedBy: check.blockedBy }));
  }
  if ((check.fitIn || check.outsideHours) && !(ctx.fitIn && canFitIn(ctx.actor))) {
    const c = check.conflicts[0];
    if (c) {
      const age = c.createdAt ? ctx.now.getTime() - new Date(c.createdAt).getTime() : Infinity;
      throw new UserFacingError(c.createdByName && age >= 0 && age <= JUST_TAKEN_MS ? justTakenText(c) : conflictText(ctx.proName, c));
    }
    throw new UserFacingError(refusalText("fora_do_horario", { proName: ctx.proName, serviceLabel: ctx.serviceLabel }));
  }
  return { fitIn: check.fitIn, outsideHours: check.outsideHours };
}

/** 6.6, última linha: o mesmo horário (cliente, início e serviço) que já existe não é criado de novo. */
async function assertNotDuplicateTx(tx: Tx, contactId: string, items: Planned[]) {
  for (const p of items) {
    const same = await tx.select({ id: appointments.id, origin: appointments.origin, serviceId: appointments.serviceId, serviceLabel: appointments.serviceLabel, clientName: appointments.clientName, contactName: contacts.name })
      .from(appointments).leftJoin(contacts, eq(contacts.id, appointments.contactId))
      .where(and(eq(appointments.contactId, contactId), eq(appointments.startsAt, p.start), isNull(appointments.avecTwinOf), inArray(appointments.status, [...ACTIVE_STATUSES, "compareceu"])));
    const dup = same.find((a) => (a.serviceId ? a.serviceId === p.service.id : normText(a.serviceLabel) === normText(p.service.label)));
    if (dup) {
      const who = firstName(dup.contactName ?? dup.clientName) ?? "A cliente";
      throw new ExistingAppointmentError(`${who} já tem ${p.service.label} às ${hhmm(minuteOfDay(p.start))}${dup.origin === "avec" ? " (veio do Avec)" : ""}. Abrir o horário`, dup.id, dayOf(p.start));
    }
  }
}

/**
 * "Qualquer uma": a primeira livre (sem encaixe, no horário de trabalho) na ordem da regra 9. `exclude` = a do serviço "ao mesmo tempo".
 * 0084: cada candidata é conferida com o tempo dela (o próprio, senão o do serviço) e volta com o tempo e o preço de quem foi escolhida.
 */
async function pickAnyPro(tx: Tx, p: Planned, clientId: string, now: Date, cands: { id: string; name: string; position: number | null }[], exclude: readonly string[]): Promise<{ id: string; durationMin: number; priceCents: number | null }> {
  if (!cands.length) throw new UserFacingError(`Ninguém está marcado para fazer ${p.service.label}. Marque em Configurações › Profissionais.`);
  const counts = await proDayCounts(tx, cands.map((c) => c.id), dayOf(p.start));
  const scored = [];
  const termsOf = new Map<string, { durationMin: number; priceCents: number | null }>();
  for (const c of cands.filter((x) => !exclude.includes(x.id))) {
    const t = await serviceTermsFor(tx, p.service.id, c.id);
    const durationMin = p.fixedDuration ? p.durationMin : t.durationMin ?? p.durationMin; // digitado na folha vence; sem tempo no serviço nem dela, também
    termsOf.set(c.id, { durationMin, priceCents: t.priceCents });
    const check = await checkSlotTx(tx, { professionalId: c.id, startsAt: p.start, durationMin, bufferMin: p.service.bufferMin, clientId, now, parallelOk: p.service.parallelOk });
    const kind: SlotKind | null = check.ok ? (check.outsideHours ? "fora_do_horario" : check.fitIn ? "encaixe" : "livre") : null;
    scored.push({ ...c, dayCount: counts.get(c.id) ?? 0, kind });
  }
  const id = pickAny(scored); // a regra do 6A: só as livres; menos horários no dia, depois a ordem da agenda, depois o nome
  if (id) return { id, ...termsOf.get(id)! };
  throw new UserFacingError(`Ninguém que faz ${p.service.label} está livre às ${hhmm(minuteOfDay(p.start))}. Escolha a profissional para encaixar.`);
}

export async function createVisitTx(tx: Tx, raw: CreateVisitInput, actor: Actor, now: Date): Promise<CreateVisitResult & { dealIds: string[] }> {
  const input = createVisitSchema.parse(raw);
  if (input.items.some((it) => it.preference === "escolhida" && !it.professionalId)) throw new UserFacingError("Escolha a profissional que ela pediu.");
  await assertCanBook(tx);
  // Marcador e tipo: função ligada, permissão agenda.marcador e valor em uso (esconder na tela não basta).
  if (input.labelId) { await assertFuncao("marcadores", tx); assertCanSetMarker(actor); await assertLabelUsable(input.labelId, tx); }
  if (input.visitType) { await assertFuncao("tipo_horario", tx); assertCanSetMarker(actor); await assertVisitTypeUsable(input.visitType, tx); }
  const client = await resolveClientTx(tx, input.client);
  if (input.dealId) {
    const [d] = await tx.select({ contactId: deals.contactId }).from(deals).where(eq(deals.id, input.dealId));
    // A conversa é do titular do número; o horário pode ser de outra pessoa dele (filha, mãe…, 0051).
    if (!d || (d.contactId !== client.id && d.contactId !== (await holderIdOf(client.id, tx)))) throw new UserFacingError("Conversa não encontrada para essa cliente.");
  }
  const planned = await planItems(tx, input, actor);
  const day = dayOf(planned[0].start);
  const candidates = new Map<number, { id: string; name: string; position: number | null }[]>();
  for (const [k, p] of planned.entries()) if (!p.professionalId) candidates.set(k, await prosForService(tx, p.service.id));
  // 6.4, passos 2 e 3: trava (profissionais, candidatas do "Qualquer uma" e a cliente, no dia) e só então relê o banco.
  await lockAgendaTx(tx, { professionalIds: [...planned.map((p) => p.professionalId), ...[...candidates.values()].flat().map((c) => c.id), ...planned.flatMap((p) => p.aux.map((a) => a.id))], contactId: client.id, days: [day] });
  const [again] = await tx.select({ id: visits.id }).from(visits).where(eq(visits.requestKey, input.requestKey));
  if (again) {
    const ids = await tx.select({ id: appointments.id }).from(appointments).where(eq(appointments.visitId, again.id)).orderBy(asc(appointments.startsAt));
    return { visitId: again.id, appointmentIds: ids.map((r) => r.id), day, reused: true, dealIds: [] };
  }
  // O mesmo formulário de novo, quando ele entrou numa visita que já existia (a chave do pedido fica na auditoria de cada horário).
  const prior = await tx.select({ id: auditLog.entityId, visitId: sql<string>`${auditLog.data}->>'visitId'` }).from(auditLog)
    .where(and(eq(auditLog.action, "agendamento_marcado"), sql`${auditLog.data}->>'pedido' = ${input.requestKey}`)).orderBy(asc(auditLog.createdAt));
  if (prior.length) return { visitId: prior[0].visitId, appointmentIds: prior.map((r) => r.id!), day, reused: true, dealIds: [] };
  await assertNotDuplicateTx(tx, client.id, planned);
  const explicit = planned.map((p) => p.professionalId).filter((x): x is string => !!x);
  const names = new Map(explicit.length ? (await tx.select({ id: professionals.id, name: professionals.name }).from(professionals).where(inArray(professionals.id, explicit))).map((p) => [p.id, p.name]) : []);
  const decided: { professionalId: string; fitIn: boolean; outsideHours: boolean }[] = [];
  const plannedStarts = planned.map((p) => p.start.getTime());
  for (const [k, p] of planned.entries()) {
    if (!p.professionalId) {
      // A do serviço "ao mesmo tempo" e as auxiliares deste serviço não são escolhidas para atender.
      const exclude = [...(p.mode === "junto" && decided[k - 1] ? [decided[k - 1].professionalId] : []), ...p.aux.map((a) => a.id)];
      const pick = await pickAnyPro(tx, p, client.id, now, candidates.get(k) ?? [], exclude);
      // 0084: o tempo e o preço de quem foi escolhida; os serviços seguintes andam junto.
      p.durationMin = pick.durationMin;
      p.priceCents = pick.priceCents;
      chainStarts(planned, k + 1);
      decided.push({ professionalId: pick.id, fitIn: false, outsideHours: false });
      continue;
    }
    const check = await checkSlotTx(tx, { professionalId: p.professionalId, startsAt: p.start, durationMin: p.durationMin, bufferMin: p.service.bufferMin, clientId: client.id, now, parallelOk: p.service.parallelOk });
    decided.push({ professionalId: p.professionalId, ...decideBooking(check, { proName: names.get(p.professionalId) ?? "A profissional", serviceLabel: p.service.label, fitIn: !!input.fitIn, actor, now }) });
  }
  if (planned.some((p, k) => p.start.getTime() !== plannedStarts[k])) {
    if (planned.some((p) => dayOf(p.start) !== day)) throw new UserFacingError("Todos os serviços da visita precisam ser no mesmo dia.");
    await assertNotDuplicateTx(tx, client.id, planned);
  }
  // 0089: as auxiliares, com o período final de cada serviço (depois do "Qualquer uma"). Ninguém em dois serviços que se cruzam na visita.
  if (planned.some((p) => p.aux.length)) {
    const mainNames = new Map((await tx.select({ id: professionals.id, name: professionals.name }).from(professionals).where(inArray(professionals.id, decided.map((d) => d.professionalId)))).map((p) => [p.id, p.name]));
    assertNoSelfOverlap(planned.map((p, k) => ({ start: p.start, durationMin: p.durationMin, people: [{ id: decided[k].professionalId, name: mainNames.get(decided[k].professionalId) ?? "A profissional" }, ...p.aux] })));
    for (const [k, p] of planned.entries()) {
      if (!p.aux.length) continue;
      const r = await checkAuxiliariesTx(tx, p.aux, { startsAt: p.start, durationMin: p.durationMin, bufferMin: p.service.bufferMin, parallelOk: p.service.parallelOk, fitIn: !!input.fitIn, actor, now },
        (check, proName) => decideBooking(check, { proName, serviceLabel: p.service.label, fitIn: !!input.fitIn, actor, now }));
      if (r.fitIn) decided[k].fitIn = true;
    }
  }
  // 17/10: a cliente que já tem visita no dia (outro Marcar, ou a reserva do Avec) ganha o serviço na mesma visita: uma comanda, um lembrete.
  const [existing] = await tx.select({ id: visits.id }).from(visits).where(and(eq(visits.contactId, client.id), eq(visits.day, day))).orderBy(asc(visits.createdAt)).limit(1);
  const visitId = existing?.id ?? randomUUID();
  if (!existing) await tx.insert(visits).values({ id: visitId, contactId: client.id, clientName: client.name, day, dealId: input.dealId ?? null, origin: "crm", requestKey: input.requestKey, createdBy: actor.id, createdAt: now, updatedAt: now });
  const appointmentIds: string[] = [];
  for (const [k, p] of planned.entries()) {
    const id = randomUUID();
    const d = decided[k];
    await tx.insert(appointments).values({
      id, externalKey: `crm:${id}`, origin: "crm", visitId, contactId: client.id, clientName: client.name, professionalId: d.professionalId,
      serviceId: p.service.id, serviceLabel: p.service.label, startsAt: p.start, durationMin: p.durationMin, bufferMin: p.service.bufferMin, priceCents: p.priceCents,
      status: input.walkIn ? "chegou" : "agendado", arrivedAt: input.walkIn ? now : null, notes: input.notes || null,
      fitIn: d.fitIn, fitInBy: d.fitIn ? actor.id : null, outsideHours: d.outsideHours, anyPro: !p.professionalId,
      preference: input.items[k]?.preference ?? null, labelId: input.labelId ?? null, visitType: input.visitType ?? null,
      createdBy: actor.id, updatedBy: actor.id, crmTouchedAt: now, createdAt: now, updatedAt: now,
    });
    if (p.aux.length) await saveAuxiliariesTx(tx, id, p.aux.map((a) => a.id), actor.id, now);
    await tx.insert(auditLog).values({ userId: actor.id, action: "agendamento_marcado", entity: "appointment", entityId: id, createdAt: now,
      data: { visitId, pedido: input.requestKey, inicio: p.start.toISOString(), profissional: d.professionalId, servico: p.service.label, encaixe: d.fitIn, foraDoHorario: d.outsideHours, qualquerUma: !p.professionalId, chegou: !!input.walkIn, preferencia: input.items[k]?.preference ?? null, marcador: input.labelId ?? null, tipo: input.visitType ?? null,
        ...(p.aux.length ? { auxiliares: p.aux.map((a) => a.id), duracao: p.durationMin } : p.fixedDuration ? { duracao: p.durationMin } : {}) } });
    await queueProNotificationsTx(tx, { kind: "novo", appointment: { id, professionalId: d.professionalId, startsAt: p.start, status: input.walkIn ? "chegou" : "agendado", clientName: client.name, serviceLabel: p.service.label } }, { actorId: actor.id, via: "recepcao", now });
    appointmentIds.push(id);
  }
  const dealIds = await agendaFunnelTx(tx, [client.id], now);
  return { visitId, appointmentIds, day, reused: false, dealIds };
}

/** Marcar (6.1): uma visita com um ou mais serviços. Mandar o mesmo formulário duas vezes devolve a mesma visita. */
export async function createVisit(raw: CreateVisitInput, actor: Actor, now = new Date()): Promise<CreateVisitResult> {
  const r = await db.transaction((tx) => createVisitTx(tx, raw, actor, now));
  if (!r.reused) await afterAgendaChange([r.day], r.dealIds);
  return { visitId: r.visitId, appointmentIds: r.appointmentIds, day: r.day, reused: r.reused };
}

/* ───────────── Remarcar ───────────── */

export const rescheduleSchema = z.object({
  startsAt: z.string().datetime({ offset: true, message: "Escolha o dia e a hora." }),
  professionalId: z.string().uuid().optional(),
  durationMin: z.number().int().nullable().optional(),
  fitIn: z.boolean().optional(),
  confirmProChange: z.boolean().optional(),
  /** 0089: as auxiliares do horário depois de remarcar; ausente = as mesmas (vão junto). */
  assistantIds: auxiliariesSchema.optional(),
});
export type RescheduleInput = z.input<typeof rescheduleSchema>;

/** A visita da cliente naquele dia (a primeira que existir), ou uma nova. */
export async function visitForDayTx(tx: Tx, ref: { contactId: string | null; clientName: string | null }, day: string, actorId: string | null, now: Date, origin: "crm" | "avec" = "crm"): Promise<string> {
  const same = ref.contactId ? eq(visits.contactId, ref.contactId) : and(isNull(visits.contactId), eq(visits.clientName, ref.clientName ?? ""));
  const [v] = await tx.select({ id: visits.id }).from(visits).where(and(same, eq(visits.day, day))).orderBy(asc(visits.createdAt)).limit(1);
  if (v) return v.id;
  const [n] = await tx.insert(visits).values({ contactId: ref.contactId, clientName: ref.clientName, day, origin, createdBy: actorId, createdAt: now, updatedAt: now }).returning({ id: visits.id });
  return n.id;
}

/**
 * Horários que ficam fora da visita: lista de espera (status "espera", às 00:00, vindos do relatório Lista de espera do Avec: 99,9% já
 * têm a reserva real) e cancelamento do Avec sem hora (gravado às 00:00 com a chave "T--:--"). Gêmeo do Avec também não entra.
 */
const OUT_OF_VISIT = sql`(${appointments.status} like 'espera%' or (${appointments.status} = 'cancelado' and ${appointments.externalKey} like '%T--:--%') or ${genericClientSql(appointments)})`;

/**
 * Visita por cliente e dia (17/10: 430 de 444 visitas do Avec dos últimos 30 dias estavam sem visita; ela só nascia no job do lembrete).
 * Junta os horários sem visita da mesma cliente (ou do mesmo nome, sem ficha) no mesmo dia de Salvador na visita que já existe, ou numa
 * nova. Idempotente: roda depois de cada importação do Avec e no script de correção (scripts/backfill-visitas.ts). `from`/`to`: só o período.
 */
export async function assignDayVisitsTx(tx: Tx, range: { from?: Date; to?: Date } = {}, now = new Date()): Promise<{ appointments: number; visits: number }> {
  const loose = await tx.select({ contactId: appointments.contactId, clientName: appointments.clientName,
    day: sql<string>`to_char(${appointments.startsAt} at time zone 'America/Bahia', 'YYYY-MM-DD')`, origin: sql<string>`min(${appointments.origin})` })
    .from(appointments)
    .where(and(isNull(appointments.visitId), isNull(appointments.avecTwinOf), sql`not ${OUT_OF_VISIT}`,
      range.from ? gte(appointments.startsAt, range.from) : undefined, range.to ? lt(appointments.startsAt, range.to) : undefined))
    .groupBy(appointments.contactId, appointments.clientName, sql`3`);
  let nAppts = 0, nVisits = 0;
  const seen = new Map<string, string>();
  for (const g of loose) {
    if (!g.contactId && !g.clientName) continue;
    const ref = { contactId: g.contactId, clientName: g.clientName };
    const k = `${g.contactId ?? `nome:${g.clientName}`}|${g.day}`;
    let visitId = seen.get(k);
    if (!visitId) {
      const [had] = await tx.select({ id: visits.id }).from(visits)
        .where(and(g.contactId ? eq(visits.contactId, g.contactId) : and(isNull(visits.contactId), eq(visits.clientName, g.clientName ?? "")), eq(visits.day, g.day))).limit(1);
      visitId = had?.id ?? await visitForDayTx(tx, ref, g.day, null, now, g.origin === "avec" ? "avec" : "crm");
      if (!had) nVisits++;
      seen.set(k, visitId);
    }
    const same = g.contactId ? eq(appointments.contactId, g.contactId) : and(isNull(appointments.contactId), eq(appointments.clientName, g.clientName ?? ""));
    const done = await tx.update(appointments).set({ visitId })
      .where(and(same, isNull(appointments.visitId), isNull(appointments.avecTwinOf), sql`not ${OUT_OF_VISIT}`,
        gte(appointments.startsAt, instantOf(g.day, 0)), lt(appointments.startsAt, instantOf(g.day, 1440)))).returning({ id: appointments.id });
    nAppts += done.length;
  }
  return { appointments: nAppts, visits: nVisits };
}
export const assignDayVisits = (range: { from?: Date; to?: Date } = {}, now = new Date()) => db.transaction((tx) => assignDayVisitsTx(tx, range, now));

export type ProTerms = { durationMin: number | null; priceCents: number | null; bufferMin: number | null; parallelOk: boolean | null };
/**
 * O tempo, o preço e a folga de um horário com a profissional `proId` (Remarcar e Passar o dia). 0084: trocando a profissional, o preço
 * e o tempo passam a ser os da nova (os próprios dela, senão os do serviço); a mesma profissional fica com os do horário. A folga é a do
 * horário, senão a do serviço; `parallelOk` (junto com outro) é a do serviço.
 */
export async function termsWithProTx(tx: Tx, a: { serviceId: string | null; professionalId: string | null; durationMin: number | null; priceCents: number | null; bufferMin: number | null }, proId: string): Promise<ProTerms> {
  const [svc] = a.serviceId ? await tx.select({ durationMin: lists.durationMin, bufferMin: lists.bufferMin, parallelOk: lists.parallelOk }).from(lists).where(eq(lists.id, a.serviceId)) : [];
  const terms = a.serviceId && proId !== a.professionalId ? await serviceTermsFor(tx, a.serviceId, proId) : null;
  return {
    durationMin: (terms ? terms.durationMin : a.durationMin) ?? svc?.durationMin ?? null, priceCents: terms ? terms.priceCents : a.priceCents,
    bufferMin: a.bufferMin ?? svc?.bufferMin ?? null, parallelOk: svc?.parallelOk ?? null,
  };
}

/**
 * Remarcar (6.4, regra 9): muda o mesmo registro (início, profissional, duração), volta para Agendado e apaga a confirmação. Recusado no
 * modo consulta. Horário do Avec remarcado aqui passa a ser do CRM (regra 16). Mudando de dia, sai da visita antiga.
 */
export async function rescheduleAppointment(id: string, raw: RescheduleInput, actor: Actor, now = new Date(), opts: { clientMessage?: boolean } = {}): Promise<{ day: string; previousDay: string }> {
  const input = rescheduleSchema.parse(raw);
  const r = await db.transaction(async (tx) => {
    await assertCanBook(tx);
    const [a0] = await tx.select().from(appointments).where(eq(appointments.id, z.string().uuid().parse(id)));
    if (!a0 || a0.avecTwinOf) throw new UserFacingError("Horário não encontrado.");
    const startsAt = new Date(input.startsAt);
    const proId = input.professionalId ?? a0.professionalId;
    if (!proId) throw new UserFacingError("Escolha a profissional.");
    const previousDay = dayOf(a0.startsAt), day = dayOf(startsAt);
    const auxBefore = await auxiliaryIdsTx(tx, a0.id);
    const auxIds = input.assistantIds ?? auxBefore;
    await lockAgendaTx(tx, { professionalIds: [a0.professionalId, proId, ...auxBefore, ...auxIds], contactId: a0.contactId, days: [previousDay, day] });
    const [a] = await tx.select().from(appointments).where(eq(appointments.id, a0.id)).for("update");
    if (!["agendado", "confirmado", "solicitado"].includes(a.status)) throw new UserFacingError("Só dá para remarcar um horário agendado ou confirmado.");
    // 6.11: ela pediu esta profissional; trocar exige confirmação. "Tanto faz" troca sem perguntar.
    if (a.preference === "escolhida" && a.professionalId && proId !== a.professionalId && !input.confirmProChange) {
      const [old] = await tx.select({ name: professionals.name }).from(professionals).where(eq(professionals.id, a.professionalId));
      throw new UserFacingError(`Ela pediu a ${old?.name ?? "outra profissional"}. Confirme a troca de profissional.`);
    }
    if (a.serviceId) await assertProfessionalFor(tx, proId, a.serviceId);
    // O tempo digitado vence o da profissional.
    const terms = await termsWithProTx(tx, a, proId);
    const durationMin = input.durationMin ?? terms.durationMin;
    const { priceCents, bufferMin } = terms;
    if (durationMin == null) throw new UserFacingError(refusalText("sem_duracao", { proName: "", serviceLabel: a.serviceLabel }));
    if (durationMin < DURATION_STEP || durationMin > DURATION_MAX || durationMin % DURATION_STEP) throw new UserFacingError(refusalText("duracao_invalida", { proName: "", serviceLabel: a.serviceLabel }));
    const [pro] = await tx.select({ name: professionals.name }).from(professionals).where(eq(professionals.id, proId));
    const check = await checkSlotTx(tx, { professionalId: proId, startsAt, durationMin, bufferMin, clientId: a.contactId, ignoreAppointmentId: a.id, now, parallelOk: terms.parallelOk });
    const d = decideBooking(check, { proName: pro?.name ?? "A profissional", serviceLabel: a.serviceLabel, fitIn: !!input.fitIn, actor, now });
    // 0089: as auxiliares vão junto para o novo período (a agenda delas é conferida igual à da principal, sem contar este horário).
    const aux = await validateAuxiliariesTx(tx, auxIds, proId, new Set(auxBefore));
    if (aux.length) {
      const r = await checkAuxiliariesTx(tx, aux, { startsAt, durationMin, bufferMin, parallelOk: terms.parallelOk, ignoreAppointmentId: a.id, fitIn: !!input.fitIn, actor, now },
        (c, proName) => decideBooking(c, { proName, serviceLabel: a.serviceLabel, fitIn: !!input.fitIn, actor, now }));
      if (r.fitIn) d.fitIn = true;
    }
    const auxChanged = auxIds.join() !== auxBefore.join();
    if (auxChanged) await saveAuxiliariesTx(tx, a.id, auxIds, actor.id, now);
    const visitId = a.visitId && previousDay === day ? a.visitId : await visitForDayTx(tx, { contactId: a.contactId, clientName: a.clientName }, day, actor.id, now);
    await tx.update(appointments).set({
      startsAt, professionalId: proId, durationMin, bufferMin, priceCents, status: "agendado", confirmedAt: null, confirmedVia: null, visitId,
      fitIn: d.fitIn, fitInBy: d.fitIn ? actor.id : null, outsideHours: d.outsideHours, anyPro: false, updatedBy: actor.id, updatedAt: now, crmTouchedAt: now,
    }).where(eq(appointments.id, a.id));
    await tx.insert(auditLog).values({ userId: actor.id, action: "agendamento_remarcado", entity: "appointment", entityId: a.id, createdAt: now, data: {
      de: { inicio: a.startsAt.toISOString(), profissional: a.professionalId, duracao: a.durationMin, status: a.status, ...(priceCents !== a.priceCents ? { preco: a.priceCents } : {}), ...(auxChanged ? { auxiliares: auxBefore } : {}) },
      para: { inicio: startsAt.toISOString(), profissional: proId, duracao: durationMin, status: "agendado", trocaConfirmada: !!input.confirmProChange, ...(priceCents !== a.priceCents ? { preco: priceCents } : {}), ...(auxChanged ? { auxiliares: auxIds } : {}) },
    } });
    await queueProNotificationsTx(tx, { kind: "remarcado", before: a, after: { ...a, startsAt, professionalId: proId, status: "agendado" } }, { actorId: actor.id, via: "recepcao", now });
    const dealIds = await agendaFunnelTx(tx, [a.contactId], now);
    return { day, previousDay, dealIds, previousStart: a.startsAt };
  });
  await afterAgendaChange([r.day, r.previousDay], r.dealIds);
  // Lote 7B: com o lembrete ligado, "seu horário foi remarcado" e o lembrete vai para o horário novo. Nunca derruba a remarcação.
  await import("../client-link/reminder").then((m) => m.afterRescheduleReminder(id, r.previousStart, now, { message: opts.clientMessage !== false })).catch((e) => console.error("[lembrete] remarcação", e));
  return { day: r.day, previousDay: r.previousDay };
}

/* ───────────── Cancelar ───────────── */

export const cancelSchema = z.object({
  appointmentId: z.string().uuid(),
  /** "serie" (0085): este horário e os próximos ainda ativos da mesma série. */
  scope: z.enum(["este", "visita", "serie"]).default("este"),
  reason: z.enum(CANCEL_REASONS, { message: "Escolha o motivo." }),
  note: z.string().trim().max(200, "Use até 200 caracteres no motivo.").nullable().optional(),
  via: z.enum(["recepcao", "link"]).default("recepcao"),
}).refine((v) => v.reason !== "outro" || !!v.note, { message: "Escreva o motivo.", path: ["note"] });
export type CancelInput = z.input<typeof cancelSchema>;

/**
 * Cancelar (6.4, regra 10): motivo, quem e por onde; nunca apaga. "A visita toda" cancela os horários ainda abertos da visita; "Este e os
 * próximos" (0085), este e os horários ainda ativos da série que começam depois dele (com a função repetir desligada também).
 * Vale em qualquer modo da agenda. O 6C acrescenta aqui a trava da visita já paga e a saída do item da comanda aberta.
 */
export async function cancelAppointmentsTx(tx: Tx, raw: CancelInput, actorId: string | null, now: Date) {
  const input = cancelSchema.parse(raw);
  const [a] = await tx.select().from(appointments).where(eq(appointments.id, input.appointmentId)).for("update");
  if (!a || a.avecTwinOf) throw new UserFacingError("Horário não encontrado.");
  const day = dayOf(a.startsAt);
  const first = checkCancel(a.status);
  if (!first.ok) throw new UserFacingError(first.error);
  const targets = input.scope === "visita" && a.visitId
    ? await tx.select().from(appointments).where(and(eq(appointments.visitId, a.visitId), inArray(appointments.status, [...ACTIVE_STATUSES]), isNull(appointments.avecTwinOf))).for("update")
    : input.scope === "serie" && a.seriesId
      ? await tx.select().from(appointments).where(and(eq(appointments.seriesId, a.seriesId), gte(appointments.startsAt, a.startsAt), inArray(appointments.status, [...ACTIVE_STATUSES]), isNull(appointments.avecTwinOf))).orderBy(asc(appointments.startsAt)).for("update")
      : [a];
  for (const t of targets) { const c = checkCancel(t.status); if (!c.ok) throw new UserFacingError(c.error); }
  await assertNotPaidTx(tx, targets.map((t) => t.id));
  for (const t of targets) {
    await tx.update(appointments).set({ status: "cancelado", cancelledAt: now, cancelReason: input.reason, cancelNote: input.note || null, cancelledBy: actorId, cancelledVia: input.via,
      updatedBy: actorId, updatedAt: now, crmTouchedAt: now }).where(eq(appointments.id, t.id));
    await tx.insert(auditLog).values({ userId: actorId, action: "agendamento_situacao", entity: "appointment", entityId: t.id, createdAt: now,
      data: { de: t.status, para: "cancelado", motivo: input.reason, nota: input.note || null, via: input.via } });
    await queueProNotificationsTx(tx, { kind: "cancelado", appointment: t }, { actorId, via: input.via, now });
  }
  await dropOpenItemsTx(tx, targets.map((t) => t.id), actorId, now);
  const dealIds = await agendaFunnelTx(tx, [a.contactId], now);
  return { cancelledIds: targets.map((t) => t.id), day, contactId: a.contactId, dealIds };
}

export async function cancelAppointments(raw: CancelInput, actor: Actor | null, now = new Date()): Promise<{ cancelled: number; day: string }> {
  const r = await db.transaction((tx) => cancelAppointmentsTx(tx, raw, actor?.id ?? null, now));
  await afterAgendaChange([r.day], r.dealIds);
  return { cancelled: r.cancelledIds.length, day: r.day };
}

/* ───────────── Visita sob demanda ───────────── */

/**
 * A visita do horário (4.1). Horário do Avec sem visita ganha uma agora, juntando os horários ativos (e finalizados) da mesma cliente
 * naquele dia. Não marca o horário como mexido no CRM: a visita é só a ligação. Usado pela comanda (6C) e pelo link da cliente (7B).
 */
export async function ensureVisitFor(appointmentId: string, q?: Tx): Promise<string> {
  const run = async (tx: Tx) => {
    const [a] = await tx.select().from(appointments).where(eq(appointments.id, z.string().uuid().parse(appointmentId))).for("update");
    if (!a || a.avecTwinOf) throw new UserFacingError("Horário não encontrado.");
    if (a.visitId) return a.visitId;
    const day = dayOf(a.startsAt);
    const visitId = await visitForDayTx(tx, { contactId: a.contactId, clientName: a.clientName }, day, null, new Date(), a.origin === "avec" ? "avec" : "crm");
    const sameClient = a.contactId ? eq(appointments.contactId, a.contactId) : and(isNull(appointments.contactId), eq(appointments.clientName, a.clientName ?? ""));
    await tx.update(appointments).set({ visitId }).where(and(sameClient, isNull(appointments.visitId), isNull(appointments.avecTwinOf),
      gte(appointments.startsAt, instantOf(day, 0)), lt(appointments.startsAt, instantOf(day, 1440)),
      or(eq(appointments.id, a.id), inArray(appointments.status, [...ACTIVE_STATUSES, "compareceu"]))));
    return visitId;
  };
  return q ? run(q) : db.transaction(run);
}
