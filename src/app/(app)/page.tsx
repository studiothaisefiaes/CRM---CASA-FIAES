import { seconds } from "@/lib/format";
import Link from "next/link";
import { requireUser } from "@/server/auth/session";
import { getToday, type TodayItem } from "@/server/queries/today";
import { WaitingList } from "@/components/today/waiting-list";
import { DailySummary } from "@/components/today/daily-summary";
import { NextActions } from "@/components/today/next-actions";
import { AttendanceList } from "@/components/today/attendance-list";
import { Stagger } from "@/components/today/stagger";
import { IconCalendar, IconCake, IconMoney, IconRefresh, IconArrowRight, IconClock } from "@/components/icons";
import { LiveRefresh } from "@/components/shell/live";
import { PushOptIn } from "@/components/shell/push-optin";
import { dailySummaryText } from "@/server/reports/summary-text";
import { summaryMode, localHour } from "@/lib/daily-summary";
import { queueHref } from "@/lib/queue";
import { staleHref, summaryLinkHref } from "@/lib/report-links";
import { env, vapidConfig } from "@/server/env";
import { formatPhoneClient } from "@/lib/phone-client";
import { leadHref } from "@/lib/lead-href";

export const metadata = { title: "Hoje" };

function greeting(now: Date) {
  const h = localHour(now);
  return h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
}

