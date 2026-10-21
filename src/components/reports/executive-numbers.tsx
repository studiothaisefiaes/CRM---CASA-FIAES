"use client";
import type { ReactNode } from "react";
import { motion } from "motion/react";
import { EASE } from "@/lib/motion";
import { compareMetric, insufficientText, MIN_SAMPLE, type Comparison } from "@/lib/report-format";
import { money } from "@/lib/format";
import type { ExecutiveView } from "@/server/reports/screen";
import { Delta } from "./delta";
import { METRIC_COPY, readDelta } from "@/lib/metric-copy";

/** `long`: valor em R$ com milhar (ex.: "R$ 12.345,67"), que em 18cqw passava da célula de 1280 px; ganha uma escala menor. */
type Cell = { key: string; label: string; value: ReactNode; sub: ReactNode; cmp: Comparison | null; prevText?: string; long?: boolean; /** O que é e como ler (português de quem usa). */ what: string; read: string };

/** R2: os 5 números do período, com o n por trás e a comparação com o período anterior. Atendente não recebe os valores em R$. */
export function ExecutiveNumbers({ numbers: x, slaHit, slaN, previousLabel }: { numbers: ExecutiveView; slaHit: number; slaN: number; previousLabel: string }) {
  const pctSmall = x.pctPrimeiraRespostaNoSla.n < MIN_SAMPLE;
  const cells: Cell[] = [
    { key: "leads", label: "Conversas novas", what: METRIC_COPY.leadsNovos.what, read: readDelta("leadsNovos", x.leadsNovos.atual, x.leadsNovos.anterior, x.leadsNovos.n, x.leadsNovos.nAnterior, previousLabel), value: <>{x.leadsNovos.atual}</>, sub: "criados no período",
      cmp: compareMetric(x.leadsNovos.atual, x.leadsNovos.anterior, { kind: "count", n: x.leadsNovos.n, nPrev: x.leadsNovos.nAnterior }), prevText: `antes: ${x.leadsNovos.anterior}` },
    { key: "sla", label: "Primeira resposta no prazo", what: METRIC_COPY.pctPrimeiraRespostaNoSla.what,
      read: readDelta("pctPrimeiraRespostaNoSla", x.pctPrimeiraRespostaNoSla.n ? x.pctPrimeiraRespostaNoSla.atual : null, x.pctPrimeiraRespostaNoSla.anterior, x.pctPrimeiraRespostaNoSla.n, x.pctPrimeiraRespostaNoSla.nAnterior, previousLabel),
      value: x.pctPrimeiraRespostaNoSla.n === 0 ? <span className="block whitespace-normal text-base leading-snug font-sans font-normal text-graphite">{insufficientText(0)}</span> : pctSmall ? <>{slaHit} <span className="text-lg font-sans font-normal text-graphite">de {slaN}</span></> : <>{x.pctPrimeiraRespostaNoSla.atual}%</>,
      sub: `de ${x.pctPrimeiraRespostaNoSla.n} ${x.pctPrimeiraRespostaNoSla.n === 1 ? "conversa" : "conversas"}${pctSmall && x.pctPrimeiraRespostaNoSla.n > 0 ? " · poucos casos para uma %" : ""}`,
      cmp: compareMetric(x.pctPrimeiraRespostaNoSla.atual, x.pctPrimeiraRespostaNoSla.anterior, { kind: "pct", n: x.pctPrimeiraRespostaNoSla.n, nPrev: x.pctPrimeiraRespostaNoSla.nAnterior }),
      prevText: x.pctPrimeiraRespostaNoSla.anterior == null ? undefined : `antes: ${x.pctPrimeiraRespostaNoSla.anterior}% (de ${x.pctPrimeiraRespostaNoSla.nAnterior})` },
    { key: "agend", label: "Agendamentos marcados", what: METRIC_COPY.agendamentosMarcados.what, read: readDelta("agendamentosMarcados", x.agendamentosMarcados.atual, x.agendamentosMarcados.anterior, x.agendamentosMarcados.n, x.agendamentosMarcados.nAnterior, previousLabel), value: <>{x.agendamentosMarcados.atual}</>, sub: `de ${x.agendamentosMarcados.n} ${x.agendamentosMarcados.n === 1 ? "conversa nova" : "conversas novas"}`,
      cmp: compareMetric(x.agendamentosMarcados.atual, x.agendamentosMarcados.anterior, { kind: "count", n: x.agendamentosMarcados.n, nPrev: x.agendamentosMarcados.nAnterior }), prevText: `antes: ${x.agendamentosMarcados.anterior}` },
    { key: "vendas", label: "Vendas", what: METRIC_COPY.vendas.what, read: readDelta("vendas", x.vendas.atual.n, x.vendas.anterior.n, x.vendas.atual.n, x.vendas.anterior.n, previousLabel), value: <>{x.vendas.atual.n}</>, sub: x.vendas.atual.cents == null ? "fechadas no período" : `${money(x.vendas.atual.cents)} fechados`,
      cmp: compareMetric(x.vendas.atual.n, x.vendas.anterior.n, { kind: "count", n: x.vendas.atual.n, nPrev: x.vendas.anterior.n }), prevText: `antes: ${x.vendas.anterior.n}` },
  ];
  if (x.ticketMedio) {
    const t = x.ticketMedio;
    cells.push({ key: "ticket", label: "Valor médio por venda", what: METRIC_COPY.ticketMedio.what, read: readDelta("ticketMedio", t.atual, t.anterior, t.n, t.nAnterior, previousLabel), value: t.atual == null ? <>—</> : <>{money(t.atual)}</>, long: t.atual != null && money(t.atual).length > 9, sub: `${t.n} ${t.n === 1 ? "venda com valor" : "vendas com valor"}`,
      cmp: compareMetric(t.atual, t.anterior, { kind: "cents", n: t.n, nPrev: t.nAnterior }), prevText: t.anterior == null ? undefined : `antes: ${money(t.anterior)}` });
  }
  return (
    <div>
      <dl className={`grid grid-cols-2 gap-px bg-line border-y border-ink/80 ${cells.length === 5 ? "lg:grid-cols-5" : "lg:grid-cols-4"}`}>
        {cells.map((c, i) => (
          <motion.div key={c.key} className={`@container bg-paper px-4 py-5 lg:py-6 ${cells.length % 2 === 1 && i === cells.length - 1 ? "col-span-2 lg:col-span-1" : ""}`}
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 + i * 0.06, duration: 0.5, ease: EASE }}>
            <dt className="text-sm text-graphite leading-snug min-h-[2.5em]">{c.label}</dt>
            <dd className="mt-1">
              <p className={`font-display leading-none font-normal tabular whitespace-nowrap ${c.long ? "text-[clamp(22px,15cqw,36px)]" : "text-[clamp(24px,18cqw,40px)]"}`}>{c.value}</p>
              <p className="text-sm text-muted mt-2 tabular">{c.sub}</p>
              {c.cmp && <div className="mt-1.5"><Delta c={c.cmp} prevText={c.prevText} /></div>}
              <p className="text-xs leading-snug text-graphite mt-2">{c.what}</p>
              <p className="text-xs leading-snug text-ink mt-1" data-testid={`leitura-${c.key}`}>{c.read}</p>
            </dd>
          </motion.div>
        ))}
      </dl>
      <p className="text-sm text-muted mt-2">Comparado com {previousLabel}.</p>
    </div>
  );
}
