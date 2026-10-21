"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertPerm, type SessionUser } from "@/server/auth/session";
import type { Perm } from "@/lib/permissions";
import { APPOINTMENT_MARKS, setAppointmentStatus, undoAppointmentStatus, updateAppointmentNotes, type AppointmentMark } from "@/server/domain/appointments";
import { cancelAppointments, createVisit, ExistingAppointmentError, rescheduleAppointment, type CancelInput, type CreateVisitInput, type CreateVisitResult, type RescheduleInput } from "@/server/domain/agenda/visits";
import { addToWaitlist, resolveWaitlist, waitlistMatchesFor, waitlistToReschedule, type AddWaitlistInput, type ResolveWaitlistInput } from "@/server/domain/agenda/waitlist";
import { saveAgendaPrefs } from "@/server/domain/user-prefs";
import { rescheduledDraft } from "@/server/domain/client-link/reminder";
import type { AgendaPrefs } from "@/lib/agenda-view-prefs";
import { previewBooking, type FreeSlotsQuery } from "@/server/domain/agenda/slots";
import { previewAuxiliaries } from "@/server/domain/agenda/appointment-assistants";
import { clientAgenda, searchAgendaClients } from "@/server/queries/agenda-clients";
import { peopleOnNumber } from "@/server/domain/people-on-number";
import { createBlock, deleteBlock, updateBlock } from "@/server/domain/agenda/blocks";
import { nextFreeSlots, type NextFree } from "@/server/domain/agenda/availability";
import { BLOCK_REASONS, type ClientInside } from "@/lib/agenda-blocks";
import { userErrorMessage } from "@/server/user-error";
import { createClientLink } from "@/server/domain/client-link/links";
import { dayVisitFor } from "@/server/queries/day-visit";
import { getAgendaMode } from "@/server/domain/agenda/mode";
import { cancelarNoLugarDaFalta, lerEscolhaFalta, semRemarcarDoHorario } from "@/server/domain/falta-escolha";
import { can } from "@/lib/permissions";
import { setAppointmentLabel, setVisitType } from "@/server/domain/agenda/labels";
import { VISIT_TYPES, type VisitType } from "@/lib/visit-type";
import { createRecurringVisits, type RecurringInput, type RecurringResult } from "@/server/domain/agenda/recurrence";
import { previewTransferDay, transferDay, type TransferInput, type TransferPreviewInput } from "@/server/domain/agenda/transfer-day";

export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };
type Refused = { ok: false; error: string; openAppointment?: { id: string; day: string } };
export type BookingActionResult = { ok: true; data: CreateVisitResult } | Refused;

/** Quem age é sempre a pessoa da sessão (6.7): a tela nunca manda o autor. */
const actorOf = (u: SessionUser) => ({ id: u.id, perms: u.perms });
const uuid = (v: string) => z.string().uuid().parse(v);

async function run<T>(perm: Perm, fn: (u: SessionUser) => Promise<T>, opts: { fallback?: string; revalidate?: boolean } = {}): Promise<ActionResult<T>> {
  try {
    const u = await assertPerm(perm);
    const data = await fn(u);
    if (opts.revalidate !== false) revalidatePath("/agenda");
    return { ok: true, data };
  } catch (e) { return { ok: false, error: userErrorMessage(e, "agenda", opts.fallback ?? "Não foi possível registrar. Tente de novo.") }; }
}

const NEEDS_PREFERENCE = "Diga se ela quer uma profissional ou tanto faz.";
/** A tela obriga a escolha (6.11); o servidor também (esconder não basta). A importação e a migração não passam por aqui. */
const lacksPreference = (b: { items?: { preference?: string | null }[] } | undefined) => !!b?.items?.some((i) => i.preference !== "escolhida" && i.preference !== "sem_preferencia");

const refused = (e: unknown): Refused =>
  e instanceof ExistingAppointmentError
    ? { ok: false, error: e.message, openAppointment: { id: e.appointmentId, day: e.day } }
    : { ok: false, error: userErrorMessage(e, "agenda", "Não foi possível marcar. Tente de novo.") };

/** Marcar (6.1). O servidor decide conflito, encaixe e o modo da agenda. */
export async function createVisitAction(input: CreateVisitInput): Promise<BookingActionResult> {
  try {
    const u = await assertPerm("agenda.marcar");
    if (lacksPreference(input)) return { ok: false, error: NEEDS_PREFERENCE };
    if ((input.labelId || input.visitType) && !can(u.perms, "agenda.marcador")) return { ok: false, error: "Você não tem permissão para isso." };
    const data = await createVisit(input, actorOf(u));
    revalidatePath("/agenda");
    return { ok: true, data };
  } catch (e) { return refused(e); }
}

