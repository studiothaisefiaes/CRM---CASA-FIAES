/**
 * A visita do dia (17/10, pedido do dono: "uma comanda de tudo que a pessoa vai fazer hoje"): uma por cliente e dia, nunca repetida por
 * serviço, com os horários da Agenda e, quando existe, a comanda do Caixa dela (valores e pago). Não é outra comanda: a comanda continua
 * sendo a do Caixa (`comandas`, 6C). Puro (servidor e tela): coluna do quadro do Hoje, atraso para chegar, total e progresso.
 */
import type { ViewStatus } from "./agenda-day";
import { dayOf, minuteOfDay } from "./agenda";
import { isGenericClientName } from "./generic-client";

export type DayVisitService = {
  appointmentId: string; serviceId: string | null; service: string; professionalId: string | null;
  /** Quem atende para a cliente (a principal, quando quem faz é assistente). */ pro: string | null;
  /** Quem faz de fato, quando é assistente da `pro` ("assistente: Sidney"). */ assistant: string | null;
  start: string; end: string | null; status: string; priceCents: number | null;
  /** Chegou ou Começou (o que veio primeiro): o "Na Casa desde". */ arrivedAt?: string | null;
  /** Quando foi cancelado: cancelado de outro dia não conta em "Não veio". */ cancelledAt?: string | null;
};
export type DayVisit = {
  /** contato (ou nome, sem ficha) + dia */ key: string; visitId: string | null; contactId: string | null; dealId: string | null; name: string; day: string;
  /** Hora de entrada: o primeiro serviço. */ entry: string;
  /** Os serviços da visita (sem os cancelados). */ services: DayVisitService[];
  /** Os cancelados do dia (a visita só deles vai para "Não veio"). */ cancelled: DayVisitService[];
  /** A comanda do Caixa da visita, quando existe (aberta ou fechada). */ comanda: { id: string; number: number; status: string } | null;
  /** false: quem vê não tem "valores.ver" (os preços vêm vazios). */ values: boolean;
};
export type VisitColumn = "a_chegar" | "na_casa" | "finalizou" | "nao_veio";

const PLANNED = new Set(["agendado", "confirmado", "solicitado"]);
const IN_HOUSE = new Set(["chegou", "em_atendimento"]);

export function visitColumn(c: DayVisit): VisitColumn {
  const st = c.services.map((s) => s.status);
  if (!st.length || st.every((x) => x === "faltou")) return "nao_veio";
  if (st.some((x) => IN_HOUSE.has(x))) return "na_casa";
  const done = st.some((x) => x === "compareceu");
  if (st.some((x) => PLANNED.has(x))) return done ? "na_casa" : "a_chegar";
  return "finalizou";
}

