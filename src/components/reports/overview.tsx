import Link from "next/link";
import { compareMetric, insufficientText, longSpan, MIN_SAMPLE, PREVIOUS_LABEL, shareText } from "@/lib/report-format";
import { seconds } from "@/lib/format";
import { staleHref, waitingHref, type LinkScope } from "@/lib/report-links";
import type { Period } from "@/server/reports/common";
import type { Overview } from "@/server/reports/screen";
import { money } from "@/lib/format";
import { Bar } from "./bars";
import { BandsBar } from "./bands";
import { Bullet } from "./bullet";
import { DataList, type Col } from "./data-list";
import { Delta } from "./delta";
import { ExecutiveNumbers } from "./executive-numbers";
import { FunnelMilestones } from "./funnel-milestones";
import { Muted, Section } from "./section";

export const numLink = "inline-flex items-center justify-end underline decoration-gold-ink/50 underline-offset-4 text-gold-ink font-semibold pointer-coarse:min-h-11 pointer-coarse:min-w-11";

/** Visão geral: R1, R2, R4, R5, R6, R8, R9, R16 e, no rodapé, R15. */
export function OverviewTab({ data: d, period, qs, gestor, scope }: { data: Overview; period: Period; qs: string; gestor: boolean; scope: LinkScope }) {
  const csv = (tipo: string, label: string) => ({ href: `/api/relatorios/${tipo}?${qs}`, label });
  return (
    <div className="flex flex-col gap-10">
      <p className="-mb-4 text-sm text-graphite">O resumo do dia fica em <Link href="/" className="font-medium text-gold-ink underline underline-offset-4">Hoje</Link>.</p>
      <Section id="numeros" title="Os números do período" csv={csv("numeros", "números do período")} legend="numeros">
        <ExecutiveNumbers numbers={d.numbers} slaHit={d.response.slaHit} slaN={d.response.n} previousLabel={PREVIOUS_LABEL[period]} />
      </Section>
      <div className="grid lg:grid-cols-2 gap-x-14 gap-y-10">
        <FirstResponse d={d} scope={scope} csv={csv("resposta", "primeira resposta")} />
        <Section id="funil" title="Do primeiro contato à venda" lead="Conversas novas do período, por marco." csv={csv("funil", "do primeiro contato à venda")} legend="funil">
          <FunnelMilestones m={d.funnel} />
        </Section>
        <Stale d={d} scope={scope} csv={csv("parados", "parados agora")} />
        <Channel d={d} csv={csv("canal", "CRM ou celular")} />
      </div>
      <Sources d={d} gestor={gestor} csv={csv("origem", "origem até a venda")} />
      <Losses d={d} csv={csv("objecoes", "perdas e objeções")} />
      <Quality d={d} csv={csv("qualidade", "qualidade dos dados")} />
    </div>
  );
}