/**
 * Repetir (Fase C, item 23a): a mesma visita a cada X semanas. Permissão própria `agenda.repetir` (além de `agenda.marcar`); a função
 * ligada, o modo da agenda e os limites da Casa o domínio confere. Volta o que foi marcado e o que não coube.
 */
export async function createRecurringVisitsAction(input: RecurringInput): Promise<{ ok: true; data: RecurringResult } | Refused> {
  try {
    const u = await assertPerm("agenda.marcar");
    if (!can(u.perms, "agenda.repetir")) return { ok: false, error: "Você não tem permissão para isso." };
    if (lacksPreference(input)) return { ok: false, error: NEEDS_PREFERENCE };
    if ((input.labelId || input.visitType) && !can(u.perms, "agenda.marcador")) return { ok: false, error: "Você não tem permissão para isso." };
    const data = await createRecurringVisits(input, actorOf(u));
    revalidatePath("/agenda");
    return { ok: true, data };
  } catch (e) { return refused(e); }
}

/** Encaixar um pedido da lista de espera (pela porta de marcar) ou marcar que desistiu. */
export async function resolveWaitlistAction(id: string, input: ResolveWaitlistInput): Promise<{ ok: true; data: { appointmentIds: string[] } } | Refused> {
  try {
    const u = await assertPerm("agenda.marcar");
    if (input.result === "encaixada" && lacksPreference(input.booking)) return { ok: false, error: NEEDS_PREFERENCE };
    const data = await resolveWaitlist(uuid(id), input, actorOf(u));
    revalidatePath("/agenda");
    return { ok: true, data };
  } catch (e) { return refused(e); }
}

export const rescheduleAction = async (id: string, input: RescheduleInput) => run("agenda.marcar", (u) => rescheduleAppointment(uuid(id), input, actorOf(u)));
export const cancelAction = async (input: CancelInput) => run("agenda.marcar", async (u) => {
  const r = await cancelAppointments(input, actorOf(u));
  return { ...r, waitlist: (await waitlistMatchesFor(r.day)).length };
});
/**
 * Confirmar, Chegou, Iniciar e aceitar pedido do site: quem vê a agenda. QA r66 (I-7): Finalizar (dispara o "Depois do atendimento") e Faltou
 * pedem a mesma permissão do Desfazer (agenda.marcar).
 */
export const setAppointmentStatusAction = async (id: string, status: AppointmentMark) =>
  run(status === "compareceu" || status === "faltou" ? "agenda.marcar" : "atendimento.ver", async (u) => {
    const apptId = uuid(id);
    const mark = z.enum(APPOINTMENT_MARKS).parse(status);
    // "Faltou" pergunta o que houve (20/10): cancelou (vira Cancelado) e/ou não é para remarcar agora.
    const escolha = mark === "faltou" ? await lerEscolhaFalta() : null;
    if (escolha?.t === "cancelou") { await cancelarNoLugarDaFalta(apptId, actorOf(u)); if (!escolha.r) await semRemarcarDoHorario(apptId, u.id); return { changed: true }; }
    const r = await setAppointmentStatus(apptId, mark, u.id, { via: "recepcao" });
    if (escolha && !escolha.r) await semRemarcarDoHorario(apptId, u.id);
    return r;
  });
/** Marcador e tipo do horário (Fase C, item 19): permissão própria `agenda.marcador`; a função ligada e o valor em uso o domínio confere. */
export const setAppointmentLabelAction = async (id: string, labelId: string | null) =>
  run("agenda.marcador", (u) => setAppointmentLabel(uuid(id), labelId == null ? null : uuid(labelId), actorOf(u)));
export const setVisitTypeAction = async (id: string, type: VisitType | null) =>
  run("agenda.marcador", (u) => setVisitType(uuid(id), type == null ? null : z.enum(VISIT_TYPES).parse(type), actorOf(u)));
/**
 * Passar o dia (Fase C, item 23b): permissão própria `agenda.passar_dia` (no lugar de agenda.marcar); a função ligada, o modo da agenda e
 * o motor o domínio confere. A prévia só lê.
 */
export const previewTransferDayAction = async (input: TransferPreviewInput) =>
  run("agenda.passar_dia", () => previewTransferDay(input, new Date()), { revalidate: false, fallback: "Não deu para ver os horários do dia. Tente de novo." });
export const transferDayAction = async (input: TransferInput) =>
  run("agenda.passar_dia", (u) => transferDay(input, actorOf(u), new Date()), { fallback: "Não deu para passar o dia. Tente de novo." });
