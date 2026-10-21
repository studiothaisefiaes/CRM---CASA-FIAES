import { and, asc, eq, gte, inArray, isNull, lt } from "drizzle-orm";
import { z } from "zod";
import { db, type Tx } from "../../db";
import { appointments, auditLog, contacts, professionals } from "../../db/schema";
import { UserFacingError } from "../errors";
import { assertFuncao } from "../funcoes";
import { assertProfessionalFor } from "../professionals";
import { queueProNotificationsTx } from "../pro/notifications";
import { conflictText, refusalText } from "@/lib/agenda-text";
import { instantOf, minuteOfDay, todayBahia } from "@/lib/agenda";
import { displayName } from "@/lib/display-name";
import { firstName } from "@/lib/authorship";
import { hhmm } from "@/lib/free-slots";
import { assertCanBook } from "./mode";
import { agendaLockKeys, lockKeyTx } from "./locks";
import { checkSlotTx } from "./slots";
import { termsWithProTx, type ProTerms } from "./visits";
import { afterAgendaChange } from "./notify";
import type { Actor } from "./actor";

/**
 * Passar o dia (Fase C, item 23b): quando uma profissional falta, os horários dela num dia vão para outra, cada um com o tempo e o preço
 * da nova (0084, como no Remarcar) e conferido pelo motor (conflito, bloqueio, folga, horário de trabalho, quem faz o serviço). O que não
 * cabe livre fica de fora com o motivo: nada vira encaixe. "Pediu ela" só passa com o tique explícito (trava de segurança, não é
 * configurável). Mantém hora, situação e confirmação; marca `crmTouchedAt` (a importação do Avec não devolve à de antes). Só o horário
 * do dia, nunca a série inteira, nunca o gêmeo do Avec. A cliente não recebe mensagem: o lembrete D-1 já sai com o nome de quem atende.
 */
const MOVABLE = ["agendado", "confirmado", "solicitado"];

export type TransferRow = { appointmentId: string; hm: string; clientName: string; serviceLabel: string };
export type TransferPreview = { movable: TransferRow[]; askedForHer: TransferRow[]; blocked: (TransferRow & { reason: string })[] };
export type TransferResult = { moved: number; skipped: { appointmentId: string; reason: string }[] };

const fields = {
  fromProfessionalId: z.string().uuid("Escolha de quem é o dia."),
  toProfessionalId: z.string().uuid("Escolha para quem passar."),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Escolha o dia."),
};
const SAME_PRO = { message: "Escolha outra profissional para receber o dia.", path: ["toProfessionalId"] };
const differ = (v: { fromProfessionalId: string; toProfessionalId: string }) => v.fromProfessionalId !== v.toProfessionalId;
const previewSchema = z.object(fields).refine(differ, SAME_PRO);
const transferSchema = z.object({ ...fields, appointmentIds: z.array(z.string().uuid()).max(200), confirmAskedForHer: z.boolean().default(false) }).refine(differ, SAME_PRO);
export type TransferPreviewInput = z.input<typeof previewSchema>;
export type TransferInput = z.input<typeof transferSchema>;

type Appt = typeof appointments.$inferSelect;
type Pros = { from: string; to: string };

/** Confere a função, o dia e as duas profissionais; devolve os nomes (apelido, como na tela). */
async function startTx(tx: Tx, i: z.output<typeof previewSchema>, now: Date): Promise<Pros> {
  await assertFuncao("passar_dia", tx);
  await assertCanBook(tx);
  if (i.day < todayBahia(now)) throw new UserFacingError("Esse dia já passou.");
  await assertProfessionalFor(tx, i.toProfessionalId, null);
  const rows = await tx.select({ id: professionals.id, name: professionals.name }).from(professionals).where(inArray(professionals.id, [i.fromProfessionalId, i.toProfessionalId]));
  const name = (id: string) => { const n = rows.find((p) => p.id === id)?.name; return n ? firstName(displayName(n)) ?? displayName(n) : "A profissional"; };
  if (!rows.some((p) => p.id === i.fromProfessionalId)) throw new UserFacingError("Profissional não encontrada.");
  return { from: name(i.fromProfessionalId), to: name(i.toProfessionalId) };
}

