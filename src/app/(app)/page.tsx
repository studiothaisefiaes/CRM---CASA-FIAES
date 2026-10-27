import { redirect } from "next/navigation";
import { can, firstAllowedPath, isReportsOnly } from "@/lib/permissions";
import { CashClosedNotice } from "@/components/caixa/cash-closed-notice";
import { requireUser } from "@/server/auth/session";
import { getToday } from "@/server/queries/today";
import { getMyAlerts } from "@/server/queries/alerts";
import { DailySummary } from "@/components/today/daily-summary";
import { AniversarioBloco, AvisosBloco, CombinadosBloco, DiaNaCasaBloco, EquipeBloco, EsperandoBloco, ParaVoceAgora, RetomarBloco } from "@/components/today/hoje-resumo";
import { LiveRefresh } from "@/components/shell/live";
import { PushOptIn } from "@/components/shell/push-optin";
import { ComandaProvider } from "@/components/caixa/comanda-provider";
import { dailySummaryText } from "@/server/reports/summary-text";
import { getSummaryWhatsapp } from "@/server/domain/summary-whatsapp";
import { summaryMode } from "@/lib/daily-summary";
import { summaryLinkHref } from "@/lib/report-links";
import { env, vapidConfig } from "@/server/env";
import { AcompanhandoBloco } from "@/components/today/following";
import { followingOf } from "@/server/domain/follow";
import { getTeamNow } from "@/server/queries/team-now";
import { listScheduled } from "@/server/queries/scheduled-list";
import { getComandaCatalog } from "@/server/queries/comanda-catalog";
import { dayTableVisits } from "@/lib/day-visit";
import { dayVisitsOf } from "@/server/queries/day-visit";
import { getAgendaMode } from "@/server/domain/agenda/mode";
import { getCaixaMode } from "@/server/domain/caixa/mode";
import { todayBahia } from "@/lib/agenda";
import { SectionTabs } from "@/components/shell/section-tabs";
import { hojeTabs } from "@/lib/section-tabs";
import { greeting } from "@/components/today/hoje-topo";
import { DayTable } from "@/components/today/day-table";
import { AgendaPendingStrip } from "@/components/today/agenda-pending-strip";
import { agendaPendingSummary } from "@/server/queries/agenda-pending";

export const metadata = { title: "Hoje" };


/** Só para conferir a tela em outra hora (prints, e2e): `?agora=2026-10-13T20:00-03:00`, e só com as ferramentas de desenvolvimento ligadas. */
function pageNow(agora: unknown): Date {
  if (!env().DEV_TOOLS || typeof agora !== "string") return new Date();
  const t = Date.parse(agora);
  return Number.isNaN(t) ? new Date() : new Date(t);
}

