"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { cancelMovementAction } from "@/app/(app)/caixa/actions";
import { money } from "@/lib/format";
import type { MovementRow } from "@/server/domain/caixa/cash";

/** Sangrias e suprimentos do caixa aberto, cada um com "Cancelar" (pede o motivo). Cancelar a sangria que virou vale cancela o vale também. */
export function MovementsList({ rows }: { rows: MovementRow[] }) {
  if (!rows.length) return null;
  return (
    <section aria-label="Sangrias e suprimentos" className="mb-4 rounded-[var(--radius-card)] border border-line bg-paper">
      <h2 className="border-b border-line px-4 py-2.5 text-sm font-semibold">Sangrias e suprimentos de hoje</h2>
      <ul className="divide-y divide-line">{rows.map((r) => <Row key={r.id} r={r} />)}</ul>
    </section>
  );
}

function Row({ r }: { r: MovementRow }) {
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const name = r.kind === "sangria" ? "Sangria" : "Suprimento";
  const cancel = () => start(async () => {
    const res = await cancelMovementAction(r.id, { reason });
    if (!res.ok) { setError(res.error); return; }
    toast(`${name} cancelada`); router.refresh();
  });
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
      <p><span className="font-medium">{`${name} ${money(r.valueCents)}`}</span><span className="text-graphite">{` · ${r.reason}${r.vale ? ` · vale de ${r.vale}` : ""}`}</span></p>
      {!asking && <Button variant="secondary" aria-label={`Cancelar ${name.toLowerCase()} de ${money(r.valueCents)}`} onClick={() => setAsking(true)}>Cancelar</Button>}
      {asking && (
        <div className="flex w-full flex-wrap items-end gap-2">
          <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs text-graphite">Motivo do cancelamento<Input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} /></label>
          <Button loading={pending} onClick={cancel}>Confirmar cancelamento</Button>
          {error && <p role="alert" className="w-full text-sm text-alert">{error}</p>}
        </div>
      )}
    </li>
  );
}
