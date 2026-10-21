import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { consumePrintToken } from "@/server/reports/print-token";
import { loadOverview } from "@/server/reports/screen";
import { teamPerformance } from "@/server/reports/team";
import { PERIOD_LABEL, type Period, type ReportFilter } from "@/server/reports/common";
import { can } from "@/lib/permissions";
import { METRIC_COPY, readDelta, type MetricKey } from "@/lib/metric-copy";
import { LEGEND } from "@/lib/report-legend";
import { PREVIOUS_LABEL, longSpan, MIN_SAMPLE } from "@/lib/report-format";
import { money, seconds } from "@/lib/format";

export const metadata = { title: "Relatório" };
export const dynamic = "force-dynamic";

type Tipo = "periodo" | "mensal" | "equipe";
const TZ = "America/Bahia";
const dateLong = (d: Date) => d.toLocaleDateString("pt-BR", { day: "numeric", month: "long", year: "numeric", timeZone: TZ });
const monthLong = (d: Date) => d.toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: TZ });

/** Último instante do mês anterior a `ref` (horário de Salvador, UTC-3 fixo): o "agora" do fechamento mensal. */
function endOfPreviousMonth(ref: Date): Date {
  const local = new Date(ref.getTime() - 3 * 3_600_000);
  const firstOfThis = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) + 3 * 3_600_000;
  return new Date(firstOfThis - 1);
}

/**
 * Página que o Chromium do servidor imprime em PDF (A4). Fica fora do menu do CRM e não usa cookie: o acesso é por
 * um token de uso único (5 min) ligado a quem pediu, e os dados respeitam as permissões dessa pessoa.
 */
