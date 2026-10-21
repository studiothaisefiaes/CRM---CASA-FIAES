/**
 * O ciclo de vida de um horário (Lote 6B, spec 4.3): que status existem, quais ocupam a agenda e quais mudanças são permitidas.
 * Função pura: o servidor confere (porta única, `setAppointmentStatus`) e a tela usa para mostrar o próximo passo.
 * "Finalizado" na tela é `compareceu` no banco (o 1C lê esse valor para levar a conversa a Atendida).
 */
import { dayOf } from "./agenda";

export const APPT_STATUSES = ["espera", "solicitado", "agendado", "confirmado", "chegou", "em_atendimento", "compareceu", "faltou", "cancelado", "espera_encaixada", "espera_desistiu", "conferir"] as const;
export type ApptStatus = (typeof APPT_STATUSES)[number];
/**
 * Ocupam a agenda: não deixam marcar outro horário por cima. `conferir` (17/10): situação do Avec que o CRM não conhece; o Avec diz que tem
 * alguém ali, então ocupa, mas não é "ativo" (sem lembrete, sem Sem baixa, fora do Hoje) até a recepção resolver.
 */
export const OCCUPYING_STATUSES: readonly string[] = ["solicitado", "agendado", "confirmado", "chegou", "em_atendimento", "compareceu", "conferir"];
/** Ainda vão acontecer ou estão acontecendo: dá para remarcar, cancelar, abrir comanda. */
export const ACTIVE_STATUSES: readonly string[] = ["solicitado", "agendado", "confirmado", "chegou", "em_atendimento"];

/** O que a porta única de status aceita. Cancelar tem a própria porta (exige motivo); voltar atrás é Desfazer. */
export const APPOINTMENT_MARKS = ["confirmado", "chegou", "em_atendimento", "compareceu", "faltou", "agendado"] as const;
export type AppointmentMark = (typeof APPOINTMENT_MARKS)[number];
export type ApptVia = "recepcao" | "profissional" | "link" | "enquete" | "comanda" | "sistema";
export type TransitionCheck = { ok: true } | { ok: false; error: string };

/** Marcar hoje: a partir de 15 min atrás (6.4, regra 8). */
export const START_GRACE_MIN = 15;
/** A profissional só marca falta 15 min depois do início. */
export const NO_SHOW_PRO_GRACE_MIN = 15;

export const STEP_LABEL: Record<AppointmentMark, string> = {
  confirmado: "Confirmar", chegou: "Chegou", em_atendimento: "Iniciar", compareceu: "Finalizar", faltou: "Faltou", agendado: "Aceitar o pedido",
};

const OK: TransitionCheck = { ok: true };
const no = (error: string): TransitionCheck => ({ ok: false, error });
/** Ainda sem desfecho: Chegou, Iniciar, Finalizar e Faltou valem para eles (`conferir` incluído: a recepção resolve o que o Avec disse). */
const PLANNED = ["agendado", "confirmado", "conferir"];

export function checkTransition(from: string, to: AppointmentMark, ctx: { startsAt: Date; now: Date; via: ApptVia }): TransitionCheck {
  if (from === "espera") return no("Esse pedido está na lista de espera: marque um horário antes.");
  const started = ctx.now.getTime() >= ctx.startsAt.getTime();
  const sameDay = dayOf(ctx.now) === dayOf(ctx.startsAt);
  if (ctx.via === "comanda") return to === "compareceu" && [...PLANNED, "chegou", "em_atendimento"].includes(from) ? OK : no("A comanda só finaliza horários que ainda estão abertos.");
  switch (to) {
    case "confirmado":
      if (from !== "agendado") return no(from === "solicitado" ? "Aceite o pedido antes de confirmar." : "Só dá para confirmar um horário agendado.");
      return started ? no("Esse horário já começou: não dá mais para confirmar.") : OK;
    case "chegou":
      if (!PLANNED.includes(from)) return no("Só dá para marcar Chegou num horário agendado ou confirmado.");
      return sameDay ? OK : no("Só dá para marcar Chegou no dia do horário.");
    case "em_atendimento":
      if (from === "chegou") return OK;
      if (!PLANNED.includes(from)) return no("Só dá para iniciar um horário agendado, confirmado ou com a cliente já aqui.");
      return sameDay ? OK : no("Só dá para iniciar no dia do horário.");
    case "compareceu":
      if (from === "chegou" || from === "em_atendimento") return OK;
      if (!PLANNED.includes(from)) return no("Só dá para finalizar um horário que ainda está aberto.");
      return started ? OK : no("Só dá para finalizar depois do horário de início.");
    case "faltou": {
      if (!PLANNED.includes(from)) return no("Só dá para marcar falta num horário agendado ou confirmado.");
      const grace = ctx.via === "profissional" ? NO_SHOW_PRO_GRACE_MIN : 0;
      if (ctx.now.getTime() < ctx.startsAt.getTime() + grace * 60_000) return no(grace ? `Só dá para marcar falta ${grace} min depois do horário.` : "Só dá para marcar falta depois do horário");
      return OK;
    }
    case "agendado":
      return from === "solicitado" ? OK : no("Para voltar atrás, use Desfazer.");
  }
}