/** Os horários da profissional no dia que podem passar (agendado, confirmado, solicitado; sem gêmeo), em ordem de hora. */
function dayRowsTx(tx: Tx, professionalId: string, day: string, opts: { ids?: string[]; lock?: boolean } = {}): Promise<Appt[]> {
  const q = tx.select().from(appointments).where(and(eq(appointments.professionalId, professionalId), gte(appointments.startsAt, instantOf(day, 0)), lt(appointments.startsAt, instantOf(day, 1440)),
    inArray(appointments.status, MOVABLE), isNull(appointments.avecTwinOf), opts.ids ? inArray(appointments.id, opts.ids) : undefined)).orderBy(asc(appointments.startsAt), asc(appointments.id));
  return opts.lock ? q.for("update") : q;
}

async function rowsOf(tx: Tx, list: Appt[]): Promise<Map<string, TransferRow>> {
  const cids = [...new Set(list.map((a) => a.contactId).filter((x): x is string => !!x))];
  const names = new Map(cids.length ? (await tx.select({ id: contacts.id, name: contacts.name }).from(contacts).where(inArray(contacts.id, cids))).map((c) => [c.id, c.name]) : []);
  return new Map(list.map((a) => [a.id, {
    appointmentId: a.id, hm: hhmm(minuteOfDay(a.startsAt)), serviceLabel: a.serviceLabel,
    clientName: (a.contactId && names.get(a.contactId)?.trim()) || a.clientName?.trim() || "Cliente",
  }]));
}

const firstSentence = (m: string) => { const k = m.indexOf(". "); return k < 0 ? m : m.slice(0, k + 1); };

/**
 * Cabe livre com a nova? O motor de sempre (`checkSlotTx`) com o tempo e a folga dela. Conflito, fora do horário, bloqueio, folga ou
 * serviço que ela não faz: o motivo. Nunca encaixa.
 */
async function verdictTx(tx: Tx, a: Appt, toId: string, toName: string, now: Date): Promise<{ ok: true; terms: ProTerms & { durationMin: number } } | { ok: false; reason: string }> {
  if (a.serviceId) {
    try { await assertProfessionalFor(tx, toId, a.serviceId); }
    catch (e) { if (e instanceof UserFacingError) return { ok: false, reason: firstSentence(e.message) }; throw e; }
  }
  const terms = await termsWithProTx(tx, a, toId);
  if (terms.durationMin == null) return { ok: false, reason: `${a.serviceLabel} não tem duração cadastrada: remarque este pela Agenda.` };
  const check = await checkSlotTx(tx, { professionalId: toId, startsAt: a.startsAt, durationMin: terms.durationMin, bufferMin: terms.bufferMin, clientId: a.contactId, ignoreAppointmentId: a.id, now, parallelOk: terms.parallelOk });
  const c = check.conflicts[0];
  const ctx = { proName: toName, serviceLabel: a.serviceLabel };
  if (!check.ok) return { ok: false, reason: check.reason === "conflito" && c ? conflictText(toName, c) : refusalText(check.reason, { ...ctx, blockedBy: check.blockedBy }) };
  if (check.fitIn) return { ok: false, reason: c ? conflictText(toName, c) : refusalText("conflito", ctx) };
  if (check.outsideHours) return { ok: false, reason: refusalText("fora_do_horario", ctx) };
  return { ok: true, terms: { ...terms, durationMin: terms.durationMin } };
}

/** O horário com a nova (dentro da transação): ocupa a agenda dela para o próximo da lista. */
const moveTx = (tx: Tx, a: Appt, toId: string, t: ProTerms, set: Partial<typeof appointments.$inferInsert> = {}) =>
  tx.update(appointments).set({ professionalId: toId, durationMin: t.durationMin, bufferMin: t.bufferMin, priceCents: t.priceCents, ...set }).where(eq(appointments.id, a.id));

class PreviewDone extends Error { constructor(readonly result: TransferPreview) { super("prévia"); } }

/**
 * A lista da tela (só lê): o que passa livre, o que a cliente pediu a de antes (desmarcado de saída) e o que não cabe, com o motivo.
 * Confere em sequência, como o passar: o horário que vai para a nova ocupa a agenda dela para o próximo. Tudo numa transação desfeita.
 */
