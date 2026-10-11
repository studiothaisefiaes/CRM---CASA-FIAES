"use client";
import type { ReactNode } from "react";
import { motion } from "motion/react";
import { EASE } from "@/lib/motion";
import { compareMetric, insufficientText, MIN_SAMPLE, type Comparison } from "@/lib/report-format";
import { money } from "@/lib/format";
import type { ExecutiveView } from "@/server/reports/screen";
import { Delta } from "./delta";

/** `long`: valor em R$ com milhar (ex.: "R$ 12.345,67"), que em 18cqw passava da célula de 1280 px; ganha uma escala menor. */
type Cell = { key: string; label: string; value: ReactNode; sub: ReactNode; cmp: Comparison | null; prevText?: string; long?: boolean };

/** R2: os 5 números do período, com o n por trás e a comparação com o período anterior. Atendente não recebe os valores em R$. */
export function ExecutiveNumbers({ numbers: x, slaHit, slaN, previousLabel }: { numbers: ExecutiveView; slaHit: number; slaN: number; previousLabel: string }) {
  const pctSmall = x.pctPrimeiraRespostaNoSla.n < MIN_SAMPLE;
  const cells: Cell[] = [
    { key: "leads", label: "Leads novos", value: <>{x.leadsNovos.atual}</>, sub: "criados no período",
      cmp: compareMetric(x.leadsNovos.atual, x.leadsNovos.anterior, { kind: "count", n: x.leadsNovos.n, nPrev: x.leadsNovos.nAnterior }), prevText: `antes: ${x.leadsNovos.anterior}` },
    { key: "sla", label: "Primeira resposta no prazo",
      value: x.pctPrimeiraRespostaNoSla.n === 0 ? <span className="block whitespace-normal text-[16px] leading-snug font-sans font-normal text-graphite">{insufficientText(0)}</span> : pctSmall ? <>{slaHit} <span className="text-[18px] font-sans font-normal text-graphite">de {slaN}</span></> : <>{x.pctPrimeiraRespostaNoSla.atual}%</>,
      sub: `n = ${x.pctPrimeiraRespostaNoSla.n}${pctSmall && x.pctPrimeiraRespostaNoSla.n > 0 ? " · poucos casos para uma %" : ""}`,
      cmp: compareMetric(x.pctPrimeiraRespostaNoSla.atual, x.pctPrimeiraRespostaNoSla.anterior, { kind: "pct", n: x.pctPrimeiraRespostaNoSla.n, nPrev: x.pctPrimeiraRespostaNoSla.nAnterior }),
      prevText: x.pctPrimeiraRespostaNoSla.anterior == null ? undefined : `antes: ${x.pctPrimeiraRespostaNoSla.anterior}% (n = ${x.pctPrimeiraRespostaNoSla.nAnterior})` },
    { key: "agend", label: "Agendamentos marcados", value: <>{x.agendamentosMarcados.atual}</>, sub: `de ${x.agendamentosMarcados.n} ${x.agendamentosMarcados.n === 1 ? "lead novo" : "leads novos"}`,
      cmp: compareMetric(x.agendamentosMarcados.atual, x.agendamentosMarcados.anterior, { kind: "count", n: x.agendamentosMarcados.n, nPrev: x.agendamentosMarcados.nAnterior }), prevText: `antes: ${x.agendamentosMarcados.anterior}` },
    { key: "vendas", label: "Vendas", value: <>{x.vendas.atual.n}</>, sub: x.vendas.atual.cents == null ? "fechadas no período" : `${money(x.vendas.atual.cents)} fechados`,
      cmp: compareMetric(x.vendas.atual.n, x.vendas.anterior.n, { kind: "count", n: x.vendas.atual.n, nPrev: x.vendas.anterior.n }), prevText: `antes: ${x.vendas.anterior.n}` },
  ];
  if (x.ticketMedio) {
    const t = x.ticketMedio;
    cells.push({ key: "ticket", label: "Ticket médio", value: t.atual == null ? <>—</> : <>{money(t.atual)}</>, long: t.atual != null && money(t.atual).length > 9, sub: `n = ${t.n} ${t.n === 1 ? "venda com valor" : "vendas com valor"}`,
      cmp: compareMetric(t.atual, t.anterior, { kind: "cents", n: t.n, nPrev: t.nAnterior }), prevText: t.anterior == null ? undefined : `antes: ${money(t.anterior)}` });
  }
  return (
    <div>
      <dl className={`grid grid-cols-2 gap-px bg-line border-y border-ink/80 ${cells.length === 5 ? "lg:grid-cols-5" : "lg:grid-cols-4"}`}>
        {cells.map((c, i) => (
          <motion.div key={c.key} className={`@container bg-paper px-4 py-5 lg:py-6 ${cells.length % 2 === 1 && i === cells.length - 1 ? "col-span-2 lg:col-span-1" : ""}`}
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 + i * 0.06, duration: 0.5, ease: EASE }}>
            <dt className="text-[13px] text-graphite leading-snug min-h-[2.5em]">{c.label}</dt>
            <dd className="mt-1">
              <p className={`font-serif leading-none font-light tabular whitespace-nowrap ${c.long ? "text-[clamp(22px,15cqw,36px)]" : "text-[clamp(24px,18cqw,40px)]"}`}>{c.value}</p>
              <p className="text-[13px] text-muted mt-2 tabular">{c.sub}</p>
              {c.cmp && <div className="mt-1.5"><Delta c={c.cmp} prevText={c.prevText} /></div>}
            </dd>
          </motion.div>
        ))}
      </dl>
      <p className="text-[13px] text-muted mt-2">Comparado com {previousLabel}.</p>
    </div>
  );
}
