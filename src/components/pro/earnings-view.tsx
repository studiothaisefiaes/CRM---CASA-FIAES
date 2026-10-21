import Link from "next/link";
import type { Earnings, EarningsPeriod, EarningsReceipt } from "@/lib/pro-earnings";
import { formatBRL } from "@/lib/money";

const DATE = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Bahia" });

function Period({ title, p }: { title: string; p: EarningsPeriod }) {
  return (
    <section aria-label={title} className="rounded-[var(--radius-card)] border border-line bg-paper p-4">
      <p className="text-sm text-graphite">{title}</p>
      <p className="font-display text-2xl leading-tight tabular">{formatBRL(p.totalCents)}</p>
      {p.lines.length === 0 ? <p className="mt-2 text-sm text-graphite">Nada fechado ainda.</p> : (
        <ul className="mt-2 flex flex-col gap-1.5 text-sm">
          {p.lines.map((l) => (
            <li key={l.id}>
              {l.client} · {l.label}
              {l.why ? <span className="text-gold-ink"> · {l.why}</span> : <> · {l.pct}{l.serviceCents != null ? <> de {formatBRL(l.serviceCents)} (base depois dos descontos)</> : null} = <b className="font-semibold">{formatBRL(l.commissionCents ?? 0)}</b></>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Ganhos: hoje e o mês, com o total da comissão em destaque; "aguardando fechamento" para o que ainda não foi pago. */
export function EarningsView({ data }: { data: Earnings }) {
  if (!data.configured) return <p role="status" className="text-graphite">Comissão ainda não configurada. Fale com a gestão.</p>;
  return (
    <div className="flex flex-col gap-3">
      <Period title="Hoje" p={data.today} />
      <Period title="Este mês" p={data.month} />
      {data.waiting.length > 0 && (
        <section aria-label="Aguardando fechamento" className="rounded-[var(--radius-card)] border border-dashed border-line p-4 text-sm">
          <p className="font-medium">Aguardando fechamento</p>
          <ul className="mt-1 flex flex-col gap-1">{data.waiting.map((w) => <li key={w.id}>{w.day.slice(8, 10)}/{w.day.slice(5, 7)} · {w.client} · {w.service}</li>)}</ul>
        </section>
      )}
    </div>
  );
}

/** Os recibos de pagamento da comissão dela; cada um abre o recibo. */
function Receipts({ receipts }: { receipts: EarningsReceipt[] }) {
  if (!receipts.length) return null;
  return (
    <section aria-label="Recibos" className="rounded-[var(--radius-card)] border border-line bg-paper p-4 text-sm">
      <p className="font-medium">Recibos</p>
      <ul className="mt-1 flex flex-col">
        {receipts.map((r) => (
          <li key={r.id}>
            <Link href={`/pro/ganhos/recibo/${r.id}`} className="flex min-h-11 items-center justify-between gap-3 text-ink">
              <span>{`Recibo nº ${r.number} · ${DATE.format(new Date(r.paidAt))} · `}<b className="font-semibold tabular">{formatBRL(r.netCents)}</b></span>
              <span aria-hidden className="text-gold-ink">›</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A página Ganhos: os ganhos (só com o caixa no CRM) e os recibos (sempre: pagar a comissão não depende do modo do caixa). */
export function GanhosView({ data, receipts }: { data: Earnings | null; receipts: EarningsReceipt[] }) {
  return (
    <div className="flex flex-col gap-3">
      {data ? <EarningsView data={data} /> : <p role="status" className="text-graphite">Os ganhos aparecem aqui quando o caixa passar para o CRM.</p>}
      <Receipts receipts={receipts} />
    </div>
  );
}