export async function previewTransferDay(raw: TransferPreviewInput, now = new Date()): Promise<TransferPreview> {
  const i = previewSchema.parse(raw);
  try {
    await db.transaction(async (tx) => {
      const names = await startTx(tx, i, now);
      const list = await dayRowsTx(tx, i.fromProfessionalId, i.day);
      const rows = await rowsOf(tx, list);
      const out: TransferPreview = { movable: [], askedForHer: [], blocked: [] };
      for (const a of list) {
        const v = await verdictTx(tx, a, i.toProfessionalId, names.to, now);
        if (!v.ok) { out.blocked.push({ ...rows.get(a.id)!, reason: v.reason }); continue; }
        (a.preference === "escolhida" ? out.askedForHer : out.movable).push(rows.get(a.id)!);
        await moveTx(tx, a, i.toProfessionalId, v.terms);
      }
      throw new PreviewDone(out);
    });
  } catch (e) {
    if (e instanceof PreviewDone) return e.result;
    throw e;
  }
  throw new Error("prévia sem resultado");
}

/**
 * Passa os horários escolhidos (Fase C, item 23b). Cada um é conferido de novo, depois de travar a agenda das duas e das clientes: o que
 * mudou, não cabe livre ou é "Pediu ela" sem o tique fica em `skipped` com o motivo. Audita `agendamento_passado` (de, para) e avisa
 * as duas profissionais no app.
 */
export async function transferDay(raw: TransferInput, actor: Actor, now = new Date()): Promise<TransferResult> {
  const i = transferSchema.parse(raw);
  const wanted = [...new Set(i.appointmentIds)];
  const r = await db.transaction(async (tx) => {
    const names = await startTx(tx, i, now);
    const clients = wanted.length ? await tx.select({ contactId: appointments.contactId }).from(appointments).where(inArray(appointments.id, wanted)) : [];
    // Trava a agenda das duas e das clientes no dia, numa ordem só (evita impasse), antes de reler o banco.
    const keys = new Set(agendaLockKeys({ professionalIds: [i.fromProfessionalId, i.toProfessionalId], contactId: null, days: [i.day] }));
    for (const c of clients) for (const k of agendaLockKeys({ professionalIds: [], contactId: c.contactId, days: [i.day] })) keys.add(k);
    for (const k of [...keys].sort()) await lockKeyTx(tx, k);
    const list = wanted.length ? await dayRowsTx(tx, i.fromProfessionalId, i.day, { ids: wanted, lock: true }) : [];
    const found = new Set(list.map((a) => a.id));
    const skipped: TransferResult["skipped"] = wanted.filter((id) => !found.has(id)).map((id) => ({ appointmentId: id, reason: `Esse horário não está mais com a ${names.from} nesse dia.` }));
    let moved = 0;
    for (const a of list) {
      if (a.preference === "escolhida" && !i.confirmAskedForHer) { skipped.push({ appointmentId: a.id, reason: `Ela pediu a ${names.from}.` }); continue; }
      const v = await verdictTx(tx, a, i.toProfessionalId, names.to, now);
      if (!v.ok) { skipped.push({ appointmentId: a.id, reason: v.reason }); continue; }
      await moveTx(tx, a, i.toProfessionalId, v.terms, { fitIn: false, fitInBy: null, outsideHours: false, anyPro: false, updatedBy: actor.id, updatedAt: now, crmTouchedAt: now });
      await tx.insert(auditLog).values({ userId: actor.id, action: "agendamento_passado", entity: "appointment", entityId: a.id, createdAt: now, data: {
        de: { profissional: a.professionalId, duracao: a.durationMin, preco: a.priceCents },
        para: { profissional: i.toProfessionalId, duracao: v.terms.durationMin, preco: v.terms.priceCents },
        dia: i.day, pediuEla: a.preference === "escolhida",
      } });
      await queueProNotificationsTx(tx, { kind: "remarcado", before: a, after: { ...a, professionalId: i.toProfessionalId } }, { actorId: actor.id, via: "recepcao", now });
      moved++;
    }
    const order = new Map(wanted.map((id, k) => [id, k]));
    skipped.sort((x, y) => order.get(x.appointmentId)! - order.get(y.appointmentId)!); // na ordem em que vieram da tela
    return { moved, skipped };
  });
  if (r.moved) await afterAgendaChange([i.day]);
  return r;
}
