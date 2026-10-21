"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Empty } from "@/components/ui/empty";
import { Input } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { payableAction, payCommissionAction } from "@/app/(app)/caixa/comissao/actions";
import { displayName } from "@/lib/display-name";
import { formatBRL } from "@/lib/money";
import { brDate, payoutTotals, type Payable } from "@/lib/payouts";
import { ReceiptBody } from "./payout-receipt";

const plural = (n: number, um: string, varios: string) => (n === 1 ? um : varios);

/** Caixa › Comissão › A pagar: por profissional, até quando e o total; "Pagar" abre a prévia do recibo. Só com `comissao.pagar`. */
export function PayablesPanel({ items }: { items: Payable[] }) {
  const [open, setOpen] = useState<Payable | null>(null);
  if (!items.length) return (
    <div className="rounded-[var(--radius-card)] border border-line bg-paper">
      <Empty title="Nada a pagar">Comissões de comandas fechadas e vales, bônus e descontos na comissão aparecem aqui até o fim do último período de cada profissional.</Empty>
    </div>
  );
  return (
    <>
      <ul aria-label="A pagar" className="divide-y divide-line rounded-[var(--radius-card)] border border-line bg-paper">
        {items.map((p) => (
          <li key={p.professionalId} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div>
              <p className="font-medium">{displayName(p.name)}</p>
              <p className="text-sm text-graphite">{`até ${brDate(p.untilDay)}`}{p.pending.length > 0 ? ` · ${p.pending.length} ${plural(p.pending.length, "linha espera", "linhas esperam")}` : ""}</p>
            </div>
            <div className="flex items-center gap-3">
              <span className="font-semibold tabular">{formatBRL(p.totals.netCents)}</span>
              <Button aria-label={`Pagar ${displayName(p.name)}`} onClick={() => setOpen(p)}>Pagar</Button>
            </div>
          </li>
        ))}
      </ul>
      {open && <PayoutSheet key={open.professionalId} initial={open} onClose={() => setOpen(null)} />}
    </>
  );
}

/**
 * Pagar a comissão de uma profissional: a data (sugerida = fim do último período fechado dela), a prévia do recibo e "Confirmar pagamento".
 * O servidor confere o total que a tela mostrou; se mudou, a prévia é refeita e o erro diz o valor de agora.
 */
export function PayoutSheet({ initial, onClose }: { initial: Payable; onClose: () => void }) {
  const [p, setP] = useState(initial);
  const [until, setUntil] = useState(initial.untilDay);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const name = displayName(p.name);
  const { carriedCents } = payoutTotals(p.lines, p.adjustments);
  const empty = !p.lines.length && !p.adjustments.length;

  const reload = async (day: string) => {
    const r = await payableAction(p.professionalId, day);
    if (!r.ok) { setError(r.error); return; }
    if (r.data) setP(r.data);
  };
  const changeDay = (day: string) => {
    setUntil(day); setError(null);
    if (/^\d{4}-\d{2}-\d{2}$/.test(day)) start(() => reload(day));
  };
  const confirm = () => start(async () => {
    setError(null);
    const r = await payCommissionAction({ professionalId: p.professionalId, until, expectedNetCents: p.totals.netCents, note: note.trim() || null });
    if (!r.ok) { setError(r.error); await reload(until); return; }
    toast(`Recibo nº ${r.data?.number ?? ""} pago`);
    if (r.data) router.push(`/caixa/comissao/recibo/${r.data.id}`);
  });

  return (
    <Sheet open onClose={onClose} title={`Pagar a comissão de ${name}`}
      footer={<Button loading={pending} disabled={empty} onClick={confirm}>Confirmar pagamento</Button>}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1 text-sm text-graphite">
          <label className="flex flex-col gap-1">Até<Input type="date" value={until} onChange={(e) => changeDay(e.target.value)} /></label>
          <span className="text-xs text-muted">Paga tudo o que ainda não foi pago até esse dia.</span>
        </div>
        <section aria-label="Recibo (prévia)" className="rounded-[var(--radius-card)] border border-line p-4">
          <h3 className="mb-3 text-sm font-semibold">Recibo (prévia)</h3>
          {empty ? <p className="text-sm text-graphite">{`Nada a pagar até ${brDate(until)}.`}</p> : <ReceiptBody p={p} carriedCents={carriedCents} />}
        </section>
        {p.pending.length > 0 && (
          <p className="rounded-[var(--radius-control)] bg-paper-2 px-3 py-2 text-sm text-graphite">
            {`${p.pending.length} ${plural(p.pending.length, "linha espera", "linhas esperam")} (sem regra, sessão sem valor ou dívida da cliente): não ${plural(p.pending.length, "entra", "entram")} neste recibo.`}
          </p>
        )}
        <label className="flex flex-col gap-1 text-sm text-graphite">Observação (opcional)<Input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} /></label>
        {error && <p role="alert" className="text-sm text-alert">{error}</p>}
      </div>
    </Sheet>
  );
}
