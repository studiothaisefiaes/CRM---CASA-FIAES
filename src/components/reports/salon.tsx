import Link from "next/link";
import { compareMetric, shareText } from "@/lib/report-format";
import { money } from "@/lib/format";
import { brDay } from "@/lib/salon-period";
import type { SalonView } from "@/server/reports/salon";
import { DataList, type Col } from "./data-list";
import { Delta } from "./delta";
import { Muted, Section } from "./section";
import { Fig } from "./fig";
import type { SatisfactionNumbers } from "@/server/domain/satisfaction";
import { SatisfactionBlock } from "./satisfaction-block";

const brl = (c: number | null) => (c == null ? "—" : money(c));
const when = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Bahia", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
/** Coluna só para quem vê valores. */
const moneyCol = <T,>(on: boolean, col: Col<T>): Col<T>[] => (on ? [col] : []);

/**
 * Aba Salão (Lote 3): faturamento, profissionais, serviços, pagamentos, clientes, comparecimento, agenda sem desfecho e funil.
 * `satisfaction` (Fase B): a Pesquisa de satisfação, só para quem vê os números de toda a equipe (o servidor manda null para os outros).
 */
export function SalonTab({ d, satisfaction }: { d: SalonView; satisfaction?: SatisfactionNumbers | null }) {
  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="text-sm text-muted" data-testid="fonte-salao">{d.avecUntil ? `Fonte: Avec até ${brDay(d.avecUntil)}` : "Ainda não há dados do Avec"} · comandas do CRM entram junto</p>
      </div>
      <Revenue d={d} />
      <Professionals d={d} />
      <Services d={d} />
      <Payments d={d} />
      <Clients d={d} />
      {satisfaction && <SatisfactionBlock d={satisfaction} />}
      <Attendance d={d} />
      <NoOutcome d={d} />
      <Funnel d={d} />
    </div>
  );
}

function Revenue({ d }: { d: SalonView }) {
  const v = d.revenue;
  const max = Math.max(1, ...v.series.map((s) => (d.money ? s.cents ?? 0 : s.comandas)));
  return (
    <Section id="salao-faturamento" title={d.money ? "Faturamento" : "Comandas"} lead={`${d.range.label}, comparado com ${d.range.prevLabel}.`} legend="salaoFaturamento">
      <dl className="grid grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4">
        {d.money && <Fig label="Faturado" value={brl(v.cents)} sub={<Delta c={compareMetric(v.cents, v.prevCents, { kind: "cents", n: v.comandas, nPrev: v.prevComandas })} prevText={`antes: ${brl(v.prevCents)}`} />} />}
        <Fig label="Comandas" value={v.comandas.toLocaleString("pt-BR")} sub={<Delta c={compareMetric(v.comandas, v.prevComandas, { kind: "count", n: v.comandas, nPrev: v.prevComandas })} prevText={`antes: ${v.prevComandas}`} />} />
        {d.money && <Fig label="Ticket médio por comanda" value={brl(v.ticketCents)} sub={<span className="text-sm text-muted tabular">antes: {brl(v.prevTicketCents)}</span>} />}
      </dl>
      {v.comandas === 0 ? <Muted>Nenhuma comanda no período.</Muted> : (
        <ol className="mt-6 flex flex-col gap-1" aria-label={d.range.grain === "dia" ? "Por dia" : "Por mês"}>
          {v.series.map((s) => {
            const val = d.money ? s.cents ?? 0 : s.comandas;
            return (
              <li key={s.key} className="grid grid-cols-[56px_minmax(0,1fr)_auto] items-center gap-3 text-sm tabular">
                <span className="text-muted">{s.label}</span>
                <span className="h-2 rounded-full bg-paper-2" aria-hidden><span className="block h-2 rounded-full bg-gold" style={{ width: `${Math.round((100 * val) / max)}%` }} /></span>
                <span className="text-right">{d.money ? brl(s.cents) : `${s.comandas} ${s.comandas === 1 ? "comanda" : "comandas"}`}</span>
              </li>
            );
          })}
        </ol>
      )}
    </Section>
  );
}

