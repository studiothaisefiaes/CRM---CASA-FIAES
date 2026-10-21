import Link from "next/link";
import { money } from "@/lib/format";
import { PAY_LABEL } from "@/lib/comanda-math";
import { brDay } from "@/lib/salon-period";
import type { FinanceView } from "@/server/reports/financeiro";
import { exceptionCounts } from "@/server/reports/financeiro/excecoes";
import { exceptionCols, withKeys } from "./excecoes-page";
import { DataList, type Col } from "./data-list";
import { Fig } from "./fig";
import { Muted, Section } from "./section";

/**
 * Relatórios › Financeiro (plano 4): o caixa do CRM e os pagamentos do Avec do mesmo período, lado a lado, nunca somados.
 * Só chega aqui quem vê valores (a página confere).
 */
const brl = (c: number | null) => (c == null ? "—" : money(c));
/** Diferença CRM − Avec, sem cor de certo/errado: enquanto a Casa usa os dois, nenhum lado é a meta do outro. */
export const diff = (a: number, b: number) => <span className={a === b ? "text-muted" : "text-ink font-medium"}>{money(a - b)}</span>;
const SERVICE_TOP = 15, EXCEPTION_RECENT = 5;
/** Avec no período? Sem dado nenhum do Avec (a Casa só no CRM), as colunas e os números do Avec saem da tela (r68 #20). */
export const hasAvec = (d: FinanceView) => d.avecUntil != null || d.avec.entradasCents > 0 || d.avec.comandas > 0 || d.packages.avec.vendidos > 0 || d.commission.avecCents != null;
const onlyCrm = <T,>(avec: boolean, cols: (Col<T> | false)[]): Col<T>[] => cols.filter((c): c is Col<T> => !!c && (avec || !c.avecOnly));
export const CRM_OFF_NOTE = "O caixa do CRM ainda está desligado: os números do CRM aparecem quando ele for ligado.";

export function FinanceTab({ d, excelHref, canCommission = false, canExcecoes = false }: { d: FinanceView; excelHref: string | null; canCommission?: boolean; /** "Ver todas" para a página de Exceções: permissão e liga/desliga conferidos pela página. */ canExcecoes?: boolean }) {
  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <p className="text-sm text-muted" data-testid="fonte-financeiro">{hasAvec(d) ? `${d.avecUntil ? `Avec até ${brDay(d.avecUntil)}` : "Ainda não há dados do Avec"} · CRM e Avec lado a lado, sem somar` : "Só o CRM: o Avec não tem dados neste período."}</p>
          {excelHref && <a href={excelHref} download className="inline-flex items-center min-h-11 lg:min-h-9 px-3 rounded-[var(--radius-control)] border border-line-strong bg-paper text-sm font-medium hover:bg-paper-2">Baixar Excel</a>}
        </div>
      </div>
      {d.caixaMode === "avec" && d.crm.comandas === 0 && <p className="rounded-[var(--radius-control)] bg-gold-soft/60 px-3 py-2 text-sm text-gold-ink">{CRM_OFF_NOTE}</p>}
      <Entradas d={d} />
      <Formas d={d} />
      <Caixas d={d} />
      <Profissionais d={d} />
      <Servicos d={d} />
      <Excecoes d={d} verTodas={canExcecoes} />
      <Pacotes d={d} />
      <Comissao d={d} link={canCommission} />
    </div>
  );
}

