import { displayName } from "@/lib/display-name";
import { CashClosedNotice } from "@/components/caixa/cash-closed-notice";
import type { ReactNode } from "react";
import { requirePerm } from "@/server/auth/session";
import { getAgenda, listServicePrices } from "@/server/queries/agenda";
import { listAgendaBlocks, listWaitlist } from "@/server/queries/avec";
import { listProfessionals } from "@/server/domain/professionals";
import { getBusinessHours } from "@/server/domain/hours";
import { getAgendaMode } from "@/server/domain/agenda/mode";
import { getVisitTypes, listAppointmentLabels } from "@/server/domain/agenda/labels";
import { getRepetirConfig } from "@/server/domain/agenda/recurrence";
import { clientAlertFor } from "@/server/domain/client-alert";
import { getFuncoes } from "@/server/domain/funcoes";
import { agendaRange, hmToMinutes, shiftDay, todayBahia, weekDays, type AgendaView } from "@/lib/agenda";
import { blockAppliesOn } from "@/lib/agenda-blocks";
import { noBaixa, noBaixaRange } from "@/lib/agenda-day";
import { dayOff, effectiveRanges } from "@/lib/work-hours";
import { can } from "@/lib/permissions";
import { LiveRefresh } from "@/components/shell/live";
import { LeaveRequestsButton } from "@/components/agenda/leave-requests";
import { listLeaveRequests } from "@/server/domain/pro/leave";
import { OnlineRequestsButton } from "@/components/agenda/online-requests";
import { listOnlineRequests } from "@/server/domain/client-link/online";
import { dayAcks } from "@/server/domain/pro/acks";
import { AgendaBoard } from "@/components/agenda/agenda-board";
import { Waitlist } from "@/components/agenda/waitlist";
import { PaidList } from "@/components/agenda/paid-list";
import { PAID_CHIPS, paidFilterOf, type PaidChip } from "@/lib/paid-chips";
import { countPaidNotUsed, listPaidNotUsed } from "@/server/domain/caixa/paid";
import { WeekByPro } from "@/components/agenda/week-by-pro";
import { getAgendaWeekByPro } from "@/server/queries/agenda-week";
import { proPhotoUrl } from "@/lib/pro-photo";
import { listAvecDivergences, listAvecRejected } from "@/server/domain/agenda/twins";
import { listConfirmByPhone } from "@/server/queries/confirm-by-phone";
import { listBookableServices, listBookingTerms } from "@/server/queries/agenda";
import { getCaixaRecursos } from "@/server/domain/caixa/recursos";
import { AgendaSheetsProvider, type AgendaCatalog } from "@/components/agenda/agenda-sheets";
import { AvecDivergences } from "@/components/agenda/avec-divergences";
import { WaitlistAdd } from "@/components/agenda/waitlist-sheet";
import { getCaixaMode } from "@/server/domain/caixa/mode";
import { buildComandaCatalog } from "@/server/queries/comanda-catalog";
import { ComandaProvider } from "@/components/caixa/comanda-provider";
import type { ComandaCatalog } from "@/components/caixa/comanda-sheet";
import { getAgendaPrefs } from "@/server/domain/user-prefs";
import { AgendaShell, type ShellNav } from "@/components/agenda/day/shell";
import { DayAgenda, type DayPro } from "@/components/agenda/day/day-agenda";
import type { GridBlock } from "@/components/agenda/day/day-grid";
import type { PendingData, PendingTab } from "@/components/agenda/day/pending";

export const metadata = { title: "Agenda" };

const DIA = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const CURTO = new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "long", timeZone: "UTC" });
const SEM = new Intl.DateTimeFormat("pt-BR", { weekday: "short", timeZone: "UTC" });
const utc = (day: string) => new Date(`${day}T12:00:00Z`);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const dm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

/** `?p=a,b`: quem aparece lado a lado (ids válidos, sem repetir, na ordem). Sem limite: "Todas" já mostra todas. */
function parseSel(raw: string | string[] | undefined, valid: string[]): string[] | null {
  const text = Array.isArray(raw) ? raw[0] : raw;
  if (!text) return null;
  const out = text.split(",").map((s) => s.trim()).filter((id, i, all) => valid.includes(id) && all.indexOf(id) === i);
  return out.length ? out : null;
}

