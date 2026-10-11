import Link from "next/link";
import { compareMetric, insufficientText, MIN_SAMPLE } from "@/lib/report-format";
import { dateTime, money, PAYMENT_LABEL, seconds } from "@/lib/format";
import { leadHref } from "@/lib/lead-href";
import { formatPhoneClient } from "@/lib/phone-client";
import type { Analysis } from "@/server/reports/screen";
import type { ChargeItem } from "@/server/reports/queries";
import { Bullet } from "./bullet";
import { DataList, type Col } from "./data-list";
import { Delta } from "./delta";
import { Heatmap } from "./heatmap";
import { Badge } from "@/components/ui/badge";
import { Muted, Section } from "./section";

/**
 * Retorno por coorte depende da exportação de atendimentos do Avec (spec D9): o lugar existe, mas sem número, gráfico nem esqueleto
 * que pareça dado. Some quando a importação do Avec existir.
 */
function BlockedAvec() {
  return (
    <section aria-labelledby="coorte-t" className="border-t border-line pt-6">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 id="coorte-t" className="font-serif text-[22px] lg:text-[28px] leading-tight font-light">Retorno por coorte</h2>
        <Badge>Bloqueado</Badge>
      </div>
      <p className="text-[14px] text-graphite mt-1">Depende da exportação de atendimentos do Avec, que ainda não está disponível.</p>
    </section>
  );
}

const KIND_LABEL: Record<string, string> = { proxima_acao: "Próxima ação", retorno: "Retorno", comparecimento: "Comparecimento", geral: "Geral" };

/** Análise: R10 (follow-up), R11 (mapa de calor), retorno por coorte bloqueado (Avec) e, só para a gestão, R7 (pessoa contra a meta) e R13 (financeiro). */
export function AnalysisTab({ data: d, qs }: { data: Analysis; qs: string }) {
  const csv = (tipo: string, label: string) => ({ href: `/api/relatorios/${tipo}?${qs}`, label });
  return (
    <div className="flex flex-col gap-10">
      <Followup d={d} csv={csv("followup", "eficácia do follow-up")} />
      <Section id="calor" title="Quando as clientes escrevem" lead="Mensagens recebidas por dia da semana e hora." csv={csv("calor", "mapa de calor")} legend="calor">
        <Heatmap grid={d.heatmap} />
      </Section>
      <BlockedAvec />
      {d.people && <People d={d} csv={csv("pessoas", "pessoa contra a meta")} />}
      {d.finance && <Finance d={d} csv={csv("financeiro", "financeiro")} cobrancas={csv("cobrancas", "cobranças")} />}
    </div>
  );
}

function Followup({ d, csv }: { d: Analysis; csv: { href: string; label: string } }) {
  const cols: Col<(typeof d.followup)[number]>[] = [
    { key: "k", label: "Tipo de tarefa", render: (r) => KIND_LABEL[r.kind] ?? r.kind },
    { key: "p", label: "Previstas", align: "right", render: (r) => r.previstas },
    { key: "c", label: "Concluídas", align: "right", render: (r) => <>{r.concluidas}</> },
    { key: "np", label: "No prazo", align: "right", render: (r) => r.noPrazo },
    { key: "r", label: "Cliente respondeu", align: "right", render: (r) => (r.concluidas >= MIN_SAMPLE ? <><b>{r.comResposta}</b> <span className="text-muted">· {r.respostaPct}%</span></> : <>{r.comResposta} <span className="text-muted">de {r.concluidas}</span></>) },
    { key: "f", label: "Fechou depois", align: "right", render: (r) => r.fechados },
    { key: "x", label: "Canceladas", align: "right", render: (r) => <span className="text-muted">{r.canceladas}</span> },
  ];
  return (
    <Section id="followup" title="O follow-up funciona?" lead="Tarefas com prazo no período, por tipo." csv={csv} legend="followup">
      {d.followup.length === 0 ? <Muted>{insufficientText(0)}</Muted> : <DataList rows={d.followup} cols={cols} rowKey={(r) => r.kind} caption="Eficácia do follow-up por tipo de tarefa" />}
    </Section>
  );
}

