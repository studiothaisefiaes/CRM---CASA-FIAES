import { and, inArray, isNotNull, like, notInArray, notLike, sql } from "drizzle-orm";
import { agendaBlocks, appointments } from "../../db/schema";
import { bahiaAt, clean, dateIso, moneyCents, normText, plausibleDay, reservationStatus, timeHm, weekdaysOf, type AppointmentStatus } from "./normalize";
import { fillEmpty, upsertKeyed } from "./keyed";
import { isSweepReport, parseReservationKey, sweepVanished, SWEEP_SIGNATURES, type SweepRow } from "./vanished";
import type { ImportCtx } from "./context";
import { parseAvecPreference } from "@/lib/appointment-preference";

/**
 * Agenda vinda do Avec: reservas, cancelamentos e lista de espera viram `appointments`; bloqueios viram `agenda_blocks`.
 * Chave da reserva: avec:res:<aaaa-mm-ddTHH:MM>|<cliente>|<serviço> (sem profissional, porque nem todo formato traz).
 */

type NewAppointment = typeof appointments.$inferInsert & { externalKey: string };

/** Quanto "andou" o status: um relatório mais antigo (Agendado) não desfaz um mais novo (Pago/Cancelado). */
/** `conferir` (status que o CRM não conhece) passa agendado e confirmado, mas não desfaz um desfecho. */
const ALIVE_STATUSES = ["agendado", "confirmado", "conferir"];
const RANK: Record<AppointmentStatus, number> = { espera: 0, agendado: 1, confirmado: 2, conferir: 2.5, compareceu: 3, faltou: 3, cancelado: 3 };

const FILL: (keyof NewAppointment & string)[] = ["contactId", "clientName", "professionalId", "serviceId", "durationMin", "priceCents", "notes", "createdByName", "preference"];

/**
 * Regra 15 (6.4): horário mexido no CRM (`crmTouchedAt`) não é tocado pela importação: nem status, nem observação, nem profissional.
 * Só guarda em `avecStatus` o que o Avec diz agora (a diferença aparece em "Conferir com o Avec"). Os outros seguem a regra de sempre:
 * completar o vazio e o status só sobe.
 */
function mergeAppointment(old: Record<string, unknown>, inc: NewAppointment, opts: { revive?: boolean; now?: Date } = {}): Partial<NewAppointment> {
  if (old.crmTouchedAt) {
    const avec = inc.avecStatus ?? inc.status;
    return old.avecStatus === avec ? {} : { avecStatus: avec };
  }
  const patch: Partial<NewAppointment> = fillEmpty(old, inc, FILL);
  // Revisão final (17/10): a varredura "sumiu do Avec" pode ter cancelado por um relatório mais antigo aplicado depois do novo. Se o Avec
  // volta a trazer a reserva viva, ela volta (só o cancelamento que a própria varredura fez: motivo remarcado, via avec, sem mexida do CRM).
  if (opts.revive && old.status === "cancelado" && old.cancelReason === "remarcado" && old.cancelledVia === "avec" && ALIVE_STATUSES.includes(inc.status as string)) {
    return { ...patch, status: inc.status, avecStatus: inc.avecStatus ?? null, cancelReason: null, cancelledVia: null, cancelledAt: null, cancelNote: null };
  }
  const oldRank = RANK[old.status as AppointmentStatus] ?? 0, newRank = RANK[inc.status as AppointmentStatus] ?? 0;
  if (newRank > oldRank) {
    patch.status = inc.status; patch.avecStatus = inc.avecStatus ?? null;
    // Fase B (Depois do atendimento): a baixa do Avec carimba a hora da conclusão. Só quando o status PASSA a compareceu e sem apagar
    // um carimbo que já existe: `updated_at` muda em qualquer patch (observação, preço…) e não serve de hora da conclusão.
    if (inc.status === "compareceu" && !old.finishedAt) patch.finishedAt = inc.finishedAt ?? opts.now ?? new Date();
  }
  return patch;
}

export const reservationKey = (day: string, hm: string, client: string | null, service: string | null) =>
  `avec:res:${day}T${hm}|${normText(client)}|${normText(service)}`;

const NOT_INFORMED = "Não informado";

async function rowBase(ctx: ImportCtx, row: string[], ix: { client: number; pro: number; service: number }) {
  const { name, imageUse, completeProfile } = ctx.clientOf(row);
  const contactId = await ctx.contactOf(row);
  if (contactId && imageUse) await ctx.tagImageUse(contactId);
  if (contactId && completeProfile) await ctx.tagCompleteProfile(contactId);
  const serviceRaw = clean(ctx.cell(row, ix.service));
  return {
    name, contactId, serviceRaw,
    professionalId: await ctx.professionalId(ctx.cell(row, ix.pro), { create: true }),
    serviceId: serviceRaw ? await ctx.serviceId(serviceRaw) : null, // serviço só nasce do cadastro de serviços
  };
}

