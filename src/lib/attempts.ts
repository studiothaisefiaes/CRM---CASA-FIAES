import { windowOfInstant, type BusinessHours } from "./business-hours";
import { bahiaAt } from "./next-action";
import { displayName } from "./display-name";
import { formatPhoneClient } from "./phone-client";

/**
 * Tentativas de retomar a cliente (Lote 1C, decisão do dono de 15/10). Puro: servidor e navegador.
 * Nunca há envio automático: cada tentativa é uma próxima ação (combinado) que vira aviso no dia.
 */
/** Etapas em que ENTRAR já começa as tentativas (Orçamento; "followup" é a antiga Aguardando cliente, só para o histórico). */
export const WAITING_KINDS = ["followup", "proposta"] as const;
/**
 * Etapas em que as tentativas podem correr. Desde a nova organização (16/10) "Aguardando cliente" saiu: esperar a cliente é um estado
 * de Em conversa (`followupAttempt` > 0), começado pelo Retomar ou pela automação "a Casa falou por último", nunca só por entrar na etapa.
 */
export const ATTEMPT_KINDS = ["followup", "proposta", "atendimento"] as const;
export type WaitingKind = (typeof ATTEMPT_KINDS)[number];
export const isWaitingKind = (k: string | null | undefined): k is (typeof WAITING_KINDS)[number] => (WAITING_KINDS as readonly string[]).includes(k ?? "");
export const isAttemptKind = (k: string | null | undefined): k is WaitingKind => (ATTEMPT_KINDS as readonly string[]).includes(k ?? "");

export const MAX_ATTEMPTS = 3;
/** Dias depois de entrar na etapa. Aguardando cliente: D+1, D+3, D+7. Orçamento enviado: começa em 2 dias e mantém o espaçamento. */
export const ATTEMPT_DAYS: Record<WaitingKind, readonly [number, number, number]> = { followup: [1, 3, 7], atendimento: [1, 3, 7], proposta: [2, 4, 8] };
/** Os 3 dias das tentativas da etapa: os de Configurações › Etapas (Lote 4) ou o padrão do tipo. Lista torta vale o padrão. */
export function attemptDaysOf(kind: WaitingKind, custom: readonly number[] | null | undefined): readonly [number, number, number] {
  if (custom && custom.length === MAX_ATTEMPTS && custom.every((d, i) => Number.isInteger(d) && d >= 1 && d <= 60 && (i === 0 || d > custom[i - 1]))) {
    return [custom[0], custom[1], custom[2]];
  }
  return ATTEMPT_DAYS[kind];
}
/** Depois da 3ª tentativa: dias de expediente para a cliente responder antes de virar Perdido "Não respondeu mais". */
export const LAST_REPLY_DAYS = 2;
/** Perdido "Não respondeu mais" volta a ser lembrado nesse prazo (só na 1ª vez). */
export const RECONTACT_DAYS = 30;
export const ATTEMPT_HOUR = 10;

/**
 * Quando cai a tentativa: `days` dias depois do dia de `fromMs`, às 10h de Salvador. Dia com a Casa fechada passa para o próximo
 * dia aberto; se a Casa abre depois das 10h, vale a abertura. Sem nenhum dia aberto na semana, fica no dia calculado.
 */
export function attemptDueAt(fromMs: number, days: number, hours: BusinessHours): Date {
  for (let extra = 0; extra < 7; extra++) {
    const midnight = bahiaAt(fromMs, days + extra, 0);
    const span = windowOfInstant(midnight.getTime() + 1, hours);
    if (!span) continue;
    const [oh, om] = span[0].split(":").map(Number);
    const at = Math.max(ATTEMPT_HOUR * 60, oh * 60 + om);
    return bahiaAt(fromMs, days + extra, Math.floor(at / 60), at % 60);
  }
  return bahiaAt(fromMs, days, ATTEMPT_HOUR);
}

/** Primeiro nome da cliente para títulos de tarefa; sem nome, "a cliente". */
/** Contato sem nome guarda o telefone no nome: no título vira "(71) 99000-0002", nunca o número cru. */
const isPhoneLike = (s: string) => /^\+?[\d\s()-]{8,}$/.test(s);
/** O nome inteiro para títulos de combinado: em Título ("WANDA REZENDE" → "Wanda Rezende") ou o telefone formatado. */
export const clientFullName = (name: string | null | undefined): string => {
  const n = name?.trim();
  if (!n) return "a cliente";
  return isPhoneLike(n) ? formatPhoneClient(n.startsWith("+") ? n : `+${n.replace(/\D/g, "")}`) : displayName(n);
};
/** O 1º nome para títulos de combinado ("Retomar contato com Thamires"); telefone sai inteiro e formatado. */
export const clientFirstName = (name: string | null | undefined): string => {
  const full = clientFullName(name);
  return full === "a cliente" || /^\(/.test(full) || full.startsWith("+") ? full : full.split(/\s+/)[0];
};

export const attemptTitle = (n: number, name: string | null | undefined) =>
  `Tentativa ${n} de ${MAX_ATTEMPTS}: retomar contato com ${clientFirstName(name)}`;

/**
 * Quando a conversa vira Perdido "Não respondeu mais" se ninguém responder: com as 3 feitas é a data guardada (`dueMs`);
 * antes, a 3ª tentativa prevista (a atual, se for a 3ª) mais os 2 dias da última resposta. É a previsão da linha da Fila.
 */
export function projectedLostAt(o: { attempt: number; dueMs: number | null; startedMs: number; days: readonly [number, number, number] }, hours: BusinessHours): Date | null {
  if (o.attempt <= 0) return null;
  if (o.attempt > MAX_ATTEMPTS) return o.dueMs != null ? new Date(o.dueMs) : null;
  const planned3 = attemptDueAt(o.startedMs, o.days[MAX_ATTEMPTS - 1], hours).getTime();
  const third = o.attempt === MAX_ATTEMPTS && o.dueMs != null ? o.dueMs : Math.max(planned3, o.dueMs ?? 0);
  return attemptDueAt(third, LAST_REPLY_DAYS, hours);
}

/** A linha da Fila e do painel: "Tentativa 2 de 3 · vira Perdido sex" (`dayWord` diz o dia). Nada muda de etapa sem esse aviso antes. */
export function attemptLine(attempt: number, lostDay: string | null): string | null {
  if (attempt <= 0) return null;
  const head = attempt > MAX_ATTEMPTS ? `${MAX_ATTEMPTS} tentativas feitas` : `Tentativa ${attempt} de ${MAX_ATTEMPTS}`;
  return lostDay ? `${head} · vira Perdido ${lostDay}` : head;
}

/** Selo do card: "Tentativa 1/3"; depois das 3, "3/3 · esperando a última resposta". 0 = sem selo. */
export function attemptLabel(attempt: number): string | null {
  if (attempt <= 0) return null;
  if (attempt > MAX_ATTEMPTS) return `${MAX_ATTEMPTS}/${MAX_ATTEMPTS} · esperando a última resposta`;
  return `Tentativa ${attempt}/${MAX_ATTEMPTS}`;
}