function Entradas({ d }: { d: FinanceView }) {
  type R = FinanceView["days"][number];
  const avec = hasAvec(d);
  const days = d.days.filter((x) => x.crmCents || x.avecCents);
  const cols = onlyCrm<R>(avec, [
    { key: "d", label: d.range.grain === "dia" ? "Dia" : "Mês", render: (x) => x.label },
    { key: "c", label: "CRM", align: "right", render: (x) => money(x.crmCents) }, { key: "a", label: "Avec", align: "right", avecOnly: true, render: (x) => money(x.avecCents) },
    { key: "x", label: "Diferença", align: "right", avecOnly: true, render: (x) => diff(x.crmCents, x.avecCents) },
  ]);
  return (
    <Section id="fin-entradas" title="Entradas" lead={avec ? `${d.range.label}. Diferença = CRM menos Avec.` : `${d.range.label}.`} legend="finEntradas">
      <dl className="grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-4">
        <Fig label="Entradas no CRM" value={money(d.crm.entradasCents)} sub={<span className="text-sm text-muted tabular">{d.crm.comandas} {d.crm.comandas === 1 ? "comanda" : "comandas"}</span>} />
        {avec && <Fig label="Entradas no Avec" value={money(d.avec.entradasCents)} sub={<span className="text-sm text-muted tabular">{d.avec.comandas} {d.avec.comandas === 1 ? "comanda" : "comandas"}</span>} />}
        <Fig label="Taxas do cartão no CRM" value={money(d.crm.taxasCents)} />
        <Fig label="Líquido no CRM" value={money(d.crm.liquidoCents)} sub={avec ? <span className="text-sm text-muted">O Avec não manda a taxa: {money(d.avec.liquidoCents)} é o bruto.</span> : null} />
        <Fig label="Ticket médio no CRM" value={brl(d.crm.ticketCents)} />
        {avec && <Fig label="Ticket médio no Avec" value={brl(d.avec.ticketCents)} />}
      </dl>
      <div className="mt-6">{days.length === 0 ? <Muted>Nenhuma entrada no período.</Muted> : <DataList rows={days} cols={cols} rowKey={(x) => x.key} caption="Entradas por dia" />}</div>
    </Section>
  );
}

function Formas({ d }: { d: FinanceView }) {
  type R = FinanceView["methods"][number];
  const cols = onlyCrm<R>(hasAvec(d), [
    { key: "f", label: "Forma de pagamento", render: (x) => (x.revenue ? x.label : <>{x.label} <span className="text-sm font-normal text-muted">(fora das entradas)</span></>) },
    { key: "c", label: "CRM", align: "right", render: (x) => money(x.crmCents) }, { key: "a", label: "Avec", align: "right", avecOnly: true, render: (x) => money(x.avecCents) },
    { key: "x", label: "Diferença", align: "right", avecOnly: true, render: (x) => diff(x.crmCents, x.avecCents) },
    { key: "t", label: "Taxa (CRM)", align: "right", render: (x) => money(x.crmFeeCents) },
    { key: "l", label: "Líquido (CRM)", align: "right", render: (x) => money(x.crmCents - x.crmFeeCents) },
  ]);
  return (
    <Section id="fin-formas" title="Formas de pagamento" lead={hasAvec(d) ? "O mesmo dinheiro, por forma, dos dois lados." : "O que entrou, por forma."} legend="finFormas">
      {d.methods.length === 0 ? <Muted>Nenhum pagamento no período.</Muted> : <DataList rows={d.methods} cols={cols} rowKey={(x) => x.key} caption="Formas de pagamento" />}
    </Section>
  );
}

