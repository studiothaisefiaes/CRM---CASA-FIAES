import Link from "next/link";
import { compareMetric, insufficientText, MIN_SAMPLE, shareText } from "@/lib/report-format";
import { dateTime, money, PAYMENT_LABEL, seconds } from "@/lib/format";
import { leadHref } from "@/lib/lead-href";
import { ClientLink } from "@/components/contacts/client-link";
import { formatPhoneClient, nameFallback } from "@/lib/phone-client";
import type { Analysis } from "@/server/reports/screen";
import type { ChargeItem } from "@/server/reports/queries";
import { Bullet } from "./bullet";
import { DataList, type Col } from "./data-list";
import { Delta } from "./delta";
import { Heatmap } from "./heatmap";
import { Muted, Section } from "./section";
import { brDay } from "@/lib/salon-period";

const KIND_LABEL: Record<string, string> = { proxima_acao: "Combinado", retorno: "Retorno", comparecimento: "Comparecimento", geral: "Geral" };

/** Análise: R10 (follow-up), R11 (mapa de calor), retorno por coorte e, só para a gestão, R7 (pessoa contra a meta) e R13 (financeiro). */
export function AnalysisTab({ data: d, qs }: { data: Analysis; qs: string }) {
  const csv = (tipo: string, label: string) => ({ href: `/api/relatorios/${tipo}?${qs}`, label });
  return (
    <div className="flex flex-col gap-10">
      <Followup d={d} csv={csv("followup", "eficácia da retomada")} />
      <Section id="calor" title="Quando as clientes escrevem" lead="Mensagens recebidas por dia da semana e hora." csv={csv("calor", "mapa de calor")} legend="calor">
        <Heatmap grid={d.heatmap} />
      </Section>
      {d.cohort && <Cohort c={d.cohort} />}
      {d.people && <People d={d} csv={csv("pessoas", "pessoa contra a meta")} />}
      <Replies r={d.replies} />
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
    <Section id="followup" title="A retomada funciona?" lead="Tarefas com prazo no período, por tipo." csv={csv} legend="followup">
      {d.followup.length === 0 ? <Muted>{insufficientText(0)}</Muted> : <DataList rows={d.followup} cols={cols} rowKey={(r) => r.kind} caption="Eficácia da retomada por tipo de tarefa" />}
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
                  <span className="font-medium text-base">{p.name}</span>
                  <span className="tabular text-base text-graphite">tempo típico <b className="text-ink">{seconds(p.p50 ?? 0)}</b> · meta {seconds(p.goalSeconds)} · {p.slaHitPct}% no prazo · {p.n} {p.n === 1 ? "resposta" : "respostas"}</span>
                </div>
                <Bullet value={p.p50 ?? 0} target={p.goalSeconds} previous={p.previous?.p50 ?? null} delay={i * 0.05} label={`${p.name}: tempo típico de ${seconds(p.p50 ?? 0)} contra meta de ${seconds(p.goalSeconds)}`} />
                <div className="mt-1 text-sm text-muted">
                  {cmp && p.previous ? <Delta c={cmp} prevText={`antes: ${seconds(p.previous.p50 ?? 0)} (${p.previous.n} ${p.previous.n === 1 ? "resposta" : "respostas"})`} /> : "Sem período anterior com 20 casos para comparar."}
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
  const f = d.finance!, s = d.salon;
  const methodCols: Col<(typeof f.byMethod)[number]>[] = [
    { key: "m", label: "Forma de pagamento", render: (m) => (m.method ? PAYMENT_LABEL[m.method] ?? m.method : "Não informada") },
    { key: "n", label: "Vendas", align: "right", render: (m) => m.n },
    { key: "t", label: "Vendido", align: "right", render: (m) => money(m.totalCents) },
    { key: "p", label: "Pago", align: "right", render: (m) => money(m.pagoCents) },
  ];
  const salonCols: Col<NonNullable<typeof s>["byMethod"][number]>[] = [
    { key: "m", label: "Forma de pagamento", render: (m) => m.method },
    { key: "n", label: "Pagamentos", align: "right", render: (m) => m.n },
    { key: "v", label: "Recebido", align: "right", render: (m) => money(m.cents) },
  ];
  return (
    <Section id="financeiro" title="Financeiro" lead="Faturamento do salão (comandas do Avec e do CRM) e as vendas fechadas no atendimento." csv={csv} legend="financeiro">
      {s && (
        <div className="flex flex-col gap-4 mb-10">
          <div>
            <h3 className="text-base font-medium">No salão (comandas)</h3>
            <p className="text-sm text-muted mt-0.5" data-testid="fonte-financeiro">{s.avecUntil ? `Fonte: Avec até ${brDay(s.avecUntil)}` : "Ainda não há dados do Avec"} · comandas do CRM entram junto</p>
          </div>
          {s.comandas === 0 && s.recebidoCents === 0 ? <Muted>Nenhuma comanda no período.</Muted> : (
            <>
              <dl className="grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-4">
                <Fig label="Faturado" value={money(s.faturadoCents)} sub={`${s.comandas} ${s.comandas === 1 ? "comanda" : "comandas"}`} big />
                <Fig label="Recebido" value={money(s.recebidoCents)} />
              </dl>
              {s.byMethod.length > 0 && <DataList rows={s.byMethod} cols={salonCols} rowKey={(m) => m.method} caption="Recebido no salão por forma de pagamento" />}
            </>
          )}
        </div>
      )}
      <h3 className="text-base font-medium mb-3">Vendas fechadas no atendimento</h3>
      {f.vendas === 0 ? <Muted>Nenhuma venda fechada no atendimento no período.</Muted> : (
        <div className="flex flex-col gap-6">
          <dl className="grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-4">
            <Fig label="Vendido" value={money(f.totalCents)} sub={`${f.vendas} ${f.vendas === 1 ? "venda" : "vendas"}`} big />
            <Fig label="Pago" value={money(f.pagoCents)} />
            <Fig label="A receber" value={money(f.aReceberCents)} />
            <Fig label="Valor médio por venda" value={f.ticketCents == null ? "—" : money(f.ticketCents)} sub={`${f.vendasComValor} ${f.vendasComValor === 1 ? "venda com valor" : "vendas com valor"}`} />
          </dl>
          <DataList rows={f.byMethod} cols={methodCols} rowKey={(m) => m.method ?? "x"} caption="Vendas por forma de pagamento" />
        </div>
      )}
      <div className="grid md:grid-cols-2 gap-x-14 gap-y-6 mt-8">
        <Charges title="Cobranças vencidas" tone="alert" data={f.vencidas} />
        <Charges title="Cobranças a vencer" tone="ink" data={f.aVencer} />
      </div>
      <p className="mt-2"><a href={cobrancas.href} download className="inline-flex items-center min-h-11 text-sm text-gold-ink underline underline-offset-2" aria-label="Baixar CSV: cobranças">Baixar CSV das cobranças</a></p>
    </Section>
  );
}

function Fig({ label, value, sub, big }: { label: string; value: string; sub?: string; big?: boolean }) {
  return (
    <div className="@container">
      <dt className="text-sm text-graphite">{label}</dt>
      <dd><p className={`font-display font-medium leading-none tabular mt-1 whitespace-nowrap ${big ? "text-[clamp(24px,18cqw,40px)]" : "text-2xl"}`}>{value}</p>{sub && <p className="text-sm text-muted mt-1.5 tabular">{sub}</p>}</dd>
    </div>
  );
}

function Charges({ title, data, tone }: { title: string; data: { n: number; cents: number; items: ChargeItem[] }; tone: "alert" | "ink" }) {
  return (
    <div>
      <h3 className="text-sm font-medium text-graphite">{title}</h3>
      <p className="mt-1 tabular"><b className={`font-display text-2xl font-medium ${tone === "alert" && data.n ? "text-alert" : ""}`}>{data.n}</b> <span className="text-base text-graphite">{data.n === 1 ? "cobrança" : "cobranças"} · {money(data.cents)} a receber</span></p>
      {data.items.length > 0 && (
        <ul className="mt-2">
          {data.items.slice(0, 8).map((c) => (
            <li key={c.id} className="relative border-t border-line">
              <Link href={leadHref(c.id)} aria-label={`Abrir conversa: cobrança de ${c.name ?? nameFallback(c.phone)}`} className="absolute inset-0" />
              <div className="pointer-events-none flex flex-wrap items-baseline justify-between gap-x-3 min-h-11 py-2 text-base">
                <ClientLink contactId={c.contactId} name={c.name ?? nameFallback(c.phone)} className="pointer-events-auto">{c.name ?? nameFallback(c.phone)}</ClientLink>
                <span className="tabular text-muted">{dateTime(c.chargeAt)} · {money(c.remainingCents)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
      {data.n > 8 && <p className="text-sm text-muted mt-1">Mostrando 8 de {data.n}. O CSV traz até 30.</p>}
    </div>
  );
}

const monthLabel = (k: string) => new Date(`${k}-15T12:00:00Z`).toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });

function Cohort({ c }: { c: NonNullable<Analysis["cohort"]> }) {
  type R = (typeof c.rows)[number];
  const cell = (w: { base: number; voltou: number }) => (w.base === 0 ? <span className="text-muted">ainda não dá</span> : shareText(w.voltou, w.base));
  const cols: Col<R>[] = [
    { key: "m", label: "Mês da primeira visita", render: (r) => monthLabel(r.month) },
    { key: "n", label: "Clientes novas", align: "right", render: (r) => r.novas },
    { key: "30", label: "Voltou em 30 dias", align: "right", render: (r) => cell(r.d30) },
    { key: "60", label: "Em 60 dias", align: "right", render: (r) => cell(r.d60) },
    { key: "90", label: "Em 90 dias", align: "right", render: (r) => cell(r.d90) },
  ];
  return (
    <Section id="coorte" title="Retorno das clientes novas" legend="coorte"
      lead={`Clientes que vieram pela primeira vez em cada mês e quantas voltaram. Visitas: comandas e horários finalizados${c.dataEnd ? `, até ${brDay(c.dataEnd)}` : ""}.`}>
      {c.rows.length === 0 ? <Muted>Nenhuma cliente nova nos últimos 12 meses (ou o Avec ainda não foi importado).</Muted>
        : <DataList rows={c.rows} cols={cols} rowKey={(r) => r.month} caption="Retorno das clientes novas" />}
    </Section>
  );
}

function Replies({ r }: { r: Analysis["replies"] }) {
  type R = (typeof r.rows)[number];
  const cols: Col<R>[] = [
    { key: "p", label: "Quem respondeu", render: (x) => x.name },
    { key: "n", label: "Respostas", align: "right", render: (x) => x.n },
    { key: "m", label: "Tempo típico", align: "right", render: (x) => (x.p50 == null ? "—" : seconds(x.p50)) },
    { key: "s", label: "No prazo", align: "right", render: (x) => shareText(x.slaHit, x.n) ?? "—" },
  ];
  return (
    <Section id="resposta-autora" title="Tempo de resposta por atendente" legend="respostaAutora"
      lead="Todas as respostas do período, pela assinatura (*NOME - CASA FIAES:*) ou por quem estava no CRM.">
      {r.rows.length === 0 ? <Muted>Nenhuma resposta com autora no período.</Muted> : <DataList rows={r.rows} cols={cols} rowKey={(x) => x.userId} caption="Tempo de resposta por atendente" />}
      {r.semAutora > 0 && <p className="text-sm text-muted mt-2">{r.semAutora} {r.semAutora === 1 ? "resposta sem autora" : "respostas sem autora"} (áudio, foto ou celular sem assinatura) fora da tabela.</p>}
    </Section>
  );
}