/** Data fora do limite: a linha vai para as recusadas (e para "Conferir com o Avec"), nunca para a agenda. */
async function rejectRow(ctx: ImportCtx, row: string[], ix: { pro: number }, b: Awaited<ReturnType<typeof rowBase>>, day: string, hm: string | null) {
  await ctx.reject({ key: reservationKey(day, hm ?? "--:--", b.name, b.serviceRaw), reason: "data_fora_do_limite", day, hm, name: b.name, contactId: b.contactId,
    pro: clean(ctx.cell(row, ix.pro)), service: b.serviceRaw });
}

/** Reservas (f18900ac, 1903eedc, e51ff131 e parecidos): Data Reserva + Hora + Cliente + Serviço (+ Status, Profissional…). */
export async function importReservations(ctx: ImportCtx) {
  const ix = {
    day: ctx.col("data reserva"), time: ctx.col("hora"), client: ctx.col("cliente"), pro: ctx.col("profissional"), service: ctx.col("servico"),
    status: ctx.col("status"), notes: ctx.col("observacao", "obs"), by: ctx.col("quem cadastrou"), price: ctx.col("valor"),
    tipo: ctx.col("tipo", "tipo de atendimento", "tipo de reserva"),
  };
  const out: NewAppointment[] = [];
  for (const row of ctx.rows) {
    const day = dateIso(ctx.cell(row, ix.day)), hm = timeHm(ctx.cell(row, ix.time));
    if (!day || !hm) continue;
    const b = await rowBase(ctx, row, ix);
    if (!plausibleDay(day, ctx.now)) { await rejectRow(ctx, row, ix, b, day, hm); continue; }
    const { status, avecStatus } = reservationStatus(ctx.cell(row, ix.status));
    if (status === "compareceu") ctx.evidence(b.contactId, day);
    out.push({
      externalKey: reservationKey(day, hm, b.name, b.serviceRaw), contactId: b.contactId, clientName: b.name, professionalId: b.professionalId,
      serviceId: b.serviceId, serviceLabel: b.serviceRaw ?? NOT_INFORMED, startsAt: bahiaAt(day, hm), status, avecStatus,
      priceCents: moneyCents(ctx.cell(row, ix.price)), notes: clean(ctx.cell(row, ix.notes)), createdByName: clean(ctx.cell(row, ix.by)), origin: "avec",
      preference: parseAvecPreference(ctx.cell(row, ix.tipo)),
      // Fase B: reserva que já chega Finalizada (Pago) nasce com a hora da conclusão = a da importação.
      ...(status === "compareceu" ? { finishedAt: ctx.now } : {}),
    });
  }
  // Só relatório novo desfaz o "sumiu do Avec": o mesmo arquivo de novo pode ser um export antigo.
  ctx.summary.agendamentos += (await upsertKeyed(ctx.tx, appointments, out, (old, inc) => mergeAppointment(old, inc, { revive: ctx.newReport, now: ctx.now }))).created;
  // Remarcação no Avec (17/10): a reserva que sumiu do "Reservas" (cliente + dia + profissional que ele traz) deixa de ficar viva.
  // Mesmo arquivo de novo (já guardado) não varre: pode ser um export antigo importado depois de um mais novo.
  if (ctx.newReport && ((ctx.signature && SWEEP_SIGNATURES.has(ctx.signature)) || isSweepReport(ctx.columns)) && ix.status >= 0 && ix.pro >= 0) {
    const rows: SweepRow[] = out.map((o) => ({ key: o.externalKey, ...parseReservationKey(o.externalKey)!, professionalId: o.professionalId ?? null }));
    ctx.summary.agendamentos += (await sweepVanished(ctx.tx, { rows, now: ctx.now })).cancelled;
  }
}

export type CancelCand = { key: string; status: string; professionalId: string | null; serviceLabel: string };
const ALIVE = ["agendado", "confirmado", "solicitado", "conferir"];

/**
 * Qual reserva um cancelamento sem hora cancela (17/10). Recebe as reservas COM hora da mesma cliente no mesmo dia e decide:
 * filtra pela profissional e pelo serviço (quando a linha traz); se alguma já está cancelada, o cancelamento já
 * foi aplicado (o relatório "Reservas" traz "Cancelado"); se sobra exatamente uma viva, é ela; senão não chuta (null).
 * Antes: dia + cliente + serviço com exatamente uma; numa remarcação havia sempre duas, e o cancelamento virava um horário às 00:00 (375).
 */
