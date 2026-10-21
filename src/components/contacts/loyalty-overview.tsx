import Link from "next/link";
import { Empty } from "@/components/ui/empty";
import { LOYALTY_REASON_LABEL } from "@/lib/loyalty";
import { displayName } from "@/lib/client-rhythm";
import type { LoyaltyOverview } from "@/server/queries/loyalty-view";

const when = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Bahia" });
const sign = (n: number) => (n > 0 ? `+${n}` : String(n));

/** Clientes › Fidelidade: o saldo de cada cliente em cada programa e os últimos movimentos. Só consulta (os programas ficam em Serviços e pacotes › Fidelidade). */
export function LoyaltyOverviewView({ data }: { data: LoyaltyOverview }) {
  if (!data.balances.length && !data.movements.length) return <div className="rounded-[var(--radius-panel)] border border-line bg-paper"><Empty title="Nenhum ponto ainda">Os pontos aparecem aqui quando as clientes pontuam nos programas de fidelidade.</Empty></div>;
  return (
    <div className="flex flex-col gap-4"><p className="text-sm text-graphite">Os programas (quanto vale cada ponto e os prêmios) ficam em <Link href="/servicos?aba=fidelidade" className="font-medium text-gold-ink underline underline-offset-4">Serviços e pacotes</Link>.</p>
    <div className="grid items-start gap-6 lg:grid-cols-2">
      <section aria-labelledby="fid-saldos">
        <h2 id="fid-saldos" className="mb-2 text-base font-semibold text-ink">Saldos</h2>
        <ul className="divide-y divide-line rounded-[var(--radius-panel)] border border-line bg-paper">
          {data.balances.map((b) => (
            <li key={`${b.contactId}|${b.programName}`} className="flex items-baseline justify-between gap-3 px-4 py-3">
              <span className="min-w-0"><Link href={`/contatos/${b.contactId}`} className="block truncate font-medium hover:text-gold-ink">{displayName(b.name) ?? "Sem nome"}</Link><span className="block text-xs text-muted">{b.programName}</span></span>
              <span className="tabular shrink-0 text-base font-semibold text-ink">{b.balance}</span>
            </li>
          ))}
          {!data.balances.length && <li className="px-4 py-3 text-sm text-graphite">Nenhum saldo em aberto.</li>}
        </ul>
      </section>
      <section aria-labelledby="fid-mov">
        <h2 id="fid-mov" className="mb-2 text-base font-semibold text-ink">Últimos movimentos</h2>
        <ul className="divide-y divide-line rounded-[var(--radius-panel)] border border-line bg-paper">
          {data.movements.map((m) => (
            <li key={m.id} className="flex items-baseline justify-between gap-3 px-4 py-3">
              <span className="min-w-0">
                <Link href={`/contatos/${m.contactId}`} className="block truncate text-sm font-medium hover:text-gold-ink">{displayName(m.name) ?? "Sem nome"}</Link>
                <span className="block text-xs text-muted">{LOYALTY_REASON_LABEL[m.reason]} · {m.programName} · {when(m.at)}{m.note ? ` · ${m.note}` : ""}</span>
              </span>
              <span className="tabular shrink-0 text-sm font-semibold text-ink">{sign(m.delta)}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
    </div>
  );
}