function FirstResponse({ d, csv, scope }: { d: Overview; scope: LinkScope; csv: { href: string; label: string } }) {
  const r = d.response;
  const goal = r.byStage.find((s) => s.stage === "lead")?.slaSeconds ?? 120;
  const cmp = r.previous ? compareMetric(r.p50, r.previous.p50, { kind: "seconds", n: r.n, nPrev: r.previous.n, lowerIsBetter: true }) : null;
  return (
    <Section id="resposta" title="Primeira resposta" lead="Quanto a cliente esperou pela primeira resposta de uma pessoa." csv={csv} legend="resposta">
      {r.n === 0 ? <Muted>{insufficientText(0)}</Muted> : (
        <div className="flex flex-col gap-5">
          <div className="grid grid-cols-2 gap-x-6 gap-y-4">
            <div>
              <p className="text-sm text-graphite">Tempo típico</p>
              <p className="font-display text-2xl leading-none font-medium tabular mt-1">{seconds(r.p50 ?? 0)}</p>
              {cmp && cmp.direction !== "none" && <div className="mt-1.5"><Delta c={cmp} prevText={`antes: ${seconds(r.previous!.p50 ?? 0)} (${r.previous!.n} ${r.previous!.n === 1 ? "resposta" : "respostas"})`} /></div>}
            </div>
            <div>
              <p className="text-sm text-graphite">9 em cada 10 em até</p>
              <p className="font-display text-2xl leading-none font-medium tabular mt-1">{seconds(r.p90 ?? 0)}</p>
            </div>
          </div>
          <div>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm text-graphite mb-1.5">
              <span>Tempo típico contra a meta de {seconds(goal)}</span>
              <span className="tabular">{r.n} {r.n === 1 ? "resposta" : "respostas"} · {shareText(r.slaHit, r.n)} dentro do prazo</span>
            </div>
            <Bullet value={r.p50 ?? 0} target={goal} previous={r.previous?.p50 ?? null} label={`Tempo típico de ${seconds(r.p50 ?? 0)} contra a meta de ${seconds(goal)}`} />
            <p className="text-xs text-muted mt-1">Marca vermelha: meta. {r.previous?.p50 != null && "Tracejado: período anterior."}</p>
          </div>
          <BandsBar bands={r.bands} n={r.n} />
          {r.byStage.length > 1 && (
            <ul className="flex flex-col gap-3 border-t border-line pt-4" aria-label="Primeira resposta por etapa">
              {r.byStage.filter((s) => s.slaSeconds != null).map((s) => (
                <li key={s.stage}>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-base">
                    <span className="font-medium">{s.name}</span>
                    <span className="tabular text-graphite">tempo típico {seconds(s.p50 ?? 0)} · meta {seconds(s.slaSeconds!)} · {s.n} {s.n === 1 ? "resposta" : "respostas"}</span>
                  </div>
                  <Bullet value={s.p50 ?? 0} target={s.slaSeconds!} label={`${s.name}: tempo típico de ${seconds(s.p50 ?? 0)} contra meta de ${seconds(s.slaSeconds!)}`} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {r.semResposta > 0 && (
        <p className="mt-4 text-base">
          <Link href={waitingHref(scope)} className={numLink}>{r.semResposta} {r.semResposta === 1 ? "conversa nova sem resposta" : "conversas novas sem resposta"}</Link>
          <span className="text-muted"> · ver quem espera</span>
        </p>
      )}
    </Section>
  );
}

function Stale({ d, csv, scope }: { d: Overview; scope: LinkScope; csv: { href: string; label: string } }) {
  const total = d.stale.reduce((a, s) => a + s.parados, 0);
  // Etapas sem nada aberto saem da tabela e viram uma linha só (no celular a tabela fica curta e continua em 3 colunas).
  const shown = d.stale.filter((s) => s.total > 0 || s.parados > 0);
  const empty = d.stale.filter((s) => s.total === 0 && s.parados === 0).map((s) => s.stage);
  return (
    <Section id="parados" title="Parados agora" lead={total > 0 ? <><Link href={staleHref(undefined, scope)} className={numLink}>{total} {total === 1 ? "conversa parada" : "conversas paradas"}</Link> além do limite da etapa.</> : "Nenhuma conversa parada além do limite da etapa."} csv={csv} legend="parados">
      {shown.length > 0 && (
        <table className="w-full text-base">
          <caption className="sr-only">Conversas abertas e paradas por etapa</caption>
          <thead><tr className="text-left text-sm text-muted">
            <th scope="col" className="py-2 pr-3 font-medium">Etapa</th>
            <th scope="col" className="py-2 pr-3 font-medium text-right">Abertos</th>
            <th scope="col" className="py-2 font-medium text-right">Parados</th>
          </tr></thead>
          <tbody>
            {shown.map((s) => (
              <tr key={s.stageKey} className="border-t border-line">
                <th scope="row" className="py-2.5 pr-3 text-left font-medium">{s.stage}</th>
                <td className="py-2.5 pr-3 text-right tabular">{s.total}</td>
                <td className="py-2.5 text-right tabular">
                  {s.parados > 0 ? <><Link href={staleHref(s.stageKey, scope)} className={numLink}>{s.parados}</Link><span className="block text-xs text-muted">mais antigo: {longSpan(s.maisAntigoSeg)}</span></> : <span className="text-muted">0</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {empty.length > 0 && <p className="text-sm text-muted mt-2">{empty.join(", ")}: nada aberto.</p>}
    </Section>
  );
}

function Channel({ d, csv }: { d: Overview; csv: { href: string; label: string } }) {
  const c = d.channel;
  return (
    <Section id="canal" title="Pelo CRM ou pelo celular" lead="Onde saiu a primeira resposta das conversas novas." csv={csv} legend="canal">
      {c.total === 0 ? <Muted>{insufficientText(0)}</Muted> : (
        <div>
          <Bar value={c.crm} max={c.total} tone="gold" label={`${c.crm} de ${c.total} primeiras respostas saíram pelo CRM`} />
          <dl className="mt-3 grid grid-cols-2 gap-4">
            <div><dt className="text-sm text-graphite">Pelo CRM</dt><dd className="tabular"><b className="text-xl font-semibold">{c.crm}</b> <span className="text-sm text-muted">· {shareText(c.crm, c.total)}</span></dd></div>
            <div><dt className="text-sm text-graphite">Direto pelo celular</dt><dd className="tabular"><b className="text-xl font-semibold">{c.celular}</b> <span className="text-sm text-muted">· {shareText(c.celular, c.total)}</span></dd></div>
          </dl>
          <p className="text-xs text-muted mt-1 tabular">{c.total} {c.total === 1 ? "primeira resposta" : "primeiras respostas"}</p>
        </div>
      )}
    </Section>
  );
}

function Sources({ d, gestor, csv }: { d: Overview; gestor: boolean; csv: { href: string; label: string } }) {
  const cell = (part: number, whole: number) => (whole >= MIN_SAMPLE ? <><b>{part}</b> <span className="text-muted">· {shareText(part, whole)}</span></> : <>{part}</>);
  const cols: Col<(typeof d.sources)[number]>[] = [
    { key: "o", label: "Origem", render: (s) => s.origem },
    { key: "l", label: "Conversas", align: "right", render: (s) => s.leads },
    { key: "a", label: "Agendados", align: "right", render: (s) => cell(s.agendados, s.leads) },
    { key: "f", label: "Fechados", align: "right", render: (s) => cell(s.fechados, s.leads) },
    ...(gestor ? [{ key: "r", label: "Receita", align: "right" as const, render: (s: (typeof d.sources)[number]) => (s.receitaCents == null || s.fechados === 0 ? <span className="text-muted">—</span> : money(s.receitaCents)) }] : []),
  ];
  const small = d.sources.some((s) => s.leads > 0 && s.leads < MIN_SAMPLE);
  return (
    <Section id="origem" title="De onde vêm as vendas" lead="Origem real das conversas novas, até a venda." csv={csv} legend="origem">
      <DataList rows={d.sources} cols={cols} rowKey={(s) => s.origem} caption="Origem das conversas até a venda" />
      {small && <p className="text-sm text-muted mt-2">Origens com menos de {MIN_SAMPLE} conversas mostram a contagem, não a %: com poucos casos a % engana.</p>}
    </Section>
  );
}

function Losses({ d, csv }: { d: Overview; csv: { href: string; label: string } }) {
  const l = d.losses;
  const oc: Col<(typeof l.objections)[number]>[] = [
    { key: "o", label: "Objeção", render: (x) => x.objection },
    { key: "n", label: "Conversas", align: "right", render: (x) => x.n },
    { key: "f", label: "Fecharam", align: "right", render: (x) => x.fechados },
    { key: "p", label: "Perderam", align: "right", render: (x) => x.perdidos },
    { key: "a", label: "Em aberto", align: "right", render: (x) => x.emAberto },
  ];
  const bars = (items: { label: string; n: number }[]) => (
    <ul className="flex flex-col gap-2.5">
      {items.map((x, i) => (
        <li key={x.label}><div className="flex justify-between gap-3 text-base mb-1"><span>{x.label}</span><b className="tabular">{x.n}</b></div><Bar value={x.n} max={items[0].n} tone="ink" delay={i * 0.04} /></li>
      ))}
    </ul>
  );
  return (
    <Section id="perdas" title="Por que perdemos" lead={l.total ? `${l.total} ${l.total === 1 ? "perda" : "perdas"} no período.` : undefined} csv={csv} legend="perdas">
      {l.total === 0 && l.objections.length === 0 ? <Muted>Nenhuma perda nem objeção registrada no período.</Muted> : (
        <div className="flex flex-col gap-8">
          {l.total > 0 && (
            <div className="grid md:grid-cols-2 gap-x-14 gap-y-6">
              <div><h3 className="text-sm font-medium text-graphite mb-2.5">Por motivo</h3>{bars(l.byReason.map((x) => ({ label: x.motivo, n: x.n })))}</div>
              <div><h3 className="text-sm font-medium text-graphite mb-2.5">Por etapa de onde saíram</h3>{bars(l.byStage.map((x) => ({ label: x.stage, n: x.n })))}</div>
            </div>
          )}
          {l.objections.length > 0 && (
            <div><h3 className="text-sm font-medium text-graphite mb-1">Objeções por resultado</h3>
              <DataList rows={l.objections} cols={oc} rowKey={(x) => x.objection} caption="Objeções por resultado" /></div>
          )}
        </div>
      )}
    </Section>
  );
}

function Quality({ d, csv }: { d: Overview; csv: { href: string; label: string } }) {
  const q = d.quality;
  return (
    <Section id="qualidade" title="Qualidade dos dados" lead="O que falta preencher nas conversas ativas agora (não depende do período) para os relatórios ficarem confiáveis." csv={csv} legend="qualidade">
      <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-10 gap-y-2 text-base">
        {q.checks.map((c) => (
          <li key={c.key} className="flex items-baseline justify-between gap-3 border-b border-line py-1.5">
            <span>{c.label}</span>
            <span className="tabular shrink-0">{c.of === 0 ? <span className="text-muted">sem casos</span> : <><b className={c.n > 0 ? "text-alert" : "text-ok"}>{c.n}</b> <span className="text-muted">de {c.of}</span></>}</span>
          </li>
        ))}
      </ul>
      {q.overallPct != null && <p className="text-sm text-graphite mt-3">Índice composto: <b className="text-ink tabular">{q.overallPct} de 100</b>. Junta sete checagens com bases diferentes, então não é uma % de conversas.</p>}
    </Section>
  );
}