/**
 * A Agenda (nova, aprovada pelo dono em 16/10): "Quem vem hoje e como está o dia?". O alto numa linha só; no Dia, a fileira de fotos, a
 * grade limpa por profissional, arrastar para passar o horário para outra pessoa/hora, e o Personalizar com visões salvas por pessoa.
 * Sem baixa, lista de espera, falta pagar, pedidos, já pagaram e Conferir com o Avec ficam no painel das pendências (sino).
 */
export default async function AgendaPage({ searchParams }: PageProps<"/agenda">) {
  const user = await requirePerm("atendimento.ver");
  const sp = await searchParams;
  const now = new Date();
  const today = todayBahia(now);
  const range = agendaRange({ d: sp.d, v: sp.v }, now);
  const withValues = can(user.perms, "valores.ver");
  const canBook = can(user.perms, "agenda.marcar");
  const canCaixa = can(user.perms, "caixa.operar") && (await getCaixaMode()) === "crm";
  const [pros, waitlist, paidCount, mode, casa, services, leaveRequests, onlineRequests, prefs] = await Promise.all([
    // Nome da profissional em Título na tela ("BEBEL" → "Bebel"); o cadastro guarda como veio.
    listProfessionals().then((list) => list.map((p) => ({ ...p, name: displayName(p.name), role: p.role ? displayName(p.role) : null }))),
    listWaitlist({ from: agendaRange({}, now).from }), countPaidNotUsed(now), getAgendaMode(), getBusinessHours(),
    canBook || canCaixa ? listBookableServices() : [],
    canBook ? listLeaveRequests() : [], canBook ? listOnlineRequests() : [],
    getAgendaPrefs(user.id),
  ]);
  // Fase C (item 19): marcador e tipo só com a permissão agenda.marcador e a função ligada; só os ativos entram na escolha.
  const [funcoes, labelList, typeList] = can(user.perms, "agenda.marcador") ? await Promise.all([getFuncoes(), listAppointmentLabels(), getVisitTypes()]) : [null, [], []];
  const alertHorario = await clientAlertFor("horario");
  // Item 23a: a chave Repetir só com agenda.repetir, quem marca e a função ligada; os limites da Casa vêm de Configurações.
  const repeat = canBook && can(user.perms, "agenda.repetir") && (await getFuncoes()).repetir ? await getRepetirConfig() : null;
  // Item 23b: Passar o dia só com agenda.passar_dia e a função ligada (o servidor confere de novo); nunca num dia que já passou.
  const transfer = can(user.perms, "agenda.passar_dia") && (await getFuncoes()).passar_dia
    ? { day: range.day < today ? today : range.day, pros: pros.filter((p) => p.active).map((p) => ({ id: p.id, name: p.name })) } : null;
  const showAvec = canBook && mode !== "consulta";
  // Marcar (20/10): preço do catálogo e o tempo/preço de cada profissional; as fixas de cada principal; o limite de assistentes da comanda.
  const [servicePrices, proTerms, funcoesAll, caixaRec] = canBook
    ? await Promise.all([withValues ? listServicePrices() : Promise.resolve(null), listBookingTerms(withValues), getFuncoes(), canCaixa ? getCaixaRecursos() : Promise.resolve(null)])
    : [null, {} as Awaited<ReturnType<typeof listBookingTerms>>, null, null];
  const catalog: AgendaCatalog = {
    services: services.map((s) => ({ ...s, priceCents: servicePrices?.[s.id] ?? null })),
    professionals: pros.map((p) => ({ id: p.id, name: p.name, active: p.active, serviceIds: p.serviceIds, assistantOf: p.assistantOf, ...(proTerms[p.id] ? { terms: proTerms[p.id] } : {}) })), canMark: canBook,
    perProTerms: !!funcoesAll?.preco_por_profissional, comandaAssistantsMax: caixaRec?.assistentes ? caixaRec.assistentesMax : null,
    canFitIn: can(user.perms, "agenda.encaixar"), canEditConfig: can(user.perms, "config.diaadia"), agendaMode: mode, canCaixa,
    labels: funcoes?.marcadores ? labelList.map(({ id, name, color }) => ({ id, name, color })) : [], visitTypes: funcoes?.tipo_horario ? typeList.filter((t) => t.active).map(({ value, label }) => ({ value, label })) : [],
    clientAlert: alertHorario, repeat,
  };
  const comandaCatalog: ComandaCatalog | null = canCaixa ? await buildComandaCatalog(user) : null;
  const todayFrom = agendaRange({}, now).from;
  const [divergences, rejected] = showAvec ? await Promise.all([
    listAvecDivergences({ from: new Date(todayFrom.getTime() - 7 * 86_400_000), to: new Date(todayFrom.getTime() + 60 * 86_400_000) }), listAvecRejected(now),
  ]) : [[], []];
  const sel = parseSel(sp.p, pros.map((p) => p.id));
  const highlight = typeof sp.destaque === "string" ? sp.destaque : null;

  // Links do alto (Dia/Semana, setas, Hoje). A escolha de quem aparece (?p=) vai junto.
  const href = (o: { d?: string; v?: AgendaView }) => {
    const s = new URLSearchParams();
    const d = o.d ?? range.day, v = o.v ?? range.view;
    if (d !== today) s.set("d", d);
    if (v !== "dia") s.set("v", v);
    if (sel) s.set("p", sel.join(","));
    return s.size ? `/agenda?${s}` : "/agenda";
  };
  const step = range.view === "semana" ? 7 : 1;
  const days = weekDays(range);
  const week = range.view === "semana" ? days : weekDays(agendaRange({ d: range.day, v: "semana" }, now));
  const weekLabel = `${week[0].slice(5, 7) === week[6].slice(5, 7) ? utc(week[0]).getUTCDate() : CURTO.format(utc(week[0]))} a ${CURTO.format(utc(week[6]))}`;
  const isNow = range.view !== "semana" ? range.day === today : days.includes(today);
  const nav: ShellNav = {
    title: range.view === "semana" ? cap(weekLabel) : cap(DIA.format(utc(range.day))),
    shortTitle: range.view === "semana" ? `${dm(week[0])} a ${dm(week[6])}` : `${SEM.format(utc(range.day)).replace(".", "")} ${dm(range.day)}`,
    prevHref: href({ d: shiftDay(range.day, -step) }), nextHref: href({ d: shiftDay(range.day, step) }),
    prevLabel: range.view === "semana" ? "Semana anterior" : "Dia anterior", nextLabel: range.view === "semana" ? "Próxima semana" : "Próximo dia",
    todayHref: isNow ? null : href({ d: today }), view: range.view === "semana" ? "semana" : "dia",
    dayHref: href({ v: "dia" }), weekHref: href({ v: "semana" }), listHref: href({ v: "lista" }),
  };

  // Pendências: sem baixa da semana (P6: antes só ontem e hoje), falta pagar de hoje (caixa no CRM), lista de espera, pedidos, já pagaram, Avec.
  const [pendItems, confirmByPhone] = await Promise.all([getAgenda(noBaixaRange(today), now), listConfirmByPhone(now)]);
  const abaRaw = sp.aba === "pacotes" ? "pagos" : sp.aba;
  const pedidosOpen = sp.pedidos === "folga" || sp.pedidos === "site" ? sp.pedidos : null;
  const initialPending: PendingTab | null = pedidosOpen ? "pedidos" : abaRaw === "espera" || abaRaw === "pagos" ? abaRaw : abaRaw === "avec" && showAvec ? "avec" : abaRaw === "semBaixa" ? "semBaixa" : abaRaw === "telefone" ? "telefone" : null;
  let paid: ReactNode = null;
  if (initialPending === "pagos") {
    const chip = PAID_CHIPS.some((c) => c.value === sp.f) ? (sp.f as PaidChip) : null;
    const rows = await listPaidNotUsed(paidFilterOf(chip, withValues), now);
    const chipHref = Object.fromEntries([["todos", "/agenda?aba=pagos"], ...PAID_CHIPS.map((c) => [c.value, `/agenda?aba=pagos&f=${c.value}`])]) as Record<"todos" | PaidChip, string>;
    paid = <PaidList rows={rows} chip={chip} chipHref={chipHref} withValues={withValues} today={today} nowMs={now.getTime()} />;
  }
  const pending: PendingData = {
    noBaixa: noBaixa(pendItems, now.getTime()),
    waitlistCount: waitlist.length,
    waitlist: <div className="flex flex-col gap-4"><div className="flex justify-end"><WaitlistAdd today={today} /></div><Waitlist items={waitlist} today={today} /></div>,
    faltaPagar: canCaixa ? pendItems.filter((i) => i.scheduledAt >= todayFrom.toISOString() && i.dbStatus === "compareceu" && !i.paid && !i.genericClient) : [],
    pedidosCount: leaveRequests.length + onlineRequests.length,
    pedidos: (
      <div className="flex flex-wrap gap-2">
        <LeaveRequestsButton items={leaveRequests} openInitially={pedidosOpen === "folga"} />
        <OnlineRequestsButton items={onlineRequests} openInitially={pedidosOpen === "site"} />
      </div>
    ),
    paidCount, paid, paidHref: "/agenda?aba=pagos",
    avec: showAvec ? { count: divergences.length + rejected.length, content: <AvecDivergences items={divergences} rejected={rejected} /> } : null,
    confirmByPhone: { items: confirmByPhone, canStart: can(user.perms, "contatos.ver") },
  };

  let body: ReactNode;
  if (range.view === "dia") {
    const all = await getAgenda(range, now);
    // Bloqueios do dia: entram na folga de cada uma e na grade.
    const rawBlocks = await listAgendaBlocks({ from: range.from, to: new Date(range.from.getTime() + 86_400_000) });
    const blocks: GridBlock[] = rawBlocks.filter((b) => blockAppliesOn(b, range.day)).flatMap((b) => {
      const start = hmToMinutes(b.startTime), end = hmToMinutes(b.endTime);
      return start != null && end != null && end > start ? [{ id: b.id, professionalId: b.professionalId, title: b.title || "Bloqueado", start, end, label: `${b.startTime}–${b.endTime}` }] : [];
    });
    const dayPros: DayPro[] = pros.map((p) => {
      const ranges = effectiveRanges(range.day, p.workHours, casa);
      const off = dayOff(ranges, blocks.filter((b) => b.professionalId === null || b.professionalId === p.id).map((b) => [b.start, b.end]));
      return { id: p.id, name: p.name, role: p.role, color: p.color, photoUrl: proPhotoUrl(p.id, p.photoVersion), ranges, off, serviceIds: p.serviceIds };
    });
    const casaRanges = effectiveRanges(range.day, null, casa);
    const casaSpan = casaRanges.length ? { start: Math.min(...casaRanges.map((r) => r[0])), end: Math.max(...casaRanges.map((r) => r[1])) } : null;
    const [acks, prices] = await Promise.all([dayAcks(range.day), withValues ? listServicePrices() : Promise.resolve(null)]);
    const editBlocks = canBook ? { mode, pros: pros.map((p) => ({ id: p.id, name: p.name })), blocks: rawBlocks.filter((b) => blocks.some((x) => x.id === b.id)).map(({ professionalName: _n, ...b }) => b) } : undefined;
    body = (
      <DayAgenda key={range.day} day={range.day} today={today} nowMs={now.getTime()} pros={dayPros} items={all} blocks={blocks} casa={casaSpan}
        prefs={prefs} urlSel={sel} highlight={highlight} acks={acks} caixaOn={canCaixa} prices={prices} editBlocks={editBlocks} />
    );
  } else if (range.view === "semana") {
    // Semana: a contagem por dia e por profissional (a Casa ou quem está escolhida). Tocar num dia abre o Dia.
    const rows = await getAgendaWeekByPro(range);
    body = <div className="px-4 pb-10 lg:px-6"><WeekByPro rows={sel ? rows.filter((r) => sel.includes(r.professionalId)) : rows} days={days} today={today} /></div>;
  } else {
    const all = await getAgenda(range, now);
    const items = sel ? all.filter((i) => i.professionalId && sel.includes(i.professionalId)) : all;
    body = <div className="px-4 pb-10 lg:px-6"><AgendaBoard items={items} view="lista" days={days} today={today} nowMs={now.getTime()} highlight={highlight} /></div>;
  }

  const shell = (
    <AgendaShell key={`${sp.aba ?? ""}${sp.pedidos ?? ""}`} nav={nav} day={range.day} nowMs={now.getTime()} isToday={range.day === today}
      transfer={transfer} tools={canBook ? { day: range.day < today ? today : range.day, mode, services, pros: pros.map((p) => ({ id: p.id, name: p.name, serviceIds: p.serviceIds })) } : null}
      pending={pending} initialPending={initialPending} personalize={range.view === "dia"}>
      {body}
    </AgendaShell>
  );
  return (
    <main className="pb-6">
      <LiveRefresh scopes={["queue", "agenda", "alerts"]} />
      <CashClosedNotice user={user} className="mx-4 mt-3 lg:mx-6" />
      <AgendaSheetsProvider catalog={catalog}>
        {comandaCatalog ? <ComandaProvider catalog={comandaCatalog}>{shell}</ComandaProvider> : shell}
      </AgendaSheetsProvider>
    </main>
  );
}