export default async function ImprimirRelatorio({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const user = await consumePrintToken(typeof sp.t === "string" ? sp.t : null);
  if (!user || !can(user.perms, "relatorios.exportar")) notFound();
  const tipo: Tipo = sp.tipo === "mensal" || sp.tipo === "equipe" ? sp.tipo : "periodo";
  const period: Period = tipo === "mensal" ? "mes" : (["hoje", "7d", "mes", "ano"].includes(String(sp.periodo)) ? sp.periodo : "mes") as Period;
  const now = tipo === "mensal" ? endOfPreviousMonth(typeof sp.ref === "string" && !Number.isNaN(Date.parse(sp.ref)) ? new Date(sp.ref) : new Date()) : new Date();
  const team = can(user.perms, "relatorios.equipe");
  const moneyOk = can(user.perms, "valores.ver");
  const filter: ReportFilter = { period, now, ownerId: team ? null : user.id };
  const prevLabel = PREVIOUS_LABEL[period];
  const title = tipo === "mensal" ? `Fechamento de ${monthLong(now)}` : tipo === "equipe" ? "Desempenho da equipe" : `Relatório · ${PERIOD_LABEL[period]}`;

  const cover = (
    <section className="cover">
      <p className="brand">Casa <em>Fiaes</em></p>
      <h1>{title}</h1>
      <p className="meta">{tipo === "mensal" ? `1º a ${dateLong(now)}` : `${PERIOD_LABEL[period]}, até ${dateLong(now)}`}{tipo === "equipe" ? "" : ` · comparado com ${prevLabel}`}</p>
      <p className="meta">Gerado em {new Date().toLocaleString("pt-BR", { timeZone: TZ, dateStyle: "short", timeStyle: "short" })} por {user.name}</p>
      {!team && <p className="note">Números só das conversas de {user.name.split(" ")[0]}.</p>}
      {!moneyOk && <p className="note">Valores em reais não aparecem neste relatório (perfil sem “ver valores”).</p>}
    </section>
  );

  if (tipo === "equipe") {
    const rows = await teamPerformance(filter, { money: moneyOk });
    return (
      <Doc>
        {cover}
        <Sec title="Por atendente" lead="Números lado a lado, em ordem alfabética. Não é ranking: serve para conversar com a equipe.">
          {rows.length === 0 ? <p className="muted">Sem atendimentos no período.</p> : (
            <table>
              <thead><tr><th>Pessoa</th><th className="r">Conversas novas</th><th className="r">1ª resposta</th><th className="r">No prazo</th><th className="r">Agendados ou fechados</th><th className="r">Vendas</th><th className="r">Conversão</th>{moneyOk && <th className="r">Valor</th>}</tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.userId}>
                  <td>{r.name}{r.smallSample && <span className="tag">poucos casos</span>}</td>
                  <td className="r">{r.received}</td>
                  <td className="r">{r.p50 == null ? "—" : seconds(r.p50)}</td>
                  <td className="r">{r.answered === 0 ? "—" : r.smallSample ? `${r.onTime} de ${r.answered}` : `${r.onTimePct}%`}</td>
                  <td className="r">{r.scheduled}</td>
                  <td className="r">{r.sales}</td>
                  <td className="r">{r.conversionPct == null ? "—" : `${r.conversionPct}%`}</td>
                  {moneyOk && <td className="r">{money(r.salesCents ?? 0)}</td>}
                </tr>
              ))}</tbody>
            </table>
          )}
          <p className="small">1ª resposta: tempo típico (mediana) da primeira resposta, contando só o horário de expediente. No prazo: dentro do prazo da etapa; com menos de {MIN_SAMPLE} respostas aparece como “X de Y”, sem %. Conversão: vendas sobre conversas novas, só com {MIN_SAMPLE} conversas ou mais.</p>
        </Sec>
      </Doc>
    );
  }

  const d = await loadOverview({ id: user.id, perms: user.perms, name: user.name, email: "" }, filter);
  const n = d.numbers;
  const cells: { key: MetricKey; label: string; value: string; read: string }[] = [
    { key: "leadsNovos", label: "Conversas novas", value: String(n.leadsNovos.atual), read: readDelta("leadsNovos", n.leadsNovos.atual, n.leadsNovos.anterior, n.leadsNovos.n, n.leadsNovos.nAnterior, prevLabel) },
    { key: "pctPrimeiraRespostaNoSla", label: "Primeira resposta no prazo", value: n.pctPrimeiraRespostaNoSla.n === 0 ? "—" : n.pctPrimeiraRespostaNoSla.n < MIN_SAMPLE ? `${d.response.slaHit} de ${d.response.n}` : `${n.pctPrimeiraRespostaNoSla.atual}%`,
      read: readDelta("pctPrimeiraRespostaNoSla", n.pctPrimeiraRespostaNoSla.n ? n.pctPrimeiraRespostaNoSla.atual : null, n.pctPrimeiraRespostaNoSla.anterior, n.pctPrimeiraRespostaNoSla.n, n.pctPrimeiraRespostaNoSla.nAnterior, prevLabel) },
    { key: "agendamentosMarcados", label: "Agendamentos marcados", value: String(n.agendamentosMarcados.atual), read: readDelta("agendamentosMarcados", n.agendamentosMarcados.atual, n.agendamentosMarcados.anterior, n.agendamentosMarcados.n, n.agendamentosMarcados.nAnterior, prevLabel) },
    { key: "vendas", label: "Vendas", value: `${n.vendas.atual.n}${n.vendas.atual.cents != null ? ` · ${money(n.vendas.atual.cents)}` : ""}`, read: readDelta("vendas", n.vendas.atual.n, n.vendas.anterior.n, n.vendas.atual.n, n.vendas.anterior.n, prevLabel) },
    ...(n.ticketMedio ? [{ key: "ticketMedio" as const, label: "Valor médio por venda", value: n.ticketMedio.atual == null ? "—" : money(n.ticketMedio.atual), read: readDelta("ticketMedio", n.ticketMedio.atual, n.ticketMedio.anterior, n.ticketMedio.n, n.ticketMedio.nAnterior, prevLabel) }] : []),
  ];
  const empty = n.leadsNovos.atual === 0 && n.vendas.atual.n === 0 && d.response.n === 0;
  const f = d.funnel;

  return (
    <Doc>
      {cover}
      {empty && <p className="muted big">Sem dados no período.</p>}
      {tipo === "mensal" && !empty && (
        <Sec title="Destaques do mês" lead="Frases montadas a partir dos números, sem opinião.">
          <ul className="bullets">{cells.map((c) => <li key={c.key}><b>{c.label}:</b> {c.read}</li>)}</ul>
        </Sec>
      )}
      <Sec title="Os números do período" legend={LEGEND.numeros}>
        <div className="grid">
          {cells.map((c) => (
            <div key={c.key} className="cell">
              <p className="label">{c.label}</p>
              <p className="value">{c.value}</p>
              <p className="what">{METRIC_COPY[c.key].what}</p>
              <p className="read">{c.read}</p>
            </div>
          ))}
        </div>
      </Sec>
      <Sec title="Do primeiro contato à venda" lead={`${f.leads} ${f.leads === 1 ? "conversa nova" : "conversas novas"} no período.`} legend={LEGEND.funil}>
        <table>
          <tbody>
            {([["Respondidos", f.respondidos, f.conv.respondido], ["Chegaram a agendar", f.agendados, f.conv.agendado], ["Fecharam", f.fechados, f.conv.fechado]] as const).map(([l, v, p]) => (
              <tr key={l}><td>{l}</td><td className="r">{v}</td><td className="r muted">{f.leads >= MIN_SAMPLE && p != null ? `${p}%` : ""}</td></tr>
            ))}
            <tr><td>Perdidos</td><td className="r">{f.perdidos}</td><td /></tr>
            <tr><td>Ainda em aberto</td><td className="r">{f.emAberto}</td><td /></tr>
          </tbody>
        </table>
      </Sec>
      <Sec title="Primeira resposta" lead="Quanto a cliente esperou pela primeira resposta de uma pessoa (só o horário de expediente)." legend={LEGEND.resposta}>
        {d.response.n === 0 ? <p className="muted">Sem respostas no período.</p> : (
          <table><tbody>
            <tr><td>Tempo típico (metade respondeu mais rápido)</td><td className="r">{d.response.p50 == null ? "—" : seconds(d.response.p50)}</td></tr>
            <tr><td>9 em cada 10 responderam em até</td><td className="r">{d.response.p90 == null ? "—" : seconds(d.response.p90)}</td></tr>
            <tr><td>Dentro do prazo</td><td className="r">{d.response.n < MIN_SAMPLE ? `${d.response.slaHit} de ${d.response.n}` : `${d.response.slaHitPct}%`}</td></tr>
            <tr><td>Escreveram e ninguém respondeu</td><td className="r">{d.response.semResposta}</td></tr>
          </tbody></table>
        )}
      </Sec>
      <Sec title="De onde vêm as vendas" legend={LEGEND.origem}>
        {d.sources.length === 0 ? <p className="muted">Sem conversas novas no período.</p> : (
          <table>
            <thead><tr><th>Origem</th><th className="r">Conversas</th><th className="r">Agendados</th><th className="r">Fechados</th>{moneyOk && <th className="r">Receita</th>}</tr></thead>
            <tbody>{d.sources.map((s) => <tr key={s.origem}><td>{s.origem}</td><td className="r">{s.leads}</td><td className="r">{s.agendados}</td><td className="r">{s.fechados}</td>{moneyOk && <td className="r">{s.receitaCents == null ? "—" : money(s.receitaCents)}</td>}</tr>)}</tbody>
          </table>
        )}
      </Sec>
      <Sec title="Por que perdemos" lead={d.losses.total ? `${d.losses.total} ${d.losses.total === 1 ? "perda" : "perdas"} no período.` : undefined} legend={LEGEND.perdas}>
        {d.losses.byReason.length === 0 ? <p className="muted">Nenhuma perda no período.</p> : (
          <table><tbody>{d.losses.byReason.slice(0, 8).map((r) => <tr key={r.motivo}><td>{r.motivo}</td><td className="r">{r.n}</td></tr>)}</tbody></table>
        )}
      </Sec>
      <Sec title="Parados agora" lead="Conversas abertas por etapa e quantas passaram do limite de dias da etapa (não depende do período)." legend={LEGEND.parados}>
        <table>
          <thead><tr><th>Etapa</th><th className="r">Abertos</th><th className="r">Parados</th><th className="r">Mais antigo</th></tr></thead>
          <tbody>{d.stale.map((s) => <tr key={s.stageKey}><td>{s.stage}</td><td className="r">{s.total}</td><td className="r">{s.parados}</td><td className="r">{longSpan(s.maisAntigoSeg)}</td></tr>)}</tbody>
        </table>
      </Sec>
    </Doc>
  );
}