function Professionals({ d }: { d: SalonView }) {
  type R = SalonView["professionals"][number];
  const cols: Col<R>[] = [
    { key: "n", label: "Profissional", render: (p) => p.name },
    ...moneyCol<R>(d.money, { key: "f", label: "Faturado", align: "right", render: (p) => brl(p.cents) }),
    { key: "c", label: "Comandas", align: "right", render: (p) => p.comandas },
    ...moneyCol<R>(d.money, { key: "t", label: "Ticket", align: "right", render: (p) => brl(p.ticketCents) }),
    ...moneyCol<R>(d.money, { key: "m", label: "Comissão", align: "right", render: (p) => (p.commissionCents == null ? <span className="text-muted">não importada</span> : brl(p.commissionCents)) }),
  ];
  return (
    <Section id="salao-profissionais" title="Por profissional" lead="Itens de comanda de cada profissional no período." legend="salaoProfissional">
      {d.professionals.length === 0 ? <Muted>Nenhuma comanda no período.</Muted> : <DataList rows={d.professionals} cols={cols} rowKey={(p) => p.key} caption="Por profissional" />}
    </Section>
  );
}

function Services({ d }: { d: SalonView }) {
  const s = d.services;
  type I = SalonView["services"]["items"][number];
  type C = SalonView["services"]["categories"][number];
  const itemCols: Col<I>[] = [
    { key: "i", label: "Serviço ou produto", render: (x) => x.item }, { key: "c", label: "Categoria", render: (x) => x.category ?? "—" },
    { key: "n", label: "Vezes", align: "right", render: (x) => x.n }, ...moneyCol<I>(d.money, { key: "v", label: "Faturado", align: "right", render: (x) => brl(x.cents) }),
  ];
  const catCols: Col<C>[] = [
    { key: "c", label: "Categoria", render: (x) => x.category }, { key: "n", label: "Itens", align: "right", render: (x) => x.n },
    ...moneyCol<C>(d.money, { key: "v", label: "Faturado", align: "right", render: (x) => brl(x.cents) }),
  ];
  return (
    <Section id="salao-servicos" title="Por serviço e categoria" lead={d.money ? "Os 15 que mais faturaram; o resto vai somado." : "Os 15 mais feitos; o resto vai somado."} legend="salaoServico">
      {s.items.length === 0 ? <Muted>Nenhum item no período.</Muted> : (
        <div className="grid lg:grid-cols-[3fr_2fr] gap-x-12 gap-y-6">
          <div className="min-w-0">
            <DataList rows={s.items} cols={itemCols} rowKey={(x) => x.item} caption="Serviços e produtos" />
            {s.otherItems.count > 0 && <p className="text-sm text-muted mt-2 tabular">Outros {s.otherItems.count}: {s.otherItems.n} itens{d.money ? ` · ${brl(s.otherItems.cents)}` : ""}</p>}
          </div>
          <div className="min-w-0"><DataList rows={s.categories} cols={catCols} rowKey={(x) => x.category} caption="Por categoria" /></div>
        </div>
      )}
    </Section>
  );
}

function Payments({ d }: { d: SalonView }) {
  type P = SalonView["payments"][number];
  const cols: Col<P>[] = [
    { key: "m", label: "Forma de pagamento", render: (p) => p.method }, { key: "n", label: "Pagamentos", align: "right", render: (p) => p.n },
    ...moneyCol<P>(d.money, { key: "v", label: "Recebido", align: "right", render: (p) => brl(p.cents) }),
  ];
  return (
    <Section id="salao-pagamentos" title="Formas de pagamento" lead="Pagamentos de comanda pela data do pagamento." legend="salaoPagamento">
      {d.payments.length === 0 ? <Muted>Nenhum pagamento no período.</Muted> : <DataList rows={d.payments} cols={cols} rowKey={(p) => p.method} caption="Pagamentos por forma" />}
    </Section>
  );
}

