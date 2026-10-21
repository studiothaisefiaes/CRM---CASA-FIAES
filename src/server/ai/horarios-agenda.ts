import { and, asc, desc, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "../db";
import { appointments, clientPackages, contacts, contactStats, lists, professionals, professionalServices } from "../db/schema";
import { getBusinessHours } from "../domain/hours";
import { windowOf } from "../../lib/business-hours";
import { checkStartFor, freeStartsByDay } from "../domain/agenda/availability";
import { proDurations } from "../domain/service-terms";
import { shiftDay, todayBahia } from "@/lib/agenda";
import { slotMs } from "@/lib/schedule";
import { formatFreeHours, metodoTopic, openDays, parseWindow, proFirstName, serviceFromText, withoutMetodoWords } from "./horarios";
import { groupPackagePurchases } from "@/lib/package-purchases";
import type { ProposedSlot } from "@/lib/proposed-slot";

/**
 * A linha "Horários livres (…)" da sugestão por IA, lida da agenda do CRM. O serviço provável, nesta ordem: o que a cliente citou no texto,
 * o serviço da conversa, o último serviço que ela fez (ou o mais feito), o pacote ativo (a compra, não uma linha por serviço). Sem nenhum: as profissionais de cabelo, 1 h.
 * Profissionais: as ativas que fazem o serviço, com a preferida da cliente primeiro. Sem duração cadastrada: 1 h.
 * Regra "A IA oferece só com" do serviço (aba Serviços): só aquelas profissionais, sempre ou só quando o assunto é o Método Fiaes
 * (pedido do dono, 17/10: a avaliação do Método é SÓ com a Thaise, mesmo que o cadastro de quem faz esteja mais largo).
 */
const DEFAULT_MIN = 60;
/** Até quantos dias à frente o dia pedido pela cliente é lido na agenda. */
export const ASKED_MAX_DAYS = 120;
const MAX_PROS = 4;

type Svc = { id: string; label: string; durationMin: number | null; bufferMin: number | null; category: string | null; description: string | null; aiProIds: string[] | null; aiProScope: "sempre" | "metodo" | null };
type Pro = { id: string; name: string };
export type SlotPlan = { svc: Svc | null; label: string; durationMin: number; bufferMin: number | null; pros: Pro[]; favorite: string | null; metodo: boolean;
  /** A regra "A IA oferece só com" do serviço valeu: `pros` são só as dela. */
  ruled: boolean;
  /** Só uma das profissionais do serviço foi citada na conversa ("o corte com Jackson… R$ 264"): os horários começam por ela. */
  citada: Pro | null };

/** A regra "A IA oferece só com" vale aqui? */
const ruleApplies = (s: Svc, metodo: boolean) => !!s.aiProIds?.length && (s.aiProScope === "metodo" ? metodo : true);

/**
 * O serviço e as profissionais que a IA pode oferecer para esta cliente (sem ler a agenda). `texts`: as mensagens que pedem horário
 * (e, na concordância, a mensagem da Casa). O assunto Método vem do texto, do serviço da conversa e do pacote ou último serviço dela.
 */
export async function planSlots(i: { contactId: string; dealServiceId: string | null; texts: string[]; now: Date;
  /** As mensagens recentes da conversa (das duas): só para saber se o assunto é o Método (caso Mary, 17/10: "pode ser na semana do dia 26?"). */
  context?: (string | null)[] }): Promise<SlotPlan | null> {
  const today = todayBahia(i.now);
  const [svcRows, links, allPros, pref, lastRows, pkRows] = await Promise.all([
    db.select({ id: lists.id, label: lists.label, durationMin: lists.durationMin, bufferMin: lists.bufferMin, category: lists.category, description: lists.description, aiProIds: lists.aiProIds, aiProScope: lists.aiProScope })
      .from(lists).where(and(eq(lists.kind, "service"), eq(lists.active, true))).orderBy(asc(lists.position), asc(lists.label)),
    db.select({ serviceId: professionalServices.serviceId, id: professionals.id, name: professionals.name }).from(professionalServices)
      // Assistente (17/10) nunca é oferecida como quem atende: para a cliente, quem atende é a principal.
      .innerJoin(professionals, eq(professionals.id, professionalServices.professionalId)).where(and(eq(professionals.active, true), isNull(professionals.assistantOf)))
      .orderBy(sql`${professionals.agendaPosition} asc nulls last`, asc(professionals.name)),
    db.select({ id: professionals.id, name: professionals.name }).from(professionals).where(and(eq(professionals.active, true), isNull(professionals.assistantOf)))
      .orderBy(sql`${professionals.agendaPosition} asc nulls last`, asc(professionals.name)),
    db.select({ chosen: contacts.preferredProfessionalId, calc: contactStats.preferredProfessionalId, top: contactStats.topServices }).from(contacts)
      .leftJoin(contactStats, eq(contactStats.contactId, contacts.id)).where(eq(contacts.id, i.contactId)).then((r) => r[0]),
    db.select({ serviceId: appointments.serviceId, label: appointments.serviceLabel }).from(appointments)
      .where(and(eq(appointments.contactId, i.contactId), lt(appointments.startsAt, i.now), inArray(appointments.status, ["compareceu", "chegou", "em_atendimento", "conferir"])))
      .orderBy(desc(appointments.startsAt)).limit(1),
    // O pacote ativo como COMPRA (o Avec grava uma linha por serviço): em uso = maior usado < maior total entre os serviços dela.
    db.select({ id: clientPackages.id, contactId: clientPackages.contactId, clientName: clientPackages.clientName, packageName: clientPackages.packageName,
      serviceLabel: clientPackages.serviceLabel, totalSessions: clientPackages.totalSessions, usedSessions: clientPackages.usedSessions, priceCents: clientPackages.priceCents,
      purchasedOn: clientPackages.purchasedOn, validUntil: clientPackages.validUntil }).from(clientPackages)
      .where(and(eq(clientPackages.contactId, i.contactId), isNull(clientPackages.cancelledAt), or(isNull(clientPackages.validUntil), gte(clientPackages.validUntil, today))))
      .orderBy(sql`${clientPackages.purchasedOn} desc nulls last`),
  ]);
  const doers = new Map<string, Pro[]>();
  for (const l of links) doers.set(l.serviceId, [...(doers.get(l.serviceId) ?? []), { id: l.id, name: l.name }]);
  const active = new Map(allPros.map((p) => [p.id, p]));
  const ruled = (s: Svc) => (s.aiProIds ?? []).some((id) => active.has(id));
  // Só serviço que alguém faz (ou que tem regra com alguém ativo) tem horário para oferecer.
  const services: Svc[] = svcRows.filter((s) => doers.has(s.id) || ruled(s));
  const byId = new Map(services.map((s) => [s.id, s]));
  const byLabel = (label: string | null | undefined) => (label ? services.find((s) => s.label.trim().toLowerCase() === label.trim().toLowerCase()) ?? null : null);
  const last = lastRows[0];
  const pk = groupPackagePurchases(pkRows).find((p) => p.usedSessions < p.totalSessions);

  const dealSvc = i.dealServiceId ? byId.get(i.dealServiceId) ?? null : null;
  // Já é do Método: o pacote ou o último serviço dela é do Método.
  const metodoClient = metodoTopic([pk?.packageName, ...(pk?.rows.map((r) => r.serviceLabel) ?? []), last?.label]);
  const metodo = metodoTopic([...i.texts, dealSvc?.label, ...(i.context ?? [])]) || metodoClient;
  // O serviço citado na mensagem MAIS NOVA vale ("tem pra corte?" … "na verdade quero a avaliação" = avaliação). Nome de profissional
  // não é serviço; no empate vale o assunto dela (Método) ou o último serviço que ela fez.
  const nomes = allPros.map((p) => p.name);
  const lastWords = new Set((last?.label ?? "").toLowerCase().split(/\s+/).filter((w) => w.length >= 4));
  // Profissional citada na conversa (das duas: "O corte com nosso especialista JACKSON…"): o serviço com o nome dela desempata.
  const ctx = (i.context ?? []).join(" ").toLowerCase();
  const naConversa = nomes.map((n) => n.trim().split(/\s+/)[0]?.toLowerCase() ?? "").filter((n) => n.length >= 3 && new RegExp(`(?<![\\p{L}])${n}(?![\\p{L}])`, "u").test(ctx));
  // Serviço do Método: o nome diz "Método" ou a regra é do Método. "Manutenção unha Gel" não é (a palavra sozinha serve a qualquer manutenção; 20/10, P07).
  const doMetodo = (s: Svc) => s.aiProScope === "metodo" || /\bmetodo\b/.test(s.label.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase());
  // Duas forças: ser do Método quando o assunto é Método (2) pesa mais que repetir uma palavra do último serviço / da conversa (1).
  const prefere = (s: Svc) => (metodo && doMetodo(s) ? 2 : 0) + (s.label.toLowerCase().split(/\s+/).some((w) => lastWords.has(w) || naConversa.includes(w)) ? 1 : 0);
  const fromTexts = (f: (t: string) => string = (t) => t) => {
    for (const t of [...i.texts].reverse()) { const hit = serviceFromText(f(t), services, { nomes, prefere }); if (hit) return hit; }
    return null;
  };

  let svc: Svc | null = fromTexts() ?? dealSvc;
  // Assunto Método e ela ainda não é do Método: começa pela avaliação do Método (o serviço com a regra "só quando é Método"), a não ser
  // que ela tenha citado outro serviço de verdade ("quero conhecer o método" não cita; "manutenção" cita) ou a conversa já tenha serviço.
  const metodoStart = metodo && !metodoClient ? services.find((s) => s.aiProScope === "metodo" && ruled(s)) ?? null : null;
  if (metodoStart) {
    const real = fromTexts(withoutMetodoWords);
    if (real ? real.id === metodoStart.id : !dealSvc) svc = metodoStart;
  }
  // A mensagem que pede o horário não cita o serviço ("Amanhã não, tem vaga no sábado?"), mas a conversa recente sim ("…para sua avaliação"):
  // vale o serviço citado nas últimas falas (curtas: texto longo explicando o Método cita de tudo).
  if (!svc) {
    for (const t of [...(i.context ?? [])].reverse().slice(0, 6)) {
      const hit = t && t.length <= 300 ? serviceFromText(t, services, { nomes, prefere }) : null;
      if (hit) { svc = hit; break; }
    }
  }
  if (!svc) svc = (last?.serviceId ? byId.get(last.serviceId) : null) ?? byLabel(last?.label) ?? byLabel(pref?.top?.[0]?.item) ?? null;
  if (!svc && pk) {
    // Da compra mais recente em uso, o serviço cadastrado com mais sessões sobrando; senão o que o nome der.
    const open = [...pk.rows].sort((a, b) => (b.totalSessions - b.usedSessions) - (a.totalSessions - a.usedSessions));
    svc = open.map((r) => byLabel(r.serviceLabel)).find(Boolean) ?? serviceFromText(`${open.map((r) => r.serviceLabel ?? "").join(" ")} ${pk.packageName}`, services);
  }

  let label: string, durationMin: number, bufferMin: number | null, pros: Pro[], ruledPlan = false;
  if (svc) {
    ({ label } = svc); durationMin = svc.durationMin ?? DEFAULT_MIN; bufferMin = svc.bufferMin;
    const own = doers.get(svc.id) ?? [];
    if ((ruledPlan = ruleApplies(svc, metodo))) {
      // A regra manda: só as profissionais dela (ativas). Das que também fazem o serviço no cadastro, se houver (a folha de marcar aceita sem
      // pedir "Ela faz esse serviço"); senão as da regra mesmo.
      const ids = new Set(svc.aiProIds);
      const both = own.filter((p) => ids.has(p.id));
      pros = both.length ? both : allPros.filter((p) => ids.has(p.id));
    } else pros = own;
  } else {
    // Sem serviço claro: quem faz algum serviço de cabelo.
    const hair = new Set(services.filter((s) => /^cabel/i.test(s.category?.trim() ?? "")).map((s) => s.id));
    label = "cabelo"; durationMin = DEFAULT_MIN; bufferMin = null;
    pros = [...new Map(links.filter((l) => hair.has(l.serviceId)).map((l) => [l.id, { id: l.id, name: l.name }])).values()];
  }
  if (!pros.length) return null;
  const favorite = pref?.chosen ?? pref?.calc ?? null;
  const citadas = ruledPlan ? [] : pros.filter((p) => naConversa.includes(p.name.trim().split(/\s+/)[0]?.toLowerCase() ?? ""));
  const citada = citadas.length === 1 ? citadas[0]! : null;
  pros = [...pros.filter((p) => p.id === favorite), ...pros.filter((p) => p.id !== favorite)].slice(0, MAX_PROS);
  return { svc, label, durationMin, bufferMin, pros, favorite, metodo, ruled: ruledPlan, citada };
}

const hm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

/** Sem nada na janela pedida (nem depois dela) ou sem nada nos próximos dias: procura até aqui à frente. */
export const EXTEND_DAYS = 30;

export async function freeHoursLine(i: { contactId: string; dealServiceId: string | null; texts: string[]; now: Date; context?: (string | null)[] }): Promise<{ line: string; options: ProposedSlot[]; fora: string | null } | null> {
  const plan = await planSlots(i);
  if (!plan) return null;
  const today = todayBahia(i.now);
  const casa = await getBusinessHours();
  // O dia que a cliente pediu entra mesmo fora dos próximos dias abertos (até 4 meses: 20/10, "agenda para 21/11" virava "nenhum livre
  // em 21/11" só porque a leitura parava em 3 semanas), se a Casa abre nele.
  const window = parseWindow(i.texts, today);
  const asked = (window?.days ?? []).filter((d) => d >= today && d <= shiftDay(today, ASKED_MAX_DAYS) && windowOf(Date.parse(`${d}T00:00:00Z`), casa));
  const days = [...new Set([...openDays(today, casa), ...asked])].sort();
  const onlyWith = plan.ruled ? plan.pros.map((p) => proFirstName(p.name)).join(" ou ") : null;
  // 0084: cada profissional com o tempo dela no serviço (o próprio, senão o do serviço).
  const own = plan.svc ? await proDurations(db, plan.svc.id, [...plan.pros, ...(plan.citada ? [plan.citada] : [])].map((p) => p.id)) : new Map<string, number>();
  const lineFor = async (ds: string[], ps: Pro[] = plan.pros) => {
    const free = await freeStartsByDay({ professionalIds: ps.map((p) => p.id), days: ds, durationMin: plan.durationMin, durationByPro: own, bufferMin: plan.bufferMin, clientId: i.contactId, now: i.now });
    return formatFreeHours({
      serviceLabel: plan.label, durationMin: plan.durationMin, max: plan.citada && ps.length === 1 ? 4 : undefined, rotate: !ps.some((p) => p.id === plan.favorite), window, onlyWith,
      days: ds.map((day) => ({ day, pros: ps.map((p) => ({ id: p.id, name: proFirstName(p.name), starts: free.get(day)?.get(p.id) ?? [] })) })),
    });
  };
  // Quem a conversa citou (a Casa cotou "o corte com Jackson") vem sozinha; sem horário com ela, valem todas as do serviço.
  const buscar = async (ps: Pro[]) => {
    let r = await lineFor(days, ps);
    // Nada a partir do dia pedido (ou nada nos próximos dias): os próximos horários DELAS até 30 dias à frente, avisando que na janela não tem.
    const start = window?.days[0] ?? today;
    if (!r.options.some((o) => o.day >= start)) {
      const ext = [...new Set([...days.filter((d) => d >= start), ...openDays(start, casa, EXTEND_DAYS, EXTEND_DAYS + 1)])].filter((d) => d <= shiftDay(today, EXTEND_DAYS)).sort();
      const r2 = await lineFor(ext, ps);
      if (r2.options.length) r = r2;
    }
    return r;
  };
  let r = plan.citada ? await buscar([plan.citada]) : await buscar(plan.pros);
  if (plan.citada && !r.options.length) r = await buscar(plan.pros);
  const nameOf = new Map([...plan.pros, ...(plan.citada ? [plan.citada] : [])].map((p) => [p.id, p.name]));
  return {
    line: r.line, fora: r.fora,
    options: r.options.map((o) => ({ id: o.id, day: o.day, time: hm(o.start), professionalId: o.proId ?? null, professionalName: o.proId ? nameOf.get(o.proId) ?? o.name : o.name,
      serviceId: plan.svc?.id ?? null, serviceLabel: plan.svc?.label ?? null, durationMin: (o.proId ? own.get(o.proId) : undefined) ?? plan.durationMin, origem: "lista" as const })),
  };
}

/**
 * O horário ainda está livre na agenda (sem encaixe, dentro do horário, sem bloqueio)? Sem profissional não dá para conferir: `null`.
 * Usado ao gravar a sugestão e de novo no "Marcar este horário".
 */
export async function slotStillFree(s: Pick<ProposedSlot, "day" | "time" | "professionalId" | "serviceId" | "durationMin">, clientId: string | null, now: Date): Promise<boolean | null> {
  if (!s.professionalId) return null;
  const ms = slotMs(s.day, s.time);
  if (!Number.isFinite(ms) || ms < now.getTime()) return false;
  const r = await checkStartFor({ professionalId: s.professionalId, startsAt: new Date(ms), serviceId: s.serviceId, durationMin: s.durationMin, clientId, now });
  return r.ok && r.kind === "livre";
}