function Sec({ title, lead, legend, children }: { title: string; lead?: string; legend?: string; children: ReactNode }) {
  return (
    <section className="sec">
      <h2>{title}</h2>
      {lead && <p className="lead">{lead}</p>}
      {children}
      {legend && <p className="small"><b>Como é calculado:</b> {legend}</p>}
    </section>
  );
}

/** A4 com margens de 14 mm, tipografia da Casa (Inter, sem serifa). Sem animação nem menu. */
function Doc({ children }: { children: ReactNode }) {
  return (
    <main className="print-doc">
      <style>{`
        @page { size: A4; margin: 14mm 14mm 18mm; }
        html, body { background: #fff !important; }
        .print-doc { font-family: var(--font-inter), system-ui, sans-serif; color: #121212; font-size: 10.5pt; line-height: 1.45; max-width: 182mm; margin: 0 auto; padding: 8mm 0; }
        .print-doc h1, .print-doc h2, .print-doc .brand { font-weight: 600; letter-spacing: -0.01em; }
        .cover { padding: 30mm 0 14mm; border-bottom: 1px solid #121212; margin-bottom: 8mm; }
        .brand { font-size: 20pt; margin: 0 0 18mm; } .brand em { color: #7a5524; }
        .cover h1 { font-size: 30pt; line-height: 1.1; margin: 0 0 4mm; text-wrap: balance; }
        .meta { color: #5c5c5c; margin: 1mm 0; } .note { margin-top: 4mm; color: #7a5524; }
        .sec { break-inside: avoid; margin: 0 0 8mm; }
        .sec h2 { font-size: 17pt; margin: 0 0 1.5mm; border-top: 1px solid #e4e1db; padding-top: 4mm; }
        .lead { color: #5c5c5c; margin: 0 0 3mm; }
        table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
        th { text-align: left; font-size: 8.5pt; text-transform: uppercase; letter-spacing: .06em; color: #6f6a62; font-weight: 600; padding: 1.5mm 2mm; border-bottom: 1px solid #d3cfc7; }
        td { padding: 1.6mm 2mm; border-bottom: 1px solid #ebe8e2; } .r { text-align: right; white-space: nowrap; }
        .muted { color: #6f6a62; } .big { font-size: 13pt; margin: 6mm 0; }
        .small { font-size: 8.5pt; color: #6f6a62; margin-top: 2.5mm; }
        .tag { white-space: nowrap; margin-left: 2mm; font-size: 7.5pt; color: #7a5524; background: #f3e9d8; padding: .3mm 1.6mm; border-radius: 99px; }
        .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 3mm; }
        .cell { border: 1px solid #e4e1db; border-radius: 3mm; padding: 3mm; break-inside: avoid; }
        .cell .label { font-size: 8.5pt; color: #5c5c5c; margin: 0; } .cell .value { font-size: 20pt; font-weight: 400; letter-spacing: -0.02em; margin: 1mm 0; }
        .cell .what { font-size: 8.5pt; color: #5c5c5c; margin: 0; } .cell .read { font-size: 8.5pt; margin: 1.5mm 0 0; }
        .bullets { margin: 0; padding-left: 5mm; } .bullets li { margin: 1.5mm 0; }
        nextjs-portal { display: none !important; }
      `}</style>
      {children}
    </main>
  );
}