function Clients({ d }: { d: SalonView }) {
  const c = d.clients;
  const n = c.novas + c.recorrentes, nPrev = c.previous.novas + c.previous.recorrentes;
  return (
    <Section id="salao-clientes" title="Clientes novas e recorrentes" lead="Quem comprou no período. Nova: a primeira compra dela foi no período." legend="salaoClientes">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 max-w-[560px]">
        <Fig label="Novas" value={String(c.novas)} sub={<Delta c={compareMetric(c.novas, c.previous.novas, { kind: "count", n, nPrev })} prevText={`antes: ${c.previous.novas}`} />} />
        <Fig label="Recorrentes" value={String(c.recorrentes)} sub={<Delta c={compareMetric(c.recorrentes, c.previous.recorrentes, { kind: "count", n, nPrev })} prevText={`antes: ${c.previous.recorrentes}`} />} />
      </dl>
    </Section>
  );
}

function Attendance({ d }: { d: SalonView }) {
  const a = d.attendance;
  type A = SalonView["attendance"]["rows"][number];
  const cols: Col<A>[] = [
    { key: "p", label: "Profissional", render: (x) => x.name }, { key: "c", label: "Veio", align: "right", render: (x) => x.compareceu },
    { key: "f", label: "Faltou", align: "right", render: (x) => x.faltou }, { key: "x", label: "Cancelou", align: "right", render: (x) => x.cancelado },
    { key: "s", label: "Sem desfecho", align: "right", render: (x) => (x.semDesfecho ? <b className="text-alert">{x.semDesfecho}</b> : 0) },
  ];
  return (
    <Section id="salao-comparecimento" title="Comparecimento, faltas e cancelamentos" legend="salaoComparecimento"
      lead={`No período: ${a.total.compareceu} compareceram, ${a.total.faltou} faltaram, ${a.total.cancelado} cancelaram.`}>
      {a.rows.length === 0 ? <Muted>Nenhum horário no período.</Muted> : <DataList rows={a.rows} cols={cols} rowKey={(x) => x.key} caption="Comparecimento por profissional" />}
    </Section>
  );
}

function NoOutcome({ d }: { d: SalonView }) {
  const n = d.attendance.noOutcome;
  const line = (x: (typeof n.items)[number]) => (<><span>{x.clientName ?? "Cliente"} · {x.service}</span><span className="tabular text-muted">{when(x.startsAt)}{x.professional ? ` · ${x.professional}` : ""}</span></>);
  const row = "flex flex-wrap items-baseline justify-between gap-x-3 min-h-11 py-2 text-base";
  return (
    <Section id="salao-sem-desfecho" title="Agenda sem desfecho" legend="salaoSemDesfecho"
      lead={n.n ? `${n.n} ${n.n === 1 ? "horário já passou e continua" : "horários já passaram e continuam"} como agendado ou confirmado. Confira se a cliente veio.` : "Todo horário que já passou tem desfecho."}>
      {n.items.length > 0 && (
        <ul className="flex flex-col">
          {n.items.map((x) => (
            <li key={x.id} className="border-t border-line">
              {x.contactId ? <Link href={`/contatos/${x.contactId}`} className={`${row} hover:text-gold-ink`}>{line(x)}</Link> : <p className={row}>{line(x)}</p>}
            </li>
          ))}
        </ul>
      )}
      {n.n > n.items.length && <p className="text-sm text-muted mt-1">Mostrando {n.items.length} de {n.n}, os mais recentes.</p>}
    </Section>
  );
}

function Funnel({ d }: { d: SalonView }) {
  const f = d.funnel;
  const steps: [string, number][] = [["Conversas iniciadas", f.conversas], ["Marcaram horário depois", f.comHorario], ["Compareceram", f.compareceram], ["Compraram", f.compraram]];
  return (
    <Section id="salao-funil" title="Da conversa à compra" legend="salaoFunil"
      lead="Conversas que começaram no período e o que a cliente fez depois. Cada passo é contado por conta própria: quem passou na recepção compra sem horário marcado.">
      {f.conversas === 0 ? <Muted>Nenhuma conversa começou no período.</Muted> : (
        <dl className="grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-4">
          {steps.map(([label, n], i) => <Fig key={label} label={label} value={String(n)} sub={i === 0 ? null : <span className="text-sm text-muted tabular">{shareText(n, f.conversas)} das conversas</span>} />)}
        </dl>
      )}
    </Section>
  );
}