function Caixas({ d }: { d: FinanceView }) {
  type R = FinanceView["cashiers"][number];
  const cols: Col<R>[] = [
    { key: "p", label: "Pessoa", render: (x) => x.userName },
    { key: "d", label: "Dia", render: (x) => (x.day ? brDay(x.day).slice(0, 5) : "—") },
    { key: "s", label: "Situação", render: (x) => (x.status === "aberto" ? "Aberto" : x.status === "fechado" ? "Fechado" : "—") },
    { key: "e", label: "Entradas", align: "right", render: (x) => money(x.entradasCents) },
    { key: "c", label: "Comandas", align: "right", render: (x) => x.comandas },
    // Forma por forma (QA r58, C-1): a soma de uma falta com uma sobra não aparece como zero.
    { key: "x", label: "Diferença na contagem", align: "right", render: (x) => (x.status !== "fechado" || x.differenceCents == null ? "—" : x.differences.length === 0 ? money(0)
      : <span className="text-alert font-semibold">{x.differences.map((f) => <span key={f.method} className="block">{`${PAY_LABEL[f.method]} ${money(f.cents)}`}</span>)}</span>) },
  ];
  // Caixa fechado sem entrada nenhuma não ganha linha (r68 #20: 16 linhas "Rita · Fechado · R$ 0"): vira uma frase no fim.
  const empty = (x: R) => x.status === "fechado" && x.entradasCents === 0 && x.comandas === 0 && !x.differences.length;
  const shown = d.cashiers.filter((x) => !empty(x)), hidden = d.cashiers.length - shown.length;
  return (
    <Section id="fin-caixas" title="Por caixa" lead="Quem abriu cada caixa do CRM e o que entrou nele." legend="finCaixas">
      {d.cashiers.length === 0 ? <Muted>Nenhum caixa do CRM no período.</Muted> : <>
        {shown.length > 0 && <DataList rows={shown} cols={cols} rowKey={(x) => x.sessionId ?? "sem"} caption="Por caixa" />}
        {hidden > 0 && <p className="mt-2 text-sm text-muted">{shown.length ? "Mais " : ""}{hidden} {hidden === 1 ? "caixa fechado sem entrada" : "caixas fechados sem entrada"}.</p>}
      </>}
    </Section>
  );
}

function Profissionais({ d }: { d: FinanceView }) {
  type R = FinanceView["professionals"][number];
  const avec = hasAvec(d);
  const cols = onlyCrm<R>(avec, [
    { key: "n", label: "Profissional", render: (x) => x.name },
    { key: "c", label: "CRM", align: "right", render: (x) => money(x.crmCents) }, { key: "a", label: "Avec", align: "right", avecOnly: true, render: (x) => money(x.avecCents) },
    { key: "i", label: "Itens", align: "right", render: (x) => (avec ? `${x.crmItens} · ${x.avecItens}` : String(x.crmItens)) },
    { key: "m", label: "Comissão CRM", align: "right", render: (x) => brl(x.crmCommissionCents) },
    { key: "v", label: "Comissão Avec", align: "right", avecOnly: true, render: (x) => (x.avecCommissionCents == null ? <span className="text-muted">não importada</span> : money(x.avecCommissionCents)) },
  ]);
  return (
    <Section id="fin-profissionais" title="Por profissional" lead={avec ? "Itens CRM · Avec. Valor do item menos o desconto e a cortesia." : "Valor do item menos o desconto e a cortesia."} legend="finProfissional">
      {d.professionals.length === 0 ? <Muted>Nenhum item no período.</Muted> : <DataList rows={d.professionals} cols={cols} rowKey={(x) => x.key} caption="Por profissional" />}
    </Section>
  );
}

function Servicos({ d }: { d: FinanceView }) {
  type R = FinanceView["services"][number];
  const cols = (first: string): Col<R>[] => onlyCrm<R>(hasAvec(d), [
    { key: "n", label: first, render: (x) => x.label },
    { key: "c", label: "CRM", align: "right", render: (x) => `${money(x.crmCents)} (${x.crmN})` },
    { key: "a", label: "Avec", align: "right", avecOnly: true, render: (x) => `${money(x.avecCents)} (${x.avecN})` },
  ]);
  const top = d.services.slice(0, SERVICE_TOP), rest = d.services.length - top.length;
  return (
    <Section id="fin-servicos" title="Por serviço e categoria" lead="Valor e, entre parênteses, quantas vezes. Os 15 que mais faturaram; o Excel tem todos." legend="finServico">
      {d.services.length === 0 ? <Muted>Nenhum item no período.</Muted> : (
        <div className="grid lg:grid-cols-[3fr_2fr] gap-x-12 gap-y-6">
          <div className="min-w-0">
            <DataList rows={top} cols={cols("Serviço ou produto")} rowKey={(x) => x.key} caption="Por serviço ou produto" />
            {rest > 0 && <p className="text-sm text-muted mt-2">E mais {rest} no Excel.</p>}
          </div>
          <div className="min-w-0"><DataList rows={d.categories} cols={cols("Categoria")} rowKey={(x) => x.key} caption="Por categoria" /></div>
        </div>
      )}
    </Section>
  );
}

