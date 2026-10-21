"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Empty } from "@/components/ui/empty";
import { Input } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { undoPayoutAction } from "@/app/(app)/caixa/comissao/actions";
import { displayName } from "@/lib/display-name";
import { formatBRL } from "@/lib/money";
import { periodText, type PayoutRow } from "@/lib/payouts";

const DATE = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Bahia" });

/** Caixa › Comissão › Pagas: os recibos, do mais novo, com "Abrir recibo" e "Desfazer" (motivo). Os desfeitos ficam marcados. */
export function PayoutsList({ rows }: { rows: PayoutRow[] }) {
  if (!rows.length) return <div className="rounded-[var(--radius-card)] border border-line bg-paper"><Empty title="Nenhum recibo ainda">Cada pagamento da comissão gera um recibo numerado.</Empty></div>;
  return (
    <ul aria-label="Pagas" className="divide-y divide-line rounded-[var(--radius-card)] border border-line bg-paper">
      {rows.map((r) => (
        <li key={r.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 text-sm">
          <div className={r.cancelledAt ? "text-muted" : ""}>
            <p className="font-medium">{`Recibo nº ${r.number} · ${displayName(r.professionalName)}`}</p>
            <p className="text-graphite">{`${periodText(r.fromDay, r.untilDay)} · pago em ${DATE.format(new Date(r.paidAt))}${r.paidByName ? ` por ${r.paidByName}` : ""}`}</p>
            {r.cancelledAt && <p className="text-graphite">{`Desfeito em ${DATE.format(new Date(r.cancelledAt))}: ${r.cancelReason ?? ""}`}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className={r.cancelledAt ? "tabular text-muted line-through" : "font-semibold tabular"}>{formatBRL(r.netCents)}</span>
            <Link href={`/caixa/comissao/recibo/${r.id}`} className="inline-flex min-h-11 items-center font-medium text-gold-ink underline underline-offset-4 lg:min-h-0">Abrir recibo</Link>
            {!r.cancelledAt && <UndoPayout id={r.id} />}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** "Desfazer" o pagamento com motivo: linhas e lançamentos voltam ao A pagar (usado em Pagas e na página do recibo). */
export function UndoPayout({ id }: { id: string }) {
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const undo = () => start(async () => {
    if (!reason.trim()) { setError("Escreva o motivo."); return; }
    const r = await undoPayoutAction(id, { reason });
    if (!r.ok) { setError(r.error); return; }
    toast("Pagamento desfeito: tudo voltou ao A pagar"); setAsking(false); router.refresh();
  });
  if (!asking) return <Button variant="secondary" onClick={() => setAsking(true)}>Desfazer</Button>;
  return (
    <div className="flex w-full flex-wrap items-end gap-2 print:hidden">
      <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs text-graphite">Motivo<Input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} /></label>
      <Button variant="danger" loading={pending} onClick={undo}>Confirmar desfazer</Button>
      {error && <p role="alert" className="w-full text-sm text-alert">{error}</p>}
    </div>
  );
}