export function checkCancel(from: string): TransitionCheck {
  if (from === "espera") return no("Esse pedido está na lista de espera: use Desistiu.");
  if (["agendado", "confirmado", "chegou", "solicitado", "conferir"].includes(from)) return OK;
  if (from === "em_atendimento") return no("A cliente já está em atendimento: finalize ou desfaça antes.");
  if (from === "cancelado") return no("Esse horário já está cancelado.");
  return no("Esse horário já foi encerrado e não pode ser cancelado.");
}

/** O próximo passo em destaque no card: Confirmar (antes do dia), Chegou (no dia), Iniciar, Finalizar. */
export function nextStep(a: { status: string; startsAt: Date }, now: Date): AppointmentMark | null {
  const sameDay = dayOf(now) === dayOf(a.startsAt);
  const started = now.getTime() >= a.startsAt.getTime();
  switch (a.status) {
    case "solicitado": return "agendado";
    case "agendado": return started ? "compareceu" : sameDay ? "chegou" : "confirmado";
    case "confirmado": case "conferir": return started ? "compareceu" : sameDay ? "chegou" : null;
    case "chegou": return "em_atendimento";
    case "em_atendimento": return "compareceu";
    default: return null;
  }
}

export const canMarkNoShow = (a: { status: string; startsAt: Date }, now: Date, via: ApptVia = "recepcao") =>
  checkTransition(a.status, "faltou", { startsAt: a.startsAt, now, via }).ok;

export const CANCEL_REASONS = ["cliente_desmarcou", "casa_desmarcou", "nao_confirmou", "engano", "remarcado", "recusado", "outro"] as const;
export type CancelReason = (typeof CANCEL_REASONS)[number];
export const CANCEL_REASON_LABEL: Record<CancelReason, string> = {
  cliente_desmarcou: "A cliente desmarcou", casa_desmarcou: "A Casa desmarcou", nao_confirmou: "Não confirmou", engano: "Marcado por engano",
  remarcado: "Remarcado", recusado: "Pedido recusado", outro: "Outro",
};
/** Os que a recepção escolhe na tela (6.1). */
export const RECEPTION_CANCEL_REASONS: CancelReason[] = ["cliente_desmarcou", "casa_desmarcou", "nao_confirmou", "engano", "outro"];

export const WAIT_WINDOWS = ["manha", "tarde", "dia"] as const;
export type WaitWindow = (typeof WAIT_WINDOWS)[number];
export const WAIT_WINDOW_LABEL: Record<WaitWindow, string> = { manha: "Manhã", tarde: "Tarde", dia: "Dia todo" };

/** Para comparar com o Avec: o Avec não conhece Chegou nem Em atendimento, então tudo o que ainda está aberto é "ativo". */
export function statusGroup(status: string | null | undefined): "ativo" | "feito" | "faltou" | "cancelado" | "outro" {
  if (!status) return "outro";
  if (ACTIVE_STATUSES.includes(status)) return "ativo";
  if (status === "compareceu") return "feito";
  if (status === "faltou" || status === "cancelado") return status;
  return "outro";
}
