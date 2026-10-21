"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { openWalkInAction, type Approval } from "@/app/(app)/caixa/actions";
import { todayBahia } from "@/lib/agenda";
import { ApprovalBox } from "./approval-box";
import { AddItem, type ComandaCatalog } from "./comanda-panel";

/**
 * "Nova comanda" (venda de balcão) sem comanda vazia (QA r58, I-8): abrir não cria nada; a comanda nasce no servidor junto com o primeiro
 * item, numa transação só. Cancelar não deixa rastro, e nenhuma vazia vira pendência no Fechar o dia.
 */
export function NewComanda({ catalog, onCreated, onCancel }: { catalog: ComandaCatalog; onCreated: (comandaId: string) => void; onCancel: () => void }) {
  const [requestKey] = useState(() => crypto.randomUUID()); // dois toques no Somar não abrem duas
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const day = catalog.today ?? todayBahia(new Date());
  const [approval, setApproval] = useState<null | { message: string; item: Record<string, unknown>; error?: string }>(null);
  const send = (item: Record<string, unknown>, ap?: NonNullable<Approval>) => start(async () => {
    setError(null);
    const input = { requestKey, clientName: name.trim() || null, item: item as Parameters<typeof openWalkInAction>[0]["item"] };
    const r = await openWalkInAction(ap ? { ...input, approval: ap } : input);
    // Preço abaixo do limite de desconto da Casa (QA r58, I-11): a gestão aprova ali mesmo, e a comanda nasce com o item.
    if (!r.ok && r.needsApproval) { setApproval({ message: r.error, item }); return; }
    if (!r.ok) { if (ap) setApproval({ message: approval?.message ?? r.error, item, error: r.error }); else setError(r.error); return; }
    setApproval(null);
    onCreated(r.data!.comandaId);
  });
  const add = (item: Record<string, unknown>) => send(item);
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-graphite">A comanda só passa a existir quando o primeiro item for somado.</p>
      {error && <p role="alert" className="rounded-[var(--radius-control)] bg-alert-soft px-3 py-2 text-sm text-alert">{error}</p>}
      {approval && <ApprovalBox message={approval.message} error={approval.error} canGerir={catalog.canGerir} pending={pending}
        onApprove={(ap) => send(approval.item, ap)} onCancel={() => setApproval(null)} />}
      <label className="flex max-w-sm flex-col gap-1 text-sm text-graphite">Nome da cliente (opcional)
        <Input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder="Cliente de balcão" className="h-11" />
      </label>
      <AddItem comanda={{ contactId: null, day }} catalog={catalog} pending={pending} onAdd={add} />
      <div className="flex justify-end"><Button variant="ghost" onClick={onCancel}>Cancelar</Button></div>
    </div>
  );
}