export const undoStatusAction = async (id: string) => run("agenda.marcar", (u) => undoAppointmentStatus(uuid(id), actorOf(u)));
export const notesAction = async (id: string, notes: string | null) => run("agenda.marcar", (u) => updateAppointmentNotes(uuid(id), notes, u.id));
export const waitlistAction = async (input: AddWaitlistInput) => run("agenda.marcar", (u) => addToWaitlist(input, actorOf(u)));
/** Prévia do Marcar: só lê. Fica com quem marca (5.7). */
export const freeSlotsAction = async (q: FreeSlotsQuery) => run("agenda.marcar", () => previewBooking(q, new Date()), { fallback: "Não foi possível ver os horários livres.", revalidate: false });
/** 0089: a agenda das auxiliares escolhidas no período do serviço (prévia da folha; quem decide é o Marcar). */
export const auxPreviewAction = async (q: { assistantIds: string[]; startsAt: string; durationMin: number | null; serviceId?: string | null; ignoreAppointmentId?: string | null }) =>
  run("agenda.marcar", () => previewAuxiliaries({ ...q, assistantIds: z.array(z.string()).max(20).parse(q.assistantIds) }, new Date()), { fallback: "Não foi possível ver a agenda das auxiliares.", revalidate: false });
/** Nome, telefone e última visita: só para quem atende (6.7). */
export const searchClientsAction = async (q: string) => run("atendimento.ver", () => searchAgendaClients(z.string().max(80).parse(q)), { revalidate: false });
/** Marcar horário: as pessoas do número da cliente escolhida (titular e quem mais usa o número, 0051), para escolher de quem é o horário. */
export const peopleOnNumberAction = async (contactId: string) => run("atendimento.ver", async () => (await peopleOnNumber(uuid(contactId)))?.people ?? [], { revalidate: false });
export const clientAgendaAction = async (contactId: string) => run("atendimento.ver", () => clientAgenda(uuid(contactId)), { revalidate: false });

/* ───────────── Lote 6A: bloqueios e Procurar horário (quem marca: agenda.marcar) ───────────── */

const blockInput = z.object({
  professionalId: z.string().uuid("Escolha a profissional.").nullable(),
  startsOn: z.string().max(10), endsOn: z.string().max(10), startTime: z.string().max(5), endTime: z.string().max(5),
  weekdays: z.array(z.number().int()).max(7).nullable(),
  reason: z.enum(BLOCK_REASONS, "Escolha o motivo do bloqueio."),
  note: z.string().max(300).nullish(),
});

/** Cria (id null) ou edita um bloqueio. Devolve as clientes marcadas dentro (o bloqueio não mexe nelas). */
export async function saveBlockAction(id: string | null, input: z.input<typeof blockInput>): Promise<ActionResult<{ clientsInside: ClientInside[] }>> {
  try {
    const user = await assertPerm("agenda.marcar");
    const v = blockInput.parse(input);
    const r = id ? await updateBlock(z.string().uuid().parse(id), v, user.id) : await createBlock(v, user.id);
    revalidatePath("/agenda");
    return { ok: true, data: { clientsInside: r.clientsInside } };
  } catch (e) { return { ok: false, error: userErrorMessage(e, "agenda", "Não foi possível salvar o bloqueio. Tente de novo.") }; }
}

/** Apaga um bloqueio (só marca a data e quem apagou; vale também para os do Avec). */
export async function deleteBlockAction(id: string): Promise<ActionResult> {
  try {
    const user = await assertPerm("agenda.marcar");
    await deleteBlock(z.string().uuid().parse(id), user.id);
    revalidatePath("/agenda");
    return { ok: true };
  } catch (e) { return { ok: false, error: userErrorMessage(e, "agenda", "Não foi possível apagar o bloqueio. Tente de novo.") }; }
}

/** Procurar horário: só lê, mas fica com quem marca. Nunca devolve o nome de outra cliente. */
export async function findFreeSlotsAction(input: { serviceId: string; professionalId?: string | null }): Promise<ActionResult<NextFree>> {
  try {
    await assertPerm("agenda.marcar");
    const v = z.object({ serviceId: z.string().uuid("Escolha o serviço."), professionalId: z.string().uuid().nullish() }).parse(input);
    return { ok: true, data: await nextFreeSlots(v) };
  } catch (e) { return { ok: false, error: userErrorMessage(e, "agenda", "Não foi possível procurar agora. Tente de novo.") }; }
}

/**
 * Gera o link da cliente. Gerar não é enviar (`atendimento.ver`). Pela conversa, "Enviar link de confirmação" só preenche o texto.
 * Pelo card da Agenda, "Copiar link". O autor é sempre quem está logada.
 */
