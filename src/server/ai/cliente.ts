import { and, desc, eq, gte, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { db } from "../db";
import { agendaBlocks, appointments, contactStats, messages, professionals } from "../db/schema";
import { getBusinessHours } from "../domain/hours";
import { shiftDay, todayBahia } from "@/lib/agenda";
import { windowOf, type BusinessHours } from "@/lib/business-hours";
import type { ClienteContext } from "./prompt";

/**
 * O que a IA precisa saber e não via (IA v3, 17/10), curto e só na parte que muda (fora do cache):
 * - se a cliente já é da Casa (visitas, última visita e serviço, última manutenção do Método);
 * - se ela já mandou fotos aqui e se a Casa já mandou estimativa de valor do Método (para não pedir de novo nem dar outro valor);
 * - as ausências das profissionais nos próximos 7 dias, pelos bloqueios da agenda ("Thaise Fiaes fora de 20 a 22/10").
 * `at`: o instante da conversa (na avaliação, o momento cortado: nada do futuro entra).
 */
export const FOTOS_DIAS = 30;
export const ESTIMATIVA_DIAS = 120;
export const AUSENCIA_DIAS = 7;
/** Bloqueio menor que isto num dia não é ausência (almoço, compromisso curto). */
export const AUSENCIA_MIN = 180;
const DAY = 86_400_000;
const ATTENDED = ["compareceu", "chegou", "em_atendimento", "conferir"];

export async function loadClienteContext(contactId: string, at: Date): Promise<ClienteContext> {
  const [[stats], [last], [manut], [fotos], [estimativa]] = await Promise.all([
    db.select({ visits: contactStats.visits, lastVisitOn: contactStats.lastVisitOn }).from(contactStats).where(eq(contactStats.contactId, contactId)),
    db.select({ startsAt: appointments.startsAt, label: appointments.serviceLabel }).from(appointments)
      .where(and(eq(appointments.contactId, contactId), lt(appointments.startsAt, at), inArray(appointments.status, ATTENDED))).orderBy(desc(appointments.startsAt)).limit(1),
    db.select({ startsAt: appointments.startsAt }).from(appointments)
      .where(and(eq(appointments.contactId, contactId), lt(appointments.startsAt, at), inArray(appointments.status, ATTENDED),
        sql`${appointments.serviceLabel} ~* 'manuten'`, sql`${appointments.serviceLabel} ~* '(m[eé]todo|fiaes)'`)).orderBy(desc(appointments.startsAt)).limit(1),
    db.select({ n: sql<number>`count(*)::int` }).from(messages)
      .where(and(eq(messages.contactId, contactId), eq(messages.direction, "in"), eq(messages.kind, "image"), lt(messages.createdAt, at), gte(messages.createdAt, new Date(at.getTime() - FOTOS_DIAS * DAY)))),
    db.select({ id: messages.id }).from(messages)
      .where(and(eq(messages.contactId, contactId), eq(messages.direction, "out"), lt(messages.createdAt, at), gte(messages.createdAt, new Date(at.getTime() - ESTIMATIVA_DIAS * DAY)),
        sql`${messages.body} like '%R$%'`,
        // "Fiaes" sozinho não serve: toda mensagem da equipe é assinada "*SARA - CASA FIAES:*" (20/10: qualquer valor, até de manicure,
        // virava "estimativa do Método"). A estimativa da Casa sempre diz "estimativa" ("segue uma estimativa do investimento…").
        sql`${messages.body} ~* 'estimativa'`)).limit(1),
  ]);
  const lastDay = last ? todayBahia(last.startsAt) : null;
  // Na avaliação (`at` no passado), a visita registrada depois não conta.
  const statsDay = stats?.lastVisitOn && stats.lastVisitOn < todayBahia(at) ? stats.lastVisitOn : null;
  const visitas = Math.max(statsDay ? stats!.visits : 0, last ? 1 : 0);
  const ultimaDia = [lastDay, statsDay].filter((x): x is string => !!x).sort().at(-1) ?? null;
  return {
    visitas,
    ultimaVisita: ultimaDia ? { dia: ultimaDia, servico: lastDay === ultimaDia ? last!.label?.trim() || null : null } : null,
    ultimaManutencaoMetodo: manut ? todayBahia(manut.startsAt) : null,
    fotos: fotos?.n ?? 0,
    estimativaMetodo: !!estimativa,
  };
}

export type BlocoAusencia = { pro: string; startsOn: string; endsOn: string; startTime: string; endTime: string; weekdays: number[] | null };
const minOf = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const hourText = (t: string) => { const m = minOf(t); return `${Math.floor(m / 60)}h${m % 60 ? String(m % 60).padStart(2, "0") : ""}`; };
const dm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const weekday = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay();
/** "THAISE FIAES" → "Thaise Fiaes" (até 2 palavras). */
const nomeBonito = (n: string) => n.trim().split(/\s+/).slice(0, 2).map((w) => w.charAt(0).toLocaleUpperCase("pt-BR") + w.slice(1).toLocaleLowerCase("pt-BR")).join(" ");

/**
 * As ausências, em pedaços curtos: dia inteiro vira faixa ("Thaise Fiaes fora de 20 a 22/10", dias com a Casa fechada no meio não quebram a faixa);
 * parte do dia, com o horário ("Ilma fora 24/10 das 13h às 18h"). Bloqueio curto (almoço) não entra. Módulo puro (testado).
 */
export function formatAusencias(blocos: BlocoAusencia[], today: string, hours: BusinessHours, dias = AUSENCIA_DIAS): string[] {
  const days = Array.from({ length: dias }, (_, i) => shiftDay(today, i));
  const open = (d: string) => windowOf(Date.parse(`${d}T00:00:00Z`), hours);
  const byPro = new Map<string, { full: Set<string>; partial: string[] }>();
  for (const b of blocos) {
    for (const d of days) {
      if (d < b.startsOn || d > b.endsOn || (b.weekdays?.length && !b.weekdays.includes(weekday(d)))) continue;
      const casa = open(d);
      if (!casa) continue; // Casa fechada: não é ausência
      const from = Math.max(minOf(b.startTime), minOf(casa[0])), to = Math.min(minOf(b.endTime), minOf(casa[1]));
      if (to - from < AUSENCIA_MIN) continue;
      const p = byPro.get(b.pro) ?? { full: new Set<string>(), partial: [] };
      if (from <= minOf(casa[0]) && to >= minOf(casa[1])) p.full.add(d);
      else p.partial.push(`${dm(d)} das ${hourText(b.startTime)} às ${hourText(b.endTime)}`);
      byPro.set(b.pro, p);
    }
  }
  const out: string[] = [];
  for (const [pro, p] of [...byPro.entries()].sort((a, b) => a[0].localeCompare(b[0], "pt-BR"))) {
    const full = [...p.full].sort();
    const ranges: [string, string][] = [];
    for (const d of full) {
      const r = ranges.at(-1);
      // Junta com a faixa anterior se todos os dias entre elas são de Casa fechada.
      const gap = r ? days.filter((x) => x > r[1] && x < d) : [];
      if (r && gap.every((x) => !open(x))) r[1] = d; else ranges.push([d, d]);
    }
    const parts = [
      ...ranges.map(([a, b]) => (a === b ? dm(a) : a.slice(5, 7) === b.slice(5, 7) ? `de ${a.slice(8, 10)} a ${dm(b)}` : `de ${dm(a)} a ${dm(b)}`)),
      ...[...new Set(p.partial)],
    ];
    out.push(`${nomeBonito(pro)} fora ${parts.join(", ")}`);
  }
  return out;
}

/** Bloqueios (não apagados, não recusados, não almoço) de profissionais ativas que tocam os próximos 7 dias. */
export async function loadAusencias(now: Date): Promise<string[]> {
  const today = todayBahia(now), last = shiftDay(today, AUSENCIA_DIAS - 1);
  const [rows, hours] = await Promise.all([
    db.select({ pro: professionals.name, startsOn: agendaBlocks.startsOn, endsOn: agendaBlocks.endsOn, startTime: agendaBlocks.startTime, endTime: agendaBlocks.endTime, weekdays: agendaBlocks.weekdays })
      .from(agendaBlocks).innerJoin(professionals, eq(professionals.id, agendaBlocks.professionalId))
      // Assistente (17/10) não é quem atende para a cliente: a ausência dela não vai para a IA.
      .where(and(isNull(agendaBlocks.deletedAt), eq(professionals.active, true), isNull(professionals.assistantOf), lte(agendaBlocks.startsOn, last), gte(agendaBlocks.endsOn, today),
        or(isNull(agendaBlocks.requestStatus), eq(agendaBlocks.requestStatus, "aprovado")), or(isNull(agendaBlocks.reason), sql`${agendaBlocks.reason} <> 'almoco'`))),
    getBusinessHours(),
  ]);
  return formatAusencias(rows, today, hours);
}
