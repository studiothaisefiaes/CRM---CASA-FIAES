import { seconds } from "@/lib/format";
import Link from "next/link";
import { requireUser } from "@/server/auth/session";
import { getToday, type TodayItem } from "@/server/queries/today";
import { WaitingList } from "@/components/today/waiting-list";
import { Stagger } from "@/components/today/stagger";
import { IconCalendar, IconCake, IconMoney, IconRefresh, IconArrowRight } from "@/components/icons";
import { formatPhoneClient } from "@/lib/phone-client";

export const metadata = { title: "Hoje" };

function greeting() {
  const h = Number(new Date().toLocaleString("pt-BR", { hour: "2-digit", hour12: false, timeZone: "America/Bahia" }));
  return h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
}

export default async function HojePage({ searchParams }: PageProps<"/">) {
  const user = await requireUser();
  const t = await getToday(user);
  const sp = await searchParams;
  const late = t.late;
  const date = new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", timeZone: "America/Bahia" });
  const fmt = seconds;
  const next = t.waiting[0];
  return (
    <main className="px-5 lg:px-8 pt-6 lg:pt-9 pb-12 max-w-[1240px]">
      {sp.aviso === "sem-permissao" && <p className="mb-5 text-sm bg-gold-soft text-gold-ink rounded-[var(--radius-control)] px-3 py-2">Só a gestão tem acesso às configurações.</p>}
      <p className="text-sm text-muted first-letter:uppercase">{date}</p>
      <h1 className="font-serif text-[40px] lg:text-[48px] leading-none font-light mt-1">{greeting()}, {user.name.split(" ")[0]}.</h1>
      <Stagger className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-8" itemClassNames={["col-span-2", "", ""]}>
        <div className={`h-full rounded-[var(--radius-panel)] p-5 lg:p-6 flex flex-wrap items-end justify-between gap-x-4 gap-y-4 ${late ? "bg-alert-soft border border-alert/40" : "bg-ink text-paper"}`}>
          <div>
            <p className={`text-sm ${late ? "text-alert" : "text-paper/70"}`}>Esperando resposta agora</p>
            <p className={`font-serif text-[64px] leading-none font-light mt-2 tabular ${late ? "text-alert" : ""}`}>{t.waiting.length}</p>
            <p className={`text-sm mt-2 ${late ? "text-alert" : "text-paper/60"}`}>{late ? `${late} além do prazo` : t.waiting.length ? "todos dentro do prazo" : "ninguém esperando"}</p>
          </div>
          {next && (
            <Link href={`/funil?lead=${next.id}`} className={`h-11 px-4 rounded-[var(--radius-control)] inline-flex items-center gap-2 text-base font-semibold shrink-0 transition-transform active:scale-[0.98] ${late ? "bg-alert text-white" : "bg-gold text-ink"}`}>
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
      <div className="grid lg:grid-cols-[1.35fr_1fr] gap-5 mt-6">
        <section className="rounded-[var(--radius-panel)] border border-line bg-paper">
          <header className="flex items-center justify-between px-5 pt-4 pb-3">
            <h2 className="font-serif text-[22px] font-light">Esperando resposta</h2>
            <Link href="/funil" className="text-sm text-gold-ink hover:underline">Abrir funil</Link>
          </header>
          <WaitingList items={t.waiting} />
        </section>
        <div className="flex flex-col gap-5">
          <Block title="Agenda de hoje" icon={<IconCalendar size={16} />} items={t.scheduled} empty="Nenhum agendamento hoje."
            render={(i) => new Date(i.at!).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Bahia" })} />
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
              <Link href={`/funil?lead=${i.id}`} className="flex items-center justify-between gap-3 py-2 text-sm hover:text-gold-ink transition-colors">
                <span className="truncate">{i.name ?? formatPhoneClient(i.phone)}</span><span className="text-muted text-sm shrink-0">{render(i)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