export async function createClientLinkAction(input: { appointmentId?: string; dealId?: string }): Promise<ActionResult<{ url: string; text: string }>> {
  try {
    const user = await assertPerm("atendimento.ver");
    const v = z.object({ appointmentId: z.string().uuid().optional(), dealId: z.string().uuid().optional() })
      .refine((x) => !!x.appointmentId !== !!x.dealId, "Escolha o horário ou a conversa.").parse(input);
    const r = await createClientLink({ ...v, via: v.dealId ? "conversa" : "agenda", actorId: user.id });
    return { ok: true, data: { url: r.url, text: r.text } };
  } catch (e) { return { ok: false, error: userErrorMessage(e, "link-cliente", "Não deu para gerar o link. Tente de novo.") }; }
}

/* ───────────── Nova Agenda › Dia (16/10) ───────────── */

/** Personalizar / visões: de quem está logada, nunca de outra pessoa. Não recarrega a página (a tela já mostra). */
export async function saveAgendaPrefsAction(prefs: AgendaPrefs): Promise<ActionResult<AgendaPrefs>> {
  try {
    const u = await assertPerm("atendimento.ver");
    return { ok: true, data: await saveAgendaPrefs(u.id, prefs) };
  } catch (e) { return { ok: false, error: userErrorMessage(e, "agenda", "Não deu para salvar a personalização. Tente de novo.") }; }
}

const moveInput = z.object({ startsAt: z.string().datetime({ offset: true }), professionalId: z.string().uuid(), confirmProChange: z.boolean().optional(), avisar: z.boolean().optional() });
/**
 * Arrastar (ou "Mover…") um horário para outra profissional ou hora: a mesma porta do Remarcar (conflito, folga, modo da agenda), mas
 * nunca manda mensagem sozinho. Com "Avisar a cliente", devolve o texto e a conversa para a tela PREENCHER (quem envia é a atendente).
 */
export const moveAppointmentAction = async (id: string, input: z.input<typeof moveInput>) => run("agenda.marcar", async (u) => {
  const v = moveInput.parse(input);
  const r = await rescheduleAppointment(uuid(id), { startsAt: v.startsAt, professionalId: v.professionalId, confirmProChange: v.confirmProChange }, actorOf(u), new Date(), { clientMessage: false });
  const draft = v.avisar ? await rescheduledDraft(uuid(id)).catch(() => null) : null;
  return { ...r, draft };
});

type Many = { done: string[]; failed: { id: string; error: string }[] };
/** Um por um (cada horário na sua transação): o que der certo fica, o que não der volta com o motivo. */
async function eachId(ids: string[], fn: (id: string) => Promise<unknown>): Promise<Many> {
  const out: Many = { done: [], failed: [] };
  for (const id of z.array(z.string().uuid()).min(1).max(100).parse(ids)) {
    try { await fn(id); out.done.push(id); } catch (e) { out.failed.push({ id, error: userErrorMessage(e, "agenda", "Não foi possível registrar.") }); }
  }
  return out;
}
/** Pendências › Sem baixa: "Veio" (Finalizado) ou "Faltou", um ou em lote. Mesma permissão do Compareceu/Faltou de um. */
export const markManyAction = async (ids: string[], status: "compareceu" | "faltou") =>
  run("atendimento.ver", async (u) => {
    const s = z.enum(["compareceu", "faltou"]).parse(status);
    const escolha = s === "faltou" ? await lerEscolhaFalta() : null;
    return eachId(ids, async (id) => {
      if (escolha?.t === "cancelou") { await cancelarNoLugarDaFalta(id, actorOf(u)); if (!escolha.r) await semRemarcarDoHorario(id, u.id); return { changed: true }; }
      const r = await setAppointmentStatus(id, s, u.id, { via: "recepcao" });
      if (escolha && !escolha.r) await semRemarcarDoHorario(id, u.id);
      return r;
    });
  });
/** O "Desfazer" do lote. */
export const undoManyAction = async (ids: string[]) => run("agenda.marcar", (u) => eachId(ids, (id) => undoAppointmentStatus(id, actorOf(u))));
/** Pendências › Sem baixa › "Remarcar": sai da agenda e vai para a lista de espera (um ou em lote). */
export const toWaitlistManyAction = async (ids: string[]) => run("agenda.marcar", (u) => eachId(ids, (id) => waitlistToReschedule(id, actorOf(u))));

/**
 * A visita do dia do horário (17/10): todos os serviços da cliente no dia, quem faz, início e fim, estado, valor (só com "valores.ver")
 * e a comanda do Caixa, quando existe. `canMark`/`agendaMode` dizem o que a tela oferece (Cancelar, Remarcar).
 */
export const dayVisitAction = async (appointmentId: string) => run("atendimento.ver", async (u) => ({
  visit: await dayVisitFor(uuid(appointmentId), { withValues: can(u.perms, "valores.ver") }),
  canMark: can(u.perms, "agenda.marcar"), agendaMode: await getAgendaMode(),
}), { revalidate: false, fallback: "Não deu para abrir a visita. Tente de novo." });
