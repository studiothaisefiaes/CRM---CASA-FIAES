import { money } from "@/lib/format";
import type { DreLine, FluxoRow, ResultadoView } from "@/server/reports/financeiro/resultado";
import { DataList, type Col } from "./data-list";
import { diff } from "./financeiro";
import { Muted, Section } from "./section";

/**
 * Relatórios › Financeiro › Resultado (Fase D, item 28): DRE, fluxo de caixa e saldo por conta. CRM e Avec em colunas, nunca somados.
 * Só chega aqui quem vê valores e com a função ligada (a página confere).
 */
export const RESULTADO_AVISO = "CRM e Avec lado a lado, sem somar. As despesas são as mesmas nos dois.";
/** Tudo o que não é receita sai do resultado. */
const isDeducao = (l: { key: string }) => !l.key.startsWith("receita_");

/** Sem dado é "—", nunca R$ 0,00; dedução leva "−" na frente. */
const cell = (c: number | null, deducao: boolean) => (c == null ? "—" : deducao && c !== 0 ? `−${money(c)}` : money(c));
type DreRow = { key: string; label: string; crmCents: number | null; avecCents: number | null; deducao: boolean; total?: boolean };

export function ResultadoTab({ v }: { v: ResultadoView }) {
  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-3">
        <h2 className="leading-tight text-lg font-semibold">Quanto sobrou no mês?</h2>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <p className="text-sm text-muted" data-testid="aviso-resultado">{RESULTADO_AVISO}</p>
        </div>
        {v.avisoMeses && <p role="note" className="text-sm font-medium text-alert">{v.avisoMeses}</p>}
      </div>
      <Dre v={v} />
      <Fluxo v={v} />
      <Contas v={v} />
    </div>
  );
}

function Dre({ v }: { v: ResultadoView }) {
  const rows: DreRow[] = [
    ...v.dre.map((l: DreLine) => ({ key: l.key, label: l.label, crmCents: l.crmCents, avecCents: l.avecCents, deducao: isDeducao(l) })),
    { key: "resultado", label: "Resultado", crmCents: v.resultado.crmCents, avecCents: v.resultado.avecCents, deducao: false, total: true },
  ];
  const cols: Col<DreRow>[] = [
    { key: "l", label: "Linha", render: (x) => (x.total ? <strong>{x.label}</strong> : x.label) },
    { key: "c", label: "CRM", align: "right", render: (x) => cell(x.crmCents, x.deducao) },
    { key: "a", label: "Avec", align: "right", render: (x) => cell(x.avecCents, x.deducao) },
    { key: "x", label: "Diferença", align: "right", render: (x) => (x.crmCents == null || x.avecCents == null ? "—" : diff(x.crmCents, x.avecCents)) },
  ];
  return (
    <Section id="res-dre" title="Resultado do período" lead={`${v.range.label}. Receitas menos o que saiu, pela competência do mês.`} legend="finResultado">
      <DataList rows={rows} cols={cols} rowKey={(x) => x.key} caption="Resultado do período" />
    </Section>
  );
}

function Fluxo({ v }: { v: ResultadoView }) {
  const rows = v.fluxo.filter((x) => x.entradasCrmCents || x.entradasAvecCents || x.saidasCents || x.aPagarCents);
  const cols: Col<FluxoRow>[] = [
    { key: "d", label: v.range.grain === "dia" ? "Dia" : "Mês", render: (x) => x.label },
    { key: "c", label: "Entradas CRM", align: "right", render: (x) => money(x.entradasCrmCents) },
    { key: "a", label: "Entradas Avec", align: "right", render: (x) => money(x.entradasAvecCents) },
    { key: "s", label: "Saídas", align: "right", render: (x) => cell(x.saidasCents, true) },
    { key: "p", label: "A pagar", align: "right", render: (x) => money(x.aPagarCents) },
  ];
  return (
    <Section id="res-fluxo" title="Fluxo de caixa" lead="O que entrou e saiu em cada dia, e o que ainda vence." legend="finResultado">
      {rows.length === 0 ? <Muted>Nenhuma entrada ou saída no período.</Muted> : <DataList rows={rows} cols={cols} rowKey={(x) => x.key} caption="Fluxo de caixa" />}
    </Section>
  );
}

function Contas({ v }: { v: ResultadoView }) {
  type R = ResultadoView["contas"][number];
  const cols: Col<R>[] = [{ key: "n", label: "Conta", render: (x) => x.name }, { key: "s", label: "Saldo", align: "right", render: (x) => money(x.saldoCents) }];
  return (
    <Section id="res-contas" title="Saldo por conta" lead="Quanto há em cada conta bancária no fim do período." legend="finResultado">
      {v.contas.length === 0 ? <Muted>Nenhuma conta bancária cadastrada.</Muted> : <DataList rows={v.contas} cols={cols} rowKey={(x) => x.id} caption="Saldo por conta" />}
    </Section>
  );
}
