import Link from "next/link";
import { requireUser } from "@/server/auth/session";
import { getToday, type TodayItem } from "@/server/queries/today";
import { WaitingList } from "@/components/today/waiting-list";
import { Stagger } from "@/components/today/stagger";
import { IconCalendar, IconCake, IconMoney, IconRefresh } from "@/components/icons";
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
  const late = t.waiting.filter((w) => w.slaMinutes && w.at && Date.now() - new Date(w.at).getTime() >= w.slaMinutes * 60_000).length;
  const date = new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", timeZone: "America/Bahia" });
  const stats = [
    { label: "Esperando resposta", value: t.waiting.length, tone: late ? "text-alert" : "text-ink", note: late ? `${late} atrasado${late > 1 ? "s" : ""}` : "nenhum atrasado" },
    { label: "Leads novos hoje", value: t.counts.novos, tone: "text-ink", note: `${t.counts.abertos} em andamento` },
    { label: "Agendados hoje", value: t.scheduled.length, tone: "text-ink", note: "avaliações e atendimentos" },
    { label: "Atrasos hoje", value: t.counts.atrasos, tone: t.counts.atrasos ? "text-alert" : "text-ink", note: "respostas fora do prazo" },
  ];
  return (
    <main className="px-5 lg:px-8 pt-6 lg:pt-9 pb-12 max-w-[1240px]">
      {sp.aviso === "sem-permissao" && <p className="mb-5 text-[13px] bg-gold-soft text-gold-ink rounded-[10px] px-3 py-2">Só a gestão tem acesso às configurações.</p>}
      <p className="text-[13px] text-muted first-letter:uppercase">{date}</p>
      <h1 className="font-serif text-[40px] lg:text-[48px] leading-none font-light mt-1">{greeting()}, {user.name.split(" ")[0]}.</h1>
      <Stagger className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-8">
        {stats.map((s) => (
          <div key={s.label} className="rounded-[16px] border border-line bg-paper p-4 lg:p-5">
            <p className="text-[12.5px] text-graphite">{s.label}</p>
            <p className={`font-serif text-[44px] leading-none font-light mt-2 tabular ${s.tone}`}>{s.value}</p>
            <p className="text-[12px] text-muted mt-2">{s.note}</p>
          </div>
        ))}
      </Stagger>
      <div className="grid lg:grid-cols-[1.35fr_1fr] gap-5 mt-6">
        <section className="rounded-[18px] border border-line bg-paper">
          <header className="flex items-center justify-between px-5 pt-4 pb-3">
            <h2 className="font-serif text-[22px] font-light">Esperando resposta</h2>
            <Link href="/funil" className="text-[13px] text-gold-ink hover:underline">Abrir funil</Link>
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
    <section className="rounded-[18px] border border-line bg-paper px-5 py-4">
      <h2 className="flex items-center gap-2 text-[14px] font-semibold"><span className="text-gold">{icon}</span>{title}<span className="text-muted font-normal tabular">{items.length || ""}</span></h2>
      {items.length === 0 ? <p className="text-[13px] text-muted mt-2">{empty}</p> : (
        <ul className="mt-2 divide-y divide-line/70">
          {items.slice(0, 6).map((i) => (
            <li key={i.id + (i.extra ?? "")}>
              <Link href={`/funil?lead=${i.id}`} className="flex items-center justify-between gap-3 py-2 text-[13.5px] hover:text-gold-ink transition-colors">
                <span className="truncate">{i.name ?? formatPhoneClient(i.phone)}</span><span className="text-muted text-[12.5px] shrink-0">{render(i)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