function Excecoes({ d, verTodas }: { d: FinanceView; verTodas: boolean }) {
  const counts = exceptionCounts(d.exceptions);
  const recent = withKeys(d.exceptions.slice(0, EXCEPTION_RECENT));
  const q = new URLSearchParams(d.range.preset === "livre" ? { de: d.range.from, ate: d.range.to } : { periodo: d.range.preset }).toString();
  return (
    <Section id="fin-excecoes" title="Exceções" lead="Tudo o que mudou o valor ou o rastro de uma comanda, com quem fez e o motivo." legend="finExcecoes">
      {d.exceptions.length === 0 ? <Muted>Nenhuma exceção no período.</Muted> : (
        <>
          <ul className="flex flex-wrap gap-x-6 gap-y-1 text-base" aria-label="Exceções por tipo">
            {counts.map((c) => <li key={c.kind}><span className="tabular font-medium">{c.count}</span> <span className="text-graphite">{c.label}</span></li>)}
          </ul>
          <div className="mt-4"><DataList rows={recent} cols={exceptionCols} rowKey={(x) => x.k} caption="Exceções mais recentes" /></div>
          <p className="text-sm text-muted mt-2">{d.exceptions.length > recent.length ? `As ${recent.length} mais recentes de ${d.exceptions.length}.` : `${d.exceptions.length} no período.`}</p>
        </>
      )}
      {verTodas && <Link href={`/relatorios/excecoes?${q}`} className="mt-2 inline-flex items-center min-h-11 text-base text-gold-ink underline underline-offset-2 hover:text-ink">Ver todas</Link>}
    </Section>
  );
}

function Pacotes({ d }: { d: FinanceView }) {
  const p = d.packages;
  return (
    <Section id="fin-pacotes" title="Pacotes" lead="Vendidos e sessões usadas no período." legend="finPacotes">
      <dl className="grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-4">
        <Fig label="Vendidos no CRM" value={String(p.crm.vendidos)} sub={<span className="text-sm text-muted tabular">{money(p.crm.cents)}</span>} />
        {hasAvec(d) && <Fig label="Vendidos no Avec" value={String(p.avec.vendidos)} sub={<span className="text-sm text-muted tabular">{money(p.avec.cents)}</span>} />}
        <Fig label="Sessões usadas no CRM" value={String(p.crm.sessoes)} />
        {hasAvec(d) && <Fig label="Sessões usadas no Avec" value={String(p.avec.sessoes)} />}
      </dl>
      {p.byName.length > 0 && (
        <ul className="mt-5 flex flex-col text-base" aria-label="Pacotes vendidos por nome">
          {p.byName.map((x) => <li key={x.name} className="flex justify-between gap-3 border-t border-line py-2"><span>{x.name}</span><span className="tabular text-graphite">{hasAvec(d) ? `CRM ${x.crm} · Avec ${x.avec}` : x.crm}</span></li>)}
        </ul>
      )}
    </Section>
  );
}

function Comissao({ d, link }: { d: FinanceView; link: boolean }) {
  const c = d.commission;
  return (
    <Section id="fin-comissao" title="Comissão" lead={hasAvec(d) ? "A comissão do período, dos dois lados." : "A comissão do período."} legend="finComissao">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 max-w-[560px]">
        <Fig label="Comissão no CRM" value={money(c.crmCents)} sub={c.crmPending ? <span className="text-sm text-gold-ink">{c.crmPending} {c.crmPending === 1 ? "linha sem regra" : "linhas sem regra"}</span> : null} />
        {hasAvec(d) && <Fig label="Comissão no Avec" value={c.avecCents == null ? "—" : money(c.avecCents)} sub={c.avecCents == null ? <span className="text-sm text-muted">não importada</span> : null} />}
      </dl>
      {link && <Link href={`/caixa/comissao?aba=relatorio&de=${d.range.from}&ate=${d.range.to}`} className="mt-4 inline-flex items-center min-h-11 text-base text-gold-ink underline underline-offset-2 hover:text-ink">Ver a comissão por linha</Link>}
    </Section>
  );
}
