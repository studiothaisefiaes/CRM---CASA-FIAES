"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { savePaymentOptionAction } from "@/app/(app)/servicos/actions";

/**
 * Serviços e pacotes › Formas de pagamento (gestão do caixa): a "Outra forma" que a recepção escolhe ao receber (ex.: Transferência,
 * Vale da Casa). Nunca apaga: desativar tira do caixa e mantém o nome nos pagamentos antigos.
 */
export function PaymentOptionsEditor({ options }: { options: { id: string; label: string; active: boolean }[] }) {
  const [label, setLabel] = useState("");
  const [names, setNames] = useState<Record<string, string>>(Object.fromEntries(options.map((o) => [o.id, o.label])));
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const save = (input: { id?: string; label: string; active?: boolean }, done?: string) => start(async () => {
    const r = await savePaymentOptionAction(input);
    if (!r.ok) { toast(r.error, "error"); return; }
    if (done) toast(done);
    if (!input.id) setLabel("");
    router.refresh();
  });
  return (
    <section aria-label="Formas de pagamento" className="flex max-w-2xl flex-col gap-4">
      <p className="text-sm text-graphite">Pix, Crédito, Débito, Dinheiro, Cortesia e Crédito da cliente já vêm no caixa. Aqui entram as outras formas que a Casa aceita.</p>
      <div className="rounded-[var(--radius-card)] border border-line bg-paper">
        {options.length ? (
          <ul className="divide-y divide-line/70">
            {options.map((o) => (
              <li key={o.id} className="flex items-center gap-3 px-4 py-3">
                <Input aria-label={`Nome de ${o.label}`} value={names[o.id] ?? o.label} maxLength={40} className="h-10 flex-1"
                  onChange={(e) => setNames((n) => ({ ...n, [o.id]: e.target.value }))}
                  onBlur={() => { const v = (names[o.id] ?? "").trim(); if (v && v !== o.label) save({ id: o.id, label: v, active: o.active }, "Forma renomeada"); }} />
                <span className="text-xs text-muted">{o.active ? "Ativa" : "Desativada"}</span>
                <Switch checked={o.active} label={`${o.label} ativa`} disabled={pending} onChange={(v) => save({ id: o.id, label: o.label, active: v })} />
              </li>
            ))}
          </ul>
        ) : <p className="px-4 py-5 text-center text-sm text-muted">Nenhuma outra forma ainda.</p>}
      </div>
      <div className="flex items-end gap-2">
        <label className="flex flex-1 flex-col gap-1 text-sm text-graphite">Nova forma<Input value={label} maxLength={40} onChange={(e) => setLabel(e.target.value)} placeholder="ex.: Transferência" className="h-11" /></label>
        <Button variant="secondary" disabled={pending || label.trim().length < 2} onClick={() => save({ label: label.trim() }, "Forma adicionada")}>Adicionar</Button>
      </div>
    </section>
  );
}