/** Minutos de atraso para chegar: só em "A chegar", quando já passou da hora de entrada sem Chegou. */
export function visitLateMin(c: DayVisit, nowMs: number): number | null {
  if (visitColumn(c) !== "a_chegar") return null;
  const min = Math.floor((nowMs - new Date(c.entry).getTime()) / 60_000);
  return min > 0 ? min : null;
}
/** "passou 47 min", "passou 2h47", "passou 3h": o texto discreto de quem passou da hora sem Chegou (a chegada ainda é marcada no Avec). */
export function passedText(min: number): string {
  if (min < 60) return `passou ${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  return `passou ${h}h${m ? String(m).padStart(2, "0") : ""}`;
}

/** Total dos serviços com preço; `missing` = quantos estão sem preço. Nenhum com preço: total null. */
export function visitTotal(c: DayVisit): { totalCents: number | null; missing: number } {
  const priced = c.services.filter((s) => s.priceCents != null);
  return { totalCents: priced.length ? priced.reduce((a, s) => a + s.priceCents!, 0) : null, missing: c.services.length - priced.length };
}
export function visitProgress(c: DayVisit): { done: number; running: number; total: number } {
  return { done: c.services.filter((s) => s.status === "compareceu").length, running: c.services.filter((s) => s.status === "em_atendimento").length, total: c.services.length };
}

/** A cor de cada serviço (as cores da Agenda, `VIEW_STATUS`), sem o "sem baixa": o atraso aparece só na linha da tabela do dia, em texto discreto. */
export function serviceView(status: string): ViewStatus {
  switch (status) {
    case "solicitado": return "pedido";
    case "confirmado": return "confirmado";
    case "chegou": return "chegou";
    case "em_atendimento": return "atendendo";
    case "compareceu": return "finalizado";
    case "faltou": return "faltou";
    case "cancelado": return "cancelado";
    default: return "marcado";
  }
}
/** O nome curto do estado na comanda. */
export const SERVICE_STATE: Partial<Record<ViewStatus, string>> = {
  marcado: "Marcado", pedido: "Pedido pelo site", confirmado: "Confirmado", chegou: "Chegou", atendendo: "Atendendo", finalizado: "Finalizado", faltou: "Faltou", cancelado: "Cancelado",
};

/* ---------- Hoje v3 (protótipo aprovado em 17/10): a tabela do dia e os números de "O dia na Casa" ---------- */

/** Espera do Avec (relatório Lista de espera) ou horário às 00:00 de Salvador: não é horário de verdade. */
const isWait = (s: DayVisitService) => s.status.startsWith("espera") || minuteOfDay(s.start) === 0;

/**
 * A régua única de quem entra no dia, para o Hoje (`dayTableVisits`) e o Ao vivo (`buildLiveBoard`): a CLIENTE PADRÃO do Avec sai
 * (null) e saem os serviços de espera e às 00:00. O status `conferir` já fica fora na consulta (`dayVisitsOf`). Os cancelados ficam
 * como vieram: cada tela decide (o Hoje mostra o cancelado de hoje como "Não veio"; o Ao vivo não mostra).
 */
export function visitOfDay(v: DayVisit): DayVisit | null {
  if (isGenericClientName(v.name)) return null;
  return { ...v, services: v.services.filter((s) => !isWait(s)), cancelled: v.cancelled.filter((s) => !isWait(s)) };
}

/**
 * Quem entra na tabela do dia e nos números: sem CLIENTE PADRÃO, sem espera às 00:00 e sem cancelado de outro dia (cancelou ontem o
 * horário de hoje: some; cancelou hoje: "Não veio"). A visita que fica vazia sai; a hora de entrada passa a ser o primeiro serviço real.
 */
export function dayTableVisits(visits: DayVisit[], day: string): DayVisit[] {
  const out: DayVisit[] = [];
  for (const raw of visits) {
    const v = visitOfDay(raw);
    if (!v) continue;
    const services = v.services;
    const cancelled = v.cancelled.filter((s) => !!s.cancelledAt && dayOf(s.cancelledAt) === day);
    if (!services.length && !cancelled.length) continue;
    out.push({ ...v, services, cancelled, entry: (services[0] ?? cancelled[0]).start });
  }
  return out.sort((a, b) => a.entry.localeCompare(b.entry) || a.name.localeCompare(b.name, "pt-BR"));
}

const HORA = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "America/Bahia" });
const paid = (v: DayVisit) => v.comanda?.status === "fechada";

/** A coluna Situação da tabela. `tone` é a cor da pílula (`VIEW_STATUS`); null quando é o texto discreto de atraso. */
export function visitSituation(v: DayVisit, nowMs: number, opts: { caixaOn: boolean }): { label: string; detail: string | null; late: boolean; tone: ViewStatus | null } {
  switch (visitColumn(v)) {
    case "a_chegar": {
      const late = visitLateMin(v, nowMs);
      if (late != null) return { label: `${passedText(late)}, sem Chegou`, detail: null, late: true, tone: null };
      const confirmed = v.services.every((s) => s.status === "confirmado");
      return { label: confirmed ? "Confirmada" : "Marcada", detail: null, late: false, tone: confirmed ? "confirmado" : "marcado" };
    }
    case "na_casa": {
      const stamps = v.services.map((s) => s.arrivedAt).filter((x): x is string => !!x).sort();
      const p = visitProgress(v);
      return { label: `Na Casa desde ${HORA.format(new Date(stamps[0] ?? v.entry))}`, detail: p.total > 1 ? `${p.done} de ${p.total} finalizados` : null, late: false, tone: "atendendo" };
    }
    case "finalizou":
      return { label: "Finalizado", detail: opts.caixaOn ? (paid(v) ? "paga" : "falta pagar") : null, late: false, tone: "finalizado" };
    default:
      return { label: "Não veio", detail: null, late: false, tone: "faltou" };
  }
}

/** O botão da linha: Chegou (a visita toda) para quem vai chegar; Receber só com o caixa no CRM e quem opera o caixa; senão Abrir. */
export function visitAction(v: DayVisit, opts: { caixaOn: boolean; canReceive: boolean }): "chegou" | "receber" | "abrir" {
  const col = visitColumn(v);
  if (col === "a_chegar") return "chegou";
  if (col === "finalizou" && opts.caixaOn && opts.canReceive && !paid(v)) return "receber";
  return "abrir";
}

/** Os números do bloco "O dia na Casa" e as 2 próximas chegadas (sem as que já passaram da hora). `toPay` só com o caixa no CRM. */
export function dayNumbers(visits: DayVisit[], nowMs: number, opts: { caixaOn: boolean }) {
  const col = (k: VisitColumn) => visits.filter((v) => visitColumn(v) === k);
  const done = col("finalizou");
  return {
    total: visits.length, inHouse: col("na_casa").length, toCome: col("a_chegar").length, done: done.length,
    toPay: opts.caixaOn ? done.filter((v) => !paid(v)).length : null, noShow: col("nao_veio").length,
    next: col("a_chegar").filter((v) => visitLateMin(v, nowMs) == null).slice(0, 2),
  };
}
