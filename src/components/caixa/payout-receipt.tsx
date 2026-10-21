import type { ReactNode } from "react";
import { fillRecibo } from "@/lib/caixa-recursos";
import { ADJUSTMENT_LABEL } from "@/lib/adjustments";
import { firstName } from "@/lib/authorship";
import { displayName } from "@/lib/display-name";
import { formatBRL } from "@/lib/money";
import { periodText, type Payable, type PayoutReceipt as Receipt } from "@/lib/payouts";

const DATE = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Bahia" });
const dm = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`;

function Row({ label, value, sign, strong, testId, hint }: { label: string; value: number; sign?: "+" | "−"; strong?: boolean; testId?: string; hint?: string }) {
  return (
    <div className={strong ? "flex items-baseline justify-between gap-3 border-t border-line pt-2 text-base font-semibold" : "flex items-baseline justify-between gap-3"}>
      <dt>{label}{hint && <span className="block text-xs font-normal text-muted">{hint}</span>}</dt>
      <dd data-testid={testId} className="tabular">{`${sign ? `${sign} ` : ""}${formatBRL(value)}`}</dd>
    </div>
  );
}

function Detail({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="mt-4">
      <h3 className="mb-1 text-sm font-semibold">{title}</h3>
      <ul className="flex flex-col gap-1 text-sm text-graphite">{children}</ul>
    </section>
  );
}

/**
 * O corpo do recibo (e da prévia no "Pagar"): o resumo (Comissões, Como assistente, Bônus, Vales, Desconto na comissão, Saldo levado só
 * quando há, Total pago) e o detalhe de cada linha. Nunca mostra o valor do serviço, só a comissão.
 */
export function ReceiptBody({ p, carriedCents }: { p: Pick<Payable, "lines" | "adjustments" | "totals">; carriedCents: number }) {
  const items = p.lines.filter((l) => l.kind === "item"), helper = p.lines.filter((l) => l.kind === "assistente");
  const sum = (ls: typeof p.lines) => ls.reduce((s, l) => s + l.commissionCents, 0);
  const line = (l: (typeof p.lines)[number]) => (
    <li key={l.id} className="flex justify-between gap-3">
      <span>{`${dm(l.day)} · comanda ${l.comandaNumber} · ${firstName(l.clientName) ?? "Cliente"} · ${l.label}`}</span>
      <span className="tabular text-ink">{formatBRL(l.commissionCents)}</span>
    </li>
  );
  return (
    <div>
      <dl className="flex flex-col gap-1.5 text-sm">
        <Row label="Comissões" value={sum(items)} />
        {helper.length > 0 && <Row label="Como assistente" value={sum(helper)} />}
        <Row label="Bônus" value={p.totals.bonusCents} sign="+" />
        <Row label="Vales" value={p.totals.valesCents} sign="−" />
        <Row label="Desconto na comissão" value={p.totals.descontosCents} sign="−" />
        {carriedCents > 0 && <Row label="Saldo levado" value={carriedCents} sign="+" hint="Vira desconto na comissão do dia seguinte." />}
        <Row label="Total pago" value={p.totals.netCents} strong testId="total-pago" />
      </dl>
      {items.length > 0 && <Detail title="Comissões">{items.map(line)}</Detail>}
      {helper.length > 0 && <Detail title="Como assistente">{helper.map(line)}</Detail>}
      {p.adjustments.length > 0 && (
        <Detail title="Lançamentos">
          {p.adjustments.map((a) => (
            <li key={a.id} className="flex justify-between gap-3">
              <span>{`${dm(a.day)} · ${ADJUSTMENT_LABEL[a.kind]} · ${a.note}`}</span>
              <span className="tabular text-ink">{`${a.kind === "bonus" ? "+" : "−"} ${formatBRL(a.valueCents)}`}</span>
            </li>
          ))}
        </Detail>
      )}
    </div>
  );
}

/** O recibo do pagamento da comissão (tela, impressão e app da profissional). O texto vem de Configurações › Caixa ("Texto do recibo"). */
export function PayoutReceipt({ receipt: r, reciboTexto }: { receipt: Receipt; reciboTexto: string }) {
  const name = displayName(r.name), period = periodText(r.fromDay, r.untilDay);
  const titleId = `recibo-${r.id}`;
  return (
    <article aria-labelledby={titleId} className="rounded-[var(--radius-card)] border border-line bg-paper p-5 print:border-0 print:p-0">
      <header className="mb-4">
        <h2 id={titleId} className="text-lg font-semibold">{`Recibo nº ${r.number}`}</h2>
        <p className="text-sm text-graphite">{`${name} · ${period}`}</p>
        <p className="text-sm text-graphite">{`Pago em ${DATE.format(new Date(r.paidAt))}${r.paidByName ? ` por ${r.paidByName}` : ""}`}</p>
        {r.note && <p className="text-sm text-graphite">{r.note}</p>}
        {r.cancelledAt && <p role="status" className="mt-2 rounded-[var(--radius-control)] bg-alert-soft px-3 py-2 text-sm text-alert">{`Pagamento desfeito em ${DATE.format(new Date(r.cancelledAt))}: ${r.cancelReason ?? ""}`}</p>}
      </header>
      <ReceiptBody p={r} carriedCents={r.carriedCents} />
      <p data-testid="recibo-texto" className="mt-6 text-sm">
        {fillRecibo(reciboTexto, { profissional: name, numero: String(r.number), periodo: period, total: formatBRL(r.totals.netCents) })}
      </p>
      <div className="mt-10 w-64 border-t border-ink pt-1 text-center text-xs text-graphite">{name}</div>
    </article>
  );
}
