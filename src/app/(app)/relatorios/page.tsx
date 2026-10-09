import type { ReactNode } from "react";
import { requireUser } from "@/server/auth/session";
import { funnel, responseTimes, origins, objections, finance, summary, PERIOD_LABEL, type Period } from "@/server/reports";
import { activeUsers } from "@/server/domain/deals";
import { getOrigins } from "@/server/queries/board";
import { PageHeader } from "@/components/page-header";
import { PeriodTabs } from "@/components/reports/period-tabs";
import { Bar, CountUp } from "@/components/reports/bars";
import { Stagger } from "@/components/today/stagger";
import { IconDownload } from "@/components/icons";
import { formatPhoneClient } from "@/lib/phone-client";

export const metadata = { title: "Relatórios" };
const PAY: Record<string, string> = { pix: "Pix", cartao: "Cartão", boleto: "Boleto", dinheiro: "Dinheiro" };
const secs = (s: number) => (s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : `${Math.round(s / 3600)}h`);

export default async function RelatoriosPage({ searchParams }: PageProps<"/relatorios">) {
  const user = await requireUser();
  const sp = await searchParams;
  const period = (["hoje", "7d", "mes", "ano"].includes(String(sp.periodo)) ? sp.periodo : "mes") as Period;
  // Atendimento vê os próprios números; a gestão vê todos e filtra por pessoa.
  const f = { period, ownerId: user.role === "gestor" ? (typeof sp.dono === "string" ? sp.dono : null) : user.id, origin: typeof sp.origem === "string" ? sp.origem : null };
  const qs = new URLSearchParams({ periodo: period, ...(f.ownerId ? { dono: f.ownerId } : {}), ...(f.origin ? { origem: f.origin } : {}) }).toString();
  const [fun, resp, orig, obj, fin, sum, people, originList] = await Promise.all([funnel(f), responseTimes(f), origins(f), objections(f), finance(f), summary(f), activeUsers(), getOrigins()]);
  const base = fun[0]?.reached ?? 0;
  const maxResp = Math.max(...resp.map((r) => r.avgSeconds), resp[0]?.goalSeconds ?? 120, 1);
  const convRate = sum.leads ? Math.round((sum.won / sum.leads) * 100) : 0;
  return (
    <main className="pb-14">
      <PageHeader title="Relatórios" subtitle={`${PERIOD_LABEL[period]} · números reais do CRM`} actions={<PeriodTabs people={user.role === "gestor" ? people : []} origins={originList} />} />
      <div className="px-5 lg:px-8 flex flex-col gap-5 max-w-[1280px]">
        <Stagger className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[["Leads no período", sum.leads, "int"], ["Fechados", sum.won, "int"], ["Conversão", convRate, "pct"], ["Total fechado", fin.totalCents, "brl"]].map(([l, v, k]) => (
            <div key={l as string} className="rounded-[16px] border border-line bg-paper p-5">
              <p className="text-[12.5px] text-graphite">{l}</p>
              <p className="font-serif text-[40px] leading-none font-light mt-2">{k === "pct" ? <><CountUp value={v as number} />%</> : <CountUp value={v as number} format={k as "brl" | "int"} />}</p>
            </div>
          ))}
        </Stagger>
        <div className="grid lg:grid-cols-2 gap-5">
          <Panel title="Funil" csv={`funil?${qs}`}>
            {base === 0 ? <Empty /> : fun.filter((s) => s.kind !== "perdido").map((s, i) => (
              <div key={s.key} className="grid grid-cols-[110px_1fr_70px] items-center gap-3 py-1.5">
                <span className="text-[13px]">{s.name}</span><Bar value={s.reached} max={base} delay={i * 0.06} tone={s.kind === "fechado" ? "ok" : "gold"} />
                <span className="text-[12.5px] text-right tabular"><b>{s.reached}</b> <span className="text-muted">{Math.round((s.reached / base) * 100)}%</span></span>
              </div>
            ))}
          </Panel>
          <Panel title="Tempo de resposta por pessoa" csv={`resposta?${qs}`} note={resp[0] ? `Meta: ${secs(resp[0].goalSeconds)} · linha tracejada` : undefined}>
            {resp.length === 0 ? <Empty /> : resp.map((r, i) => (
              <div key={r.userId ?? "x"} className="py-2">
                <div className="flex justify-between text-[13px] mb-1.5"><span className="font-medium">{r.name}</span>
                  <span className="tabular"><b className={r.avgSeconds > r.goalSeconds ? "text-alert" : "text-ok"}>{secs(r.avgSeconds)}</b> <span className="text-muted">média · {Math.round((r.withinGoal / r.responses) * 100)}% na meta · {r.alerts} atraso{r.alerts === 1 ? "" : "s"}</span></span></div>
                <Bar value={r.avgSeconds} max={maxResp * 1.1} goal={r.goalSeconds} delay={i * 0.06} tone={r.avgSeconds > r.goalSeconds ? "alert" : "ink"} />
              </div>
            ))}
          </Panel>
          <Panel title="Origem dos leads" csv={`origem?${qs}`}>
            {orig.length === 0 ? <Empty /> : orig.map((o, i) => (
              <div key={o.origin} className="grid grid-cols-[110px_1fr_110px] items-center gap-3 py-1.5">
                <span className="text-[13px] truncate">{o.origin}</span><Bar value={o.leads} max={orig[0].leads} delay={i * 0.06} />
                <span className="text-[12.5px] text-right tabular"><b>{o.leads}</b> <span className="text-muted">· {o.won} fechado{o.won === 1 ? "" : "s"}</span></span>
              </div>
            ))}
          </Panel>
          <Panel title="Objeções e motivos de perda" csv={`objecoes?${qs}`}>
            {obj.objections.length + obj.lostReasons.length === 0 ? <Empty text="Ainda sem objeções registradas nos cards." /> : (
              <div className="grid grid-cols-2 gap-5">
                {[["Objeções", obj.objections], ["Motivos de perda", obj.lostReasons]].map(([label, list]) => (
                  <div key={label as string}><p className="text-[12px] text-muted mb-1">{label as string}</p>
                    {(list as { label: string; n: number }[]).map((x, i, arr) => <div key={x.label} className="py-1.5"><div className="flex justify-between text-[13px] mb-1"><span>{x.label}</span><b className="tabular">{x.n}</b></div><Bar value={x.n} max={arr[0].n} delay={i * 0.05} tone="ink" /></div>)}
                  </div>
                ))}
              </div>
            )}
          </Panel>
          <Panel title="Financeiro das vendas" csv={`financeiro?${qs}`} className="lg:col-span-2">
            <div className="grid lg:grid-cols-[1fr_1.2fr] gap-6">
              <div>
                <p className="font-serif text-[44px] leading-none font-light"><CountUp value={fin.totalCents} format="brl" /></p>
                <p className="text-[13px] text-graphite mt-2">{fin.deals} venda{fin.deals === 1 ? "" : "s"} · ticket médio <b className="text-ink">{(fin.ticketCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</b></p>
                <div className="mt-4 flex flex-col gap-2">{fin.byMethod.map((m, i) => (
                  <div key={m.method ?? "x"}><div className="flex justify-between text-[13px] mb-1"><span>{m.method ? PAY[m.method] : "Não informado"}</span><span className="tabular">{(Number(m.totalCents) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</span></div><Bar value={Number(m.totalCents)} max={fin.totalCents} delay={i * 0.06} tone="ok" /></div>
                ))}</div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-2"><p className="text-[13px] font-semibold">Cobranças a vencer</p><a href={`/api/relatorios/cobrancas?${qs}`} className="text-[12.5px] text-gold-ink inline-flex items-center gap-1 hover:underline"><IconDownload size={13} />CSV</a></div>
                {fin.upcoming.length === 0 ? <p className="text-[13px] text-muted">Nenhuma cobrança marcada.</p> : (
                  <ul className="divide-y divide-line/70">{fin.upcoming.slice(0, 8).map((c) => (
                    <li key={c.id} className="flex justify-between py-2 text-[13px]"><span>{c.name ?? formatPhoneClient(c.phone)}</span><span className="text-muted tabular">{new Date(c.chargeAt).toLocaleDateString("pt-BR")}{c.valueCents ? ` · ${(c.valueCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}` : ""}</span></li>
                  ))}</ul>
                )}
              </div>
            </div>
          </Panel>
        </div>
      </div>
    </main>
  );
}

function Panel({ title, csv, note, children, className = "" }: { title: string; csv: string; note?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-[18px] border border-line bg-paper p-5 ${className}`}>
      <header className="flex items-center justify-between mb-3">
        <div><h2 className="font-serif text-[22px] font-light">{title}</h2>{note && <p className="text-[12px] text-muted">{note}</p>}</div>
        <a href={`/api/relatorios/${csv}`} className="h-8 px-3 inline-flex items-center gap-1.5 rounded-[9px] border border-line-strong text-[12.5px] hover:bg-paper-2"><IconDownload size={14} />Excel (CSV)</a>
      </header>
      {children}
    </section>
  );
}
const Empty = ({ text = "Sem dados no período." }: { text?: string }) => <p className="text-[13px] text-muted py-6 text-center">{text}</p>;
