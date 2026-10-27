import { money } from "@/lib/format";
import { formatCnpj } from "@/lib/cnpj";
import { brDay } from "@/lib/salon-period";
import { FISCAL_ENV_LABEL, FISCAL_KIND_LABEL, fiscalStatusLabel } from "@/lib/fiscal-status";
import type { AEmitirRow, NotaRow, ParceiraExtrato } from "@/server/reports/financeiro/notas";
import type { SalonRange } from "@/lib/salon-period";
import { DataList, type Col } from "./data-list";
import { Muted, Section } from "./section";

/** "2026-10" → "outubro de 2026". */
const monthName = (key: string) => new Date(`${key}-15T12:00:00Z`).toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "America/Bahia" });

/** Relatórios › Financeiro › Notas fiscais: "Que notas saíram?" As notas do período e o extrato de cada parceira, para a nota que ela emite. */
/** `xml` (nota.ver): cada nota com o link para baixar o XML (o que o contador guarda). */
export function NotasFiscaisTab({ range, notas, parceiras, aEmitir = [], xml = false }: { range: SalonRange; notas: NotaRow[]; parceiras: ParceiraExtrato[]; aEmitir?: AEmitirRow[]; xml?: boolean }) {
  const notaCols: Col<NotaRow>[] = [
    { key: "c", label: "Comanda", render: (r) => `Comanda ${r.comandaNumber}` },
    { key: "d", label: "Dia", render: (r) => brDay(r.day) },
    { key: "t", label: "Tipo", render: (r) => FISCAL_KIND_LABEL[r.kind] ?? r.kind },
    { key: "a", label: "Ambiente", render: (r) => FISCAL_ENV_LABEL[r.environment] ?? r.environment },
    { key: "s", label: "Situação", render: (r) => <span className={r.status === "rejeitada" || r.status === "erro_envio" ? "text-alert font-medium" : r.status === "cancelada" ? "text-muted" : ""}>{fiscalStatusLabel(r.status)}{r.rejectReason ? `: ${r.rejectReason}` : ""}</span> },
    { key: "v", label: "Valor", align: "right", render: (r) => money(r.amountCents) },
    ...(xml ? [{ key: "x", label: "Arquivo", render: (r: NotaRow) => (
      <a href={`/api/notas-fiscais/${r.id}?formato=xml`} download className="inline-flex items-center min-h-11 lg:min-h-0 text-gold-ink underline underline-offset-2 hover:text-ink" aria-label={`Baixar o XML da comanda ${r.comandaNumber}`}>XML</a>
    ) }] : []),
  ];
  const parCols: Col<ParceiraExtrato>[] = [
    { key: "m", label: "Mês", render: (r) => monthName(r.month) },
    { key: "p", label: "Parceira", render: (r) => (r.legalName === r.name ? r.name : `${r.name} (${r.legalName})`) },
    { key: "n", label: "CNPJ", render: (r) => formatCnpj(r.cnpj) },
    { key: "q", label: "Comandas", align: "right", render: (r) => String(r.comandas) },
    { key: "v", label: "Valor", align: "right", render: (r) => money(r.cents) },
  ];
  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-3">
        <h2 className="leading-tight text-lg font-semibold">Que notas saíram?</h2>
      </div>
      {aEmitir.length > 0 && (
        <Section id="nf-a-emitir" title="A emitir" lead="Comandas fechadas em que a recepção escolheu emitir a nota. Nada foi emitido ainda." legend="finNotas">
          <DataList rows={aEmitir} rowKey={(r) => r.id} caption="Notas a emitir" cols={[
            { key: "c", label: "Comanda", render: (r) => `Comanda ${r.comandaNumber}` },
            { key: "d", label: "Dia", render: (r) => brDay(r.day) },
            { key: "n", label: "Cliente", render: (r) => r.clientName },
            { key: "e", label: "Nota", render: (r) => (r.escolha === "com_cpf" ? "Com CPF" : "Sem CPF") },
            { key: "s", label: "Situação", render: () => "A emitir" },
            { key: "v", label: "Valor", align: "right", render: (r) => money(r.totalCents) },
          ] as Col<AEmitirRow>[]} />
        </Section>
      )}
      <Section id="nf-notas" title="Notas do período" lead={`${range.label}. Pelo dia da comanda.`} legend="finNotas">
        {notas.length ? <DataList rows={notas} cols={notaCols} rowKey={(r) => r.id} caption="Notas do período" /> : <Muted>Nenhuma nota neste período.</Muted>}
      </Section>
      <Section id="nf-parceiras" title="Para a nota das parceiras" lead="O que cada parceira emite contra a Casa: a cota-parte dela nas comandas fechadas, mês a mês." legend="finNotasParceiras">
        {parceiras.length ? <DataList rows={parceiras} cols={parCols} rowKey={(r) => `${r.month}-${r.professionalId}-${r.cnpj}`} caption="Para a nota das parceiras" /> : <Muted>Nenhuma cota de parceira neste período.</Muted>}
      </Section>
    </div>
  );
}