/** Só para conferir a tela em outra hora (prints, e2e): `?agora=2026-10-13T20:00-03:00`, e só com as ferramentas de desenvolvimento ligadas. */
function pageNow(agora: unknown): Date {
  if (!env().DEV_TOOLS || typeof agora !== "string") return new Date();
  const t = Date.parse(agora);
  return Number.isNaN(t) ? new Date() : new Date(t);
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export default async function HojePage({ searchParams }: PageProps<"/">) {
  const user = await requireUser();
  const sp = await searchParams;
  const now = pageNow(sp.agora);
  const gestor = user.role === "gestor";
  const [t, summary] = await Promise.all([getToday(user, now), gestor ? dailySummaryText(user, now) : Promise.resolve(null)]);
  const late = t.late;
  const mode = summaryMode(now);
  const date = now.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", timeZone: "America/Bahia" });
  const summaryBlock = summary && (
    <DailySummary text={summary.text} highlight={mode.highlight} title={mode.title}
      links={summary.links.flatMap((l) => { const href = summaryLinkHref(l.href); return href ? [{ label: l.label, href }] : []; })} />
  );
  const fmt = seconds;
  const next = t.waiting[0];
  const vapid = vapidConfig();
  return (
    <main className="px-5 lg:px-8 pt-6 lg:pt-9 pb-12 max-w-[1240px]">
      {sp.aviso === "sem-permissao" && <p className="mb-5 text-sm bg-gold-soft text-gold-ink rounded-[var(--radius-control)] px-3 py-2">Só a gestão tem acesso às configurações.</p>}
      <p className="text-sm text-muted first-letter:uppercase">{date}</p>
      <h1 className="font-serif text-[40px] lg:text-[48px] leading-none font-light mt-1">{greeting(now)}, {user.name.split(" ")[0]}.</h1>
      <LiveRefresh scopes={["queue"]} />
      {vapid && <PushOptIn publicKey={vapid.publicKey} />}
      {/* Depois das 19h a gestão abre o dia pelo resumo; antes disso o que pede ação agora vem primeiro e o resumo fica recolhido logo abaixo. */}
      {mode.highlight && summaryBlock && <div className="mt-8">{summaryBlock}</div>}
      <Stagger className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-6" itemClassNames={["col-span-2", "", ""]}>
        <div data-testid="hero-esperando" className={`h-full rounded-[var(--radius-panel)] p-5 lg:p-6 flex flex-wrap items-end justify-between gap-x-4 gap-y-4 ${late ? "bg-alert-soft border border-alert/40" : "bg-ink text-paper"}`}>
          <div>
            <p className={`text-sm ${late ? "text-alert" : "text-paper/70"}`}>Esperando resposta agora</p>
            <p className={`font-serif text-[64px] leading-none font-light mt-2 tabular ${late ? "text-alert" : ""}`}>{t.waiting.length}</p>
            {late ? (
              <Link href={queueHref({ foco: "atrasados" })} className="mt-1 -ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius-control)] px-2 text-sm font-semibold text-alert underline decoration-alert/40 underline-offset-4 hover:decoration-alert">
                {plural(late, "atrasado", "atrasados")} · ver na fila <IconArrowRight size={14} />
              </Link>
            ) : <p className="text-sm mt-2 text-paper/60">{t.waiting.length ? "nenhum atrasado" : "ninguém esperando"}</p>}
          </div>
          {next && (
            <Link href={leadHref(next.id)} className={`h-11 px-4 rounded-[var(--radius-control)] inline-flex items-center gap-2 text-base font-semibold shrink-0 transition-transform active:scale-[0.98] ${late ? "bg-alert text-white" : "bg-gold text-ink"}`}>
              Atender próximo <IconArrowRight size={16} />
            </Link>
          )}
        </div>
        <div className="h-full rounded-[var(--radius-card)] border border-line bg-paper p-4 lg:p-5">
          <p className="text-sm text-graphite">Tempo médio de resposta</p>
          <p className={`font-serif text-[34px] leading-none font-light mt-2 tabular ${t.resp.n && t.resp.avg > t.resp.goal ? "text-alert" : "text-ink"}`}>{t.resp.n ? fmt(t.resp.avg) : "—"}</p>
          <p className="text-xs text-muted mt-2">{t.resp.n ? `${t.resp.within} de ${t.resp.n} dentro da meta de ${fmt(t.resp.goal)}` : `meta: ${fmt(t.resp.goal)}`}</p>
        </div>
        <div className="h-full rounded-[var(--radius-card)] border border-line bg-paper p-4 lg:p-5">
          <p className="text-sm text-graphite">Hoje</p>
          <p className="font-serif text-[34px] leading-none font-light mt-2 tabular">{t.counts.novos} <span className="text-base text-graphite font-sans">novos</span></p>
          <p className="text-xs text-muted mt-2">{t.scheduled.length} agendado{t.scheduled.length === 1 ? "" : "s"} · {t.counts.abertos} em andamento</p>
        </div>
      </Stagger>
      {!mode.highlight && summaryBlock && <div className="mt-5">{summaryBlock}</div>}
      <div className="grid lg:grid-cols-[1.35fr_1fr] gap-5 mt-6">
        <div className="flex flex-col gap-5 min-w-0">
        <section aria-labelledby="h-proximas" className="rounded-[var(--radius-panel)] border border-line bg-paper">
          <header className="flex items-center justify-between px-5 pt-4 pb-3">
            <h2 id="h-proximas" className="font-serif text-[22px] font-light">Minhas próximas ações</h2>
            <span className="text-sm text-muted tabular">{t.tasks.length ? plural(t.tasks.filter((x) => x.overdue).length, "vencida", "vencidas") : ""}</span>
          </header>
          <NextActions items={t.tasks} nowMs={now.getTime()} />
        </section>
        <section aria-labelledby="h-comparecimentos" className="rounded-[var(--radius-panel)] border border-line bg-paper">
          <header className="px-5 pt-4 pb-3">
            <h2 id="h-comparecimentos" className="font-serif text-[22px] font-light">Comparecimentos de ontem</h2>
            <p className="text-sm text-muted mt-0.5">Agendados sem Compareceu ou Faltou, e os de hoje que já passaram do horário.</p>
          </header>
          <AttendanceList items={t.attendance} nowMs={now.getTime()} />
        </section>
        <section className="rounded-[var(--radius-panel)] border border-line bg-paper">
          <header className="flex items-center justify-between px-5 pt-4 pb-3">
            <h2 className="font-serif text-[22px] font-light">Esperando resposta</h2>
            <Link href="/atendimento" className="text-sm text-gold-ink hover:underline">Abrir a fila</Link>
          </header>
          <WaitingList items={t.waiting} />
        </section>
        </div>
        <div className="flex flex-col gap-5 min-w-0">
          <Block title="Agenda de hoje" icon={<IconCalendar size={16} />} items={t.scheduled} empty="Nenhum agendamento hoje."
            render={(i) => new Date(i.at!).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Bahia" })} />
          <section className="rounded-[var(--radius-panel)] border border-line bg-paper px-5 py-4">
            <h2 className="flex items-center gap-2 text-base font-semibold"><span className="text-gold"><IconClock size={16} /></span>Parados agora<span className="text-muted font-normal tabular">{t.stale.reduce((a, r) => a + r.parados, 0) || ""}</span></h2>
            {t.stale.length === 0 ? <p className="text-sm text-muted mt-2">Ninguém parado além do limite da etapa.</p> : (
              <ul className="mt-2 divide-y divide-line/70">
                {t.stale.map((r) => (
                  <li key={r.stageKey}>
                    <Link href={staleHref(r.stageKey)} className="flex min-h-11 items-center justify-between gap-3 text-sm hover:text-gold-ink transition-colors">
                      <span className="truncate">{r.stage}</span><span className="text-muted shrink-0 tabular">{plural(r.parados, "parado", "parados")}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <Block title="Follow-ups" icon={<IconRefresh size={16} />} items={t.followups} empty="Ninguém em follow-up." render={(i) => i.stageName} />
          <Block title="Cobranças e recontatos" icon={<IconMoney size={16} />} items={t.dues} empty="Nada para hoje." render={(i) => i.extra ?? ""} />
          <Block title="Aniversários da semana" icon={<IconCake size={16} />} items={t.birthdays} empty="Nenhum aniversário nos próximos 7 dias." render={(i) => i.extra ?? ""} />
        </div>
      </div>
    </main>
  );
}

function Block({ title, icon, items, empty, render }: { title: string; icon: React.ReactNode; items: TodayItem[]; empty: string; render: (i: TodayItem) => string }) {
  return (
    <section className="rounded-[var(--radius-panel)] border border-line bg-paper px-5 py-4">
      <h2 className="flex items-center gap-2 text-base font-semibold"><span className="text-gold">{icon}</span>{title}<span className="text-muted font-normal tabular">{items.length || ""}</span></h2>
      {items.length === 0 ? <p className="text-sm text-muted mt-2">{empty}</p> : (
        <ul className="mt-2 divide-y divide-line/70">
          {items.slice(0, 6).map((i) => (
            <li key={i.id + (i.extra ?? "")}>
              <Link href={leadHref(i.id)} className="flex min-h-11 items-center justify-between gap-3 text-sm hover:text-gold-ink transition-colors">
                <span className="truncate">{i.name ?? formatPhoneClient(i.phone)}</span><span className="text-muted text-sm shrink-0">{render(i)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