export default async function HojePage({ searchParams }: PageProps<"/">) {
  const user = await requireUser();
  // Quem só tem os relatórios (o Contador, 26/10) não tem nada no Hoje: entra direto em Relatórios (o login e o convite caem aqui).
  if (isReportsOnly(user.perms)) redirect(firstAllowedPath(user.perms));
  const sp = await searchParams;
  const now = pageNow(sp.agora);
  const notice = sp.aviso === "sem-permissao"
    && <p role="status" className="mb-5 text-sm bg-gold-soft text-gold-ink rounded-[var(--radius-control)] px-3 py-2">Você não tem acesso a essa tela. Se precisar, peça para a gestão liberar no seu perfil.</p>;
  const date = now.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", timeZone: "America/Bahia" });
  const hello = <h1 className="font-display text-[40px] lg:text-[48px] leading-none font-light">{greeting(now)}, {user.name.split(" ")[0]}.</h1>;
  if (!can(user.perms, "atendimento.ver")) {
    return (
      <main className="mx-auto w-full max-w-[1480px] px-5 lg:px-8 pt-6 lg:pt-9 pb-12">
        {notice}
        <CashClosedNotice user={user} className="mb-5" />
        {hello}
        <p className="mt-2 text-sm text-muted first-letter:uppercase">{date}.</p>
        <p className="mt-6 text-graphite max-w-[60ch]">Seu acesso não inclui as Conversas. Use o menu para abrir o que o seu perfil libera.</p>
      </main>
    );
  }
  const gestor = can(user.perms, "relatorios.equipe");
  const today = todayBahia(now);
  const [t, summary, team, prog, rawVisits, agendaMode, caixaMode, alerts, comandaCatalog] = await Promise.all([
    getToday(user, now), gestor ? dailySummaryText(user, now) : Promise.resolve(null), getTeamNow(now), listScheduled(user, { range: "hoje", now }),
    dayVisitsOf(today, { withValues: can(user.perms, "valores.ver") }), getAgendaMode(), getCaixaMode(), getMyAlerts(user), getComandaCatalog(user),
  ]);
  const following = can(user.perms, "conversa.acompanhar") ? await followingOf(user.id) : null;
  // A tabela do dia (Hoje v3): sem CLIENTE PADRÃO, sem espera às 00:00 e sem cancelado de outro dia.
  const visits = dayTableVisits(rawVisits, today);
  const caixaOn = caixaMode === "crm";
  // "Avisos para você": os do sino no nome da pessoa, ainda não lidos.
  const myAlerts = alerts.filter((a) => a.forMe && !a.read);
  const mode = summaryMode(now);
  const canConfig = can(user.perms, "config.sistema");
  const summaryHour = summary && canConfig ? (await getSummaryWhatsapp()).hora : undefined;
  const summaryBlock = summary && (
    <DailySummary text={summary.text} highlight={mode.highlight} title={mode.title} receiveHref={canConfig ? "/config/resumo-whatsapp" : undefined} receiveHour={summaryHour}
      links={summary.links.flatMap((l) => { const href = summaryLinkHref(l.href); return href ? [{ label: l.label, href }] : []; })} />
  );
  const vapid = vapidConfig();
  const nowMs = now.getTime();
  // Hoje abre na Recepção (o balcão, dono 24/10); o Resumo é ?vista=resumo.
  const resumo = sp.vista === "resumo";
  const tabs = <SectionTabs label="Hoje" tabs={hojeTabs(user.perms)} current={resumo ? "resumo" : "recepcao"} className="mt-5" />;
  // Recepção: as pendências da Agenda à vista e o dia inteiro na tabela (a mesma do "Ver o dia todo" do Resumo).
  if (!resumo) {
    const pend = await agendaPendingSummary(user, now);
    const recepcao = (
      <main className="mx-auto w-full max-w-[1480px] px-5 lg:px-8 pt-6 lg:pt-9 pb-12">
        {notice}
        <CashClosedNotice user={user} className="mb-5" />
        {hello}
        <p className="mt-2 text-sm text-muted"><span className="inline-block first-letter:uppercase">{date}.</span> Todo mundo que vem hoje, na ordem de chegada.</p>
        <LiveRefresh scopes={["team", "agenda", "caixa"]} />
        {tabs}
        <div className="mt-5"><AgendaPendingStrip items={pend} /></div>
        <div className="mt-4"><DayTable visits={visits} nowMs={nowMs} caixaOn={caixaOn} canMark={can(user.perms, "agenda.marcar")} agendaMode={agendaMode} /></div>
      </main>
    );
    return comandaCatalog ? <ComandaProvider catalog={comandaCatalog}>{recepcao}</ComandaProvider> : recepcao;
  }
  const page = (
    <main className="mx-auto w-full max-w-[1480px] px-5 lg:px-8 pt-6 lg:pt-9 pb-12">
      {notice}
      <CashClosedNotice user={user} className="mb-5" />
      {hello}
      <p className="mt-2 text-sm text-muted"><span className="inline-block first-letter:uppercase">{date}.</span> Aqui fica o resumo do que é seu e da Casa. Toque num bloco para ver tudo.</p>
      {tabs}
      <LiveRefresh scopes={["queue", "team", "agenda", "caixa"]} />
      {vapid && <PushOptIn publicKey={vapid.publicKey} />}
      {/* O resumo da gestão fica sempre no topo: recolhido até as 19h, aberto e em destaque depois. */}
      {summaryBlock && <div className="mt-6">{summaryBlock}</div>}
      {/* Hoje v3 (protótipo aprovado pelo dono em 17/10): a faixa do que é seu agora e os blocos compactos; cada bloco abre o painel grande. */}
      <div className={summaryBlock ? "mt-4" : "mt-6"}>
        <ParaVoceAgora waitingMine={t.waitingMine} waiting={t.waiting} tasks={t.tasks} alerts={myAlerts} />
      </div>
      <div data-testid="resumo-blocos" className="mt-4 grid items-start gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <CombinadosBloco tasks={t.tasks} unassigned={t.unassigned} dues={t.dues} attendance={t.attendance} programadas={prog} nowMs={nowMs} />
        <AvisosBloco alerts={myAlerts} nowMs={nowMs} />
        <AniversarioBloco items={t.birthdays} />
        <DiaNaCasaBloco visits={visits} nowMs={nowMs} caixaOn={caixaOn} canMark={can(user.perms, "agenda.marcar")} agendaMode={agendaMode} />
        <EsperandoBloco waiting={t.waiting} late={t.late} resp={t.resp} />
        <RetomarBloco followups={t.followups} stale={t.stale} />
        {following && <AcompanhandoBloco items={following} />}
        <EquipeBloco team={team} now={now} />
      </div>
    </main>
  );
  return comandaCatalog ? <ComandaProvider catalog={comandaCatalog}>{page}</ComandaProvider> : page;
}