export function matchCancellation(cands: CancelCand[], row: { professionalId: string | null; service: string | null }): { key: string } | "ja_cancelado" | null {
  let c = row.professionalId ? cands.filter((x) => x.professionalId === row.professionalId) : cands;
  if (row.service) c = c.filter((x) => normText(x.serviceLabel) === normText(row.service)); // serviço diferente nunca é o mesmo horário
  if (c.some((x) => x.status === "cancelado")) return "ja_cancelado";
  const alive = c.filter((x) => ALIVE.includes(x.status));
  return alive.length === 1 ? { key: alive[0].key } : null;
}

/** As reservas com hora da cliente no dia (pelo contato ou pelo nome da chave). */
async function dayReservations(ctx: ImportCtx, day: string, contactId: string | null, name: string | null): Promise<CancelCand[]> {
  const prefix = `avec:res:${day}T`.replace(/[\\%_]/g, (c) => `\\${c}`);
  const rows = await ctx.tx.select({ key: appointments.externalKey, status: appointments.status, professionalId: appointments.professionalId,
    serviceLabel: appointments.serviceLabel, contactId: appointments.contactId }).from(appointments)
    .where(and(like(appointments.externalKey, `${prefix}%`), notLike(appointments.externalKey, "%T--:--%")));
  const nameKey = normText(name);
  return rows.filter((r) => (contactId && r.contactId === contactId) || (!!nameKey && r.key.split("|")[1] === nameKey));
}

/**
 * Cancelamentos (e8aa4978): o relatório nunca traz a hora. Casa por cliente + dia + profissional (`matchCancellation`); achou a reserva
 * viva, ela vira "cancelado" (mexida no CRM: só `avecStatus`, como sempre). Sem par seguro não grava nada: nunca mais horário às 00:00.
 */
export async function importCancellations(ctx: ImportCtx) {
  const ix = { day: ctx.col("data"), client: ctx.col("cliente"), pro: ctx.col("profissional"), service: ctx.col("servico"), notes: ctx.col("obs"), by: ctx.col("responsavel"), price: ctx.col("valor total") };
  const out: NewAppointment[] = [];
  for (const row of ctx.rows) {
    const raw = ctx.cell(row, ix.day);
    const day = dateIso(raw);
    if (!day || !plausibleDay(day, ctx.now)) continue; // data impossível: a reserva dela já foi recusada (ou nem existe)
    const b = await rowBase(ctx, row, ix);
    const hm = /\d{1,2}:\d{2}/.test(raw.slice(8)) ? timeHm(raw) : null;
    let key = hm ? reservationKey(day, hm, b.name, b.serviceRaw) : null;
    if (!key) {
      const m = matchCancellation(await dayReservations(ctx, day, b.contactId, b.name), { professionalId: b.professionalId, service: b.serviceRaw });
      if (!m || m === "ja_cancelado") continue;
      key = m.key;
    }
    out.push({
      externalKey: key, contactId: b.contactId, clientName: b.name, professionalId: b.professionalId, serviceId: b.serviceId, serviceLabel: b.serviceRaw ?? NOT_INFORMED,
      startsAt: bahiaAt(day, key.slice(`avec:res:${day}T`.length, `avec:res:${day}T`.length + 5)), status: "cancelado", avecStatus: null,
      priceCents: moneyCents(ctx.cell(row, ix.price)), notes: clean(ctx.cell(row, ix.notes)), createdByName: clean(ctx.cell(row, ix.by)), origin: "avec",
    });
  }
  ctx.summary.agendamentos += (await upsertKeyed(ctx.tx, appointments, out, (old, inc) => mergeAppointment(old, inc, { now: ctx.now }))).changed; // cancelamento muda o status da reserva que já existe: conta
}

/**
 * 0248 "Agendamentos por status › Agendado" (fbd442b2; gap Avec, A1): cada linha é uma reserva que continua Agendado no Avec, sem baixa.
 * Antes virava "lista de espera" às 00:00 (1.724 em produção). Agora não cria nada: marca `avec_unclosed_at` na reserva da agenda que
 * bate com segurança (mesma cliente e dia; a profissional e o serviço, quando vêm, iguais; exatamente uma). A reserva do período que
 * este relatório não traz mais perde o sinal (teve baixa no Avec).
 */
