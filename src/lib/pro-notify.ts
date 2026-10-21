/**
 * Avisos no celular da profissional: o que cada mudança da agenda avisa, o texto e quando sai. Puro (sem banco).
 * Quem grava é `queueProNotificationsTx` (src/server/domain/pro/notifications.ts), na mesma transação da mudança.
 */
import { bahiaParts, slotMs } from "./schedule";
import { shiftDay } from "./agenda";
import { firstName } from "./authorship";
import { minuteIn, titleCase } from "./pro-day";

export type NotifyKind = "novo" | "remarcado" | "cancelado" | "chegou" | "confirmou" | "folga_aprovada" | "folga_recusada";
/** O retrato de um horário que a porta do 6B tem em mãos (uma linha de `appointments` serve). */
export type ApptSnap = { id: string; professionalId: string | null; startsAt: Date; status: string; clientName: string | null; serviceLabel: string };
export type AgendaChange =
  | { kind: "novo"; appointment: ApptSnap }
  | { kind: "remarcado"; before: ApptSnap; after: ApptSnap }
  /** `appointment.status` = o status de ANTES de cancelar. */
  | { kind: "cancelado"; appointment: ApptSnap }
  /** `appointment.status` = o status NOVO; `from` = o de antes. */
  | { kind: "status"; from: string; appointment: ApptSnap };
export type NotifyDraft = { professionalId: string; kind: NotifyKind; appointmentId: string | null; title: string; body: string; url: string; noHold: boolean };

/** Mudanças que nunca avisam o celular: importação do Avec, scripts e migração (decisão 24). */
export const SILENT_VIA: ReadonlySet<string> = new Set(["avec", "script", "migracao"]);

const WEEKDAY = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
/** "sex 16/10 às 10:00" (Salvador). */
export function whenText(at: Date): string {
  const { date, time } = bahiaParts(at.getTime());
  return `${WEEKDAY[new Date(`${date}T12:00:00Z`).getUTCDay()]} ${date.slice(8, 10)}/${date.slice(5, 7)} às ${time}`;
}
const who = (s: ApptSnap) => firstName(s.clientName) ?? "Cliente";
const dayUrl = (s: ApptSnap) => `/pro/dia/${bahiaParts(s.startsAt.getTime()).date}?h=${s.id}`;

/** O que avisar e para quem. `names`: apelido das profissionais envolvidas (para "passou para a Bia"). */
export function planProNotifications(change: AgendaChange, ctx: { names: Record<string, string>; avisaConfirmacao: boolean }): NotifyDraft[] {
  const out: NotifyDraft[] = [];
  const add = (s: ApptSnap, proId: string | null, kind: NotifyKind, title: string, body: string, url = dayUrl(s), noHold = false) => {
    if (proId) out.push({ professionalId: proId, kind, appointmentId: s.id, title, body, url, noHold });
  };
  switch (change.kind) {
    case "novo": {
      const a = change.appointment;
      if (a.status !== "solicitado") add(a, a.professionalId, "novo", "Horário novo", `${who(a)} · ${a.serviceLabel} · ${whenText(a.startsAt)}`);
      break;
    }
    case "remarcado": {
      const { before: b, after: a } = change;
      if (b.professionalId === a.professionalId) {
        if (b.startsAt.getTime() !== a.startsAt.getTime()) add(a, a.professionalId, "remarcado", "Horário remarcado", `${who(a)}: era ${whenText(b.startsAt)}, agora ${whenText(a.startsAt)}`);
        break;
      }
      const para = a.professionalId && ctx.names[a.professionalId] ? `a ${titleCase(ctx.names[a.professionalId])}` : "outra profissional";
      add(b, b.professionalId, "remarcado", "Saiu da sua agenda", `${who(b)} saiu da sua agenda (passou para ${para})`, `/pro/dia/${bahiaParts(b.startsAt.getTime()).date}`);
      add(a, a.professionalId, "remarcado", "Horário novo", `${who(a)} passou para você: ${a.serviceLabel} · ${whenText(a.startsAt)}`);
      break;
    }
    case "cancelado": {
      const a = change.appointment;
      if (a.status !== "solicitado") add(a, a.professionalId, "cancelado", "Horário cancelado", `${who(a)} · ${a.serviceLabel} · ${whenText(a.startsAt)} foi cancelado`);
      break;
    }
    case "status": {
      const a = change.appointment;
      if (a.status === "chegou") add(a, a.professionalId, "chegou", "Sua cliente chegou", `${who(a)} chegou (${bahiaParts(a.startsAt.getTime()).time} · ${a.serviceLabel})`, `/pro/horario/${a.id}`, true);
      else if (a.status === "agendado" && change.from === "solicitado") add(a, a.professionalId, "novo", "Horário novo", `${who(a)} · ${a.serviceLabel} · ${whenText(a.startsAt)}`);
      else if (a.status === "confirmado" && ctx.avisaConfirmacao) add(a, a.professionalId, "confirmou", "Cliente confirmou", `${who(a)} confirmou ${whenText(a.startsAt)}`);
      break;
    }
  }
  return out;
}

/** Pedido de folga decidido pela recepção. */
export function leaveDecisionDraft(i: { professionalId: string; approved: boolean; period: string; note: string | null }): NotifyDraft {
  return i.approved
    ? { professionalId: i.professionalId, kind: "folga_aprovada", appointmentId: null, title: "Folga aprovada", body: `Sua folga de ${i.period} foi aprovada.`, url: "/pro/folga", noHold: false }
    : { professionalId: i.professionalId, kind: "folga_recusada", appointmentId: null, title: "Folga recusada", body: `Sua folga de ${i.period} não foi aprovada${i.note ? `: ${i.note}` : "."}`, url: "/pro/folga", noHold: false };
}

/** Uma mudança avisa uma vez: o horário (ou o pedido), o tipo, a profissional e o minuto. */
export const notifyDedupeKey = (d: { ref: string; kind: NotifyKind; professionalId: string }, now: Date) =>
  `${d.ref}:${d.kind}:${d.professionalId}:${now.toISOString().slice(0, 16)}`;

/**
 * Silêncio fora do expediente dela: o aviso espera o próximo início de faixa (hoje mais tarde ou nos próximos 14 dias).
 * Dentro de uma faixa não espera (null). Sem faixa nenhuma em 14 dias também não espera.
 */
export function holdUntil(nowMs: number, rangesFor: (day: string) => [number, number][]): Date | null {
  const today = bahiaParts(nowMs).date;
  const nowMin = minuteIn(nowMs);
  for (let k = 0; k <= 14; k++) {
    const day = shiftDay(today, k);
    for (const [s, e] of [...rangesFor(day)].sort((a, b) => a[0] - b[0])) {
      if (k === 0 && nowMin >= s && nowMin < e) return null;
      if (k === 0 && s <= nowMin) continue;
      return new Date(slotMs(day, "00:00") + s * 60_000);
    }
  }
  return null;
}