function People({ d, csv }: { d: Analysis; csv: { href: string; label: string } }) {
  const people = d.people!;
  return (
    <Section id="pessoas" title="Cada pessoa contra a meta" lead="Em ordem alfabética, não é ranking. Só com 20 primeiras respostas ou mais." csv={csv} legend="pessoas">
      {people.length === 0 ? <Muted>Ninguém chegou a {MIN_SAMPLE} primeiras respostas no período. Com menos casos a comparação engana (n &lt; {MIN_SAMPLE}).</Muted> : (
        <ul className="flex flex-col gap-5">
          {people.map((p, i) => {
            const cmp = p.previous ? compareMetric(p.p50, p.previous.p50, { kind: "seconds", n: p.n, nPrev: p.previous.n, lowerIsBetter: true }) : null;
            return (
              <li key={p.userId}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 mb-1.5">
                  <span className="font-medium text-[16px]">{p.name}</span>
                  <span className="tabular text-[14px] text-graphite">mediana <b className="text-ink">{seconds(p.p50 ?? 0)}</b> · meta {seconds(p.goalSeconds)} · {p.slaHitPct}% no prazo · n = {p.n}</span>
                </div>
                <Bullet value={p.p50 ?? 0} target={p.goalSeconds} previous={p.previous?.p50 ?? null} delay={i * 0.05} label={`${p.name}: mediana de ${seconds(p.p50 ?? 0)} contra meta de ${seconds(p.goalSeconds)}`} />
                <div className="mt-1 text-[13px] text-muted">
                  {cmp && p.previous ? <Delta c={cmp} prevText={`antes: ${seconds(p.previous.p50 ?? 0)} (n = ${p.previous.n})`} /> : "Sem período anterior com 20 casos para comparar."}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

function Finance({ d, csv, cobrancas }: { d: Analysis; csv: { href: string; label: string }; cobrancas: { href: string; label: string } }) {
  const f = d.finance!;
  const methodCols: Col<(typeof f.byMethod)[number]>[] = [
    { key: "m", label: "Forma de pagamento", render: (m) => (m.method ? PAYMENT_LABEL[m.method] ?? m.method : "Não informada") },
    { key: "n", label: "Vendas", align: "right", render: (m) => m.n },
    { key: "t", label: "Vendido", align: "right", render: (m) => money(m.totalCents) },
    { key: "p", label: "Pago", align: "right", render: (m) => money(m.pagoCents) },
  ];
  return (
    <Section id="financeiro" title="Financeiro" lead="Vendas fechadas no período." csv={csv} legend="financeiro">
      {f.vendas === 0 ? <Muted>Nenhuma venda fechada no período (n = 0).</Muted> : (
        <div className="flex flex-col gap-6">
          <dl className="grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-4">
            <Fig label="Vendido" value={money(f.totalCents)} sub={`${f.vendas} ${f.vendas === 1 ? "venda" : "vendas"}`} big />
            <Fig label="Pago" value={money(f.pagoCents)} />
            <Fig label="A receber" value={money(f.aReceberCents)} />
            <Fig label="Ticket médio" value={f.ticketCents == null ? "—" : money(f.ticketCents)} sub={`n = ${f.vendasComValor} ${f.vendasComValor === 1 ? "venda com valor" : "vendas com valor"}`} />
          </dl>
          <DataList rows={f.byMethod} cols={methodCols} rowKey={(m) => m.method ?? "x"} caption="Vendas por forma de pagamento" />
        </div>
      )}
      <div className="grid md:grid-cols-2 gap-x-14 gap-y-6 mt-8">
        <Charges title="Cobranças vencidas" tone="alert" data={f.vencidas} />
        <Charges title="Cobranças a vencer" tone="ink" data={f.aVencer} />
      </div>
      <p className="mt-2"><a href={cobrancas.href} download className="inline-flex items-center min-h-11 text-[13px] text-gold-ink underline underline-offset-2" aria-label="Baixar CSV: cobranças">Baixar CSV das cobranças</a></p>
    </Section>
  );
}

function Fig({ label, value, sub, big }: { label: string; value: string; sub?: string; big?: boolean }) {
  return (
    <div className="@container">
      <dt className="text-[13px] text-graphite">{label}</dt>
      <dd><p className={`font-serif font-light leading-none tabular mt-1 whitespace-nowrap ${big ? "text-[clamp(24px,18cqw,40px)]" : "text-[28px]"}`}>{value}</p>{sub && <p className="text-[13px] text-muted mt-1.5 tabular">{sub}</p>}</dd>
    </div>
  );
}

function Charges({ title, data, tone }: { title: string; data: { n: number; cents: number; items: ChargeItem[] }; tone: "alert" | "ink" }) {
  return (
    <div>
      <h3 className="text-[13px] font-medium text-graphite">{title}</h3>
      <p className="mt-1 tabular"><b className={`font-serif text-[28px] font-light ${tone === "alert" && data.n ? "text-alert" : ""}`}>{data.n}</b> <span className="text-[14px] text-graphite">{data.n === 1 ? "cobrança" : "cobranças"} · {money(data.cents)} a receber</span></p>
      {data.items.length > 0 && (
        <ul className="mt-2">
          {data.items.slice(0, 8).map((c) => (
            <li key={c.id} className="border-t border-line">
              <Link href={leadHref(c.id)} className="flex flex-wrap items-baseline justify-between gap-x-3 min-h-11 py-2 text-[14px] hover:text-gold-ink">
                <span>{c.name ?? formatPhoneClient(c.phone)}</span>
                <span className="tabular text-muted">{dateTime(c.chargeAt)} · {money(c.remainingCents)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {data.n > 8 && <p className="text-[13px] text-muted mt-1">Mostrando 8 de {data.n}. O CSV traz até 30.</p>}
    </div>
  );
}