export async function importUnclosed(ctx: ImportCtx) {
  const ix = { day: ctx.col("data"), pro: ctx.col("profissional"), service: ctx.col("servico") };
  const marked = new Set<string>();
  const days: string[] = [];
  for (const row of ctx.rows) {
    const day = dateIso(ctx.cell(row, ix.day));
    if (!day || !plausibleDay(day, ctx.now)) continue;
    days.push(day);
    const { name } = ctx.clientOf(row);
    const contactId = await ctx.contactOf(row);
    const proRaw = clean(ctx.cell(row, ix.pro)), service = clean(ctx.cell(row, ix.service));
    const professionalId = proRaw ? await ctx.professionalId(proRaw) : null;
    const nameKey = normText(name);
    const cands = (await ctx.tx.select({ id: appointments.id, twinOf: appointments.avecTwinOf, contactId: appointments.contactId, clientName: appointments.clientName,
      professionalId: appointments.professionalId, serviceLabel: appointments.serviceLabel, key: appointments.externalKey }).from(appointments)
      .where(and(sql`(${appointments.startsAt} at time zone 'America/Bahia')::date = ${day}::date`, notInArray(appointments.status, ["espera", "espera_encaixada", "espera_desistiu"]))))
      .filter((c) => (contactId && c.contactId === contactId) || (!!nameKey && (normText(c.clientName) === nameKey || c.key.split("|")[1] === nameKey)))
      .filter((c) => !proRaw || !professionalId || !c.professionalId || c.professionalId === professionalId)
      .filter((c) => !service || normText(c.serviceLabel) === normText(service));
    // A reserva do Avec e o horário do CRM de que ela é gêmea são o mesmo horário: vale o do CRM.
    const targets = [...new Set(cands.map((c) => c.twinOf ?? c.id))];
    if (targets.length === 1) marked.add(targets[0]);
  }
  if (marked.size) {
    const r = await ctx.tx.update(appointments).set({ avecUnclosedAt: ctx.now }).where(inArray(appointments.id, [...marked])).returning({ id: appointments.id });
    ctx.summary.semBaixa += r.length;
  }
  if (days.length) {
    days.sort();
    await ctx.tx.update(appointments).set({ avecUnclosedAt: null }).where(and(isNotNull(appointments.avecUnclosedAt),
      sql`(${appointments.startsAt} at time zone 'America/Bahia')::date between ${days[0]}::date and ${days[days.length - 1]}::date`,
      marked.size ? notInArray(appointments.id, [...marked]) : undefined));
  }
}

/** Bloqueios de agenda (61a7a9b6): intervalo de datas, horário e, se vier, os dias da semana ("Terça,"). */
export async function importBlocks(ctx: ImportCtx) {
  const ix = {
    from: ctx.col("data inicial"), to: ctx.col("data final"), start: ctx.col("hora inicial"), end: ctx.col("hora final"), pro: ctx.col("profissional"),
    title: ctx.col("titulo"), notes: ctx.col("obs"), service: ctx.col("servico"), week: ctx.col("periodo da semana"),
  };
  type NewBlock = typeof agendaBlocks.$inferInsert & { externalKey: string };
  const out: NewBlock[] = [];
  for (const row of ctx.rows) {
    const from = dateIso(ctx.cell(row, ix.from)), to = dateIso(ctx.cell(row, ix.to)) ?? from;
    const start = timeHm(ctx.cell(row, ix.start)), end = timeHm(ctx.cell(row, ix.end));
    if (!from || !to || !start || !end) continue;
    const proRaw = ctx.cell(row, ix.pro);
    const title = clean(ctx.cell(row, ix.title)) ?? "Bloqueio";
    const weekdays = weekdaysOf(ctx.cell(row, ix.week));
    const service = clean(ctx.cell(row, ix.service));
    const notes = [clean(ctx.cell(row, ix.notes)), service ? `Serviço: ${service}` : null].filter(Boolean).join(" · ") || null;
    out.push({
      externalKey: `avec:blq:${from}|${to}|${start}|${end}|${normText(proRaw)}|${normText(title)}|${(weekdays ?? []).join(",")}`,
      professionalId: await ctx.professionalId(proRaw, { create: true }), title, notes, startsOn: from, endsOn: to < from ? from : to, startTime: start, endTime: end, weekdays,
    });
  }
  // Bloqueio apagado no CRM (deleted_at) não volta nem é completado: a reimportação não mexe nele.
  ctx.summary.bloqueios += (await upsertKeyed(ctx.tx, agendaBlocks, out, (old, inc) => (old.deletedAt ? {} : fillEmpty(old, inc, ["professionalId", "notes"])))).created;
}
