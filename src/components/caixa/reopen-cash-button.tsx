"use client";
import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { reopenCashAction } from "@/app/(app)/caixa/actions";

/**
 * Reabrir um caixa fechado (gestão). QA r58, I-2: nunca num clique; pergunta, pede o motivo (vai para a auditoria) e o botão cinza diz o
 * que falta, como no Registrar ligação.
 */
export function ReopenCashButton({ id, ownerName, choices }: {
  id?: string; ownerName?: string | null;
  /** Um "Reabrir" por seção (dsgfix, r68 #15): os caixas fechados viram uma lista dentro da confirmação, em vez de um botão por linha. */
  choices?: { id: string; label: string; ownerName: string | null }[];
}) {
  const fid = useId();
  const [pick, setPick] = useState(choices?.[0]?.id ?? id ?? "");
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const missing = reason.trim() ? null : "Para reabrir, escreva o motivo.";
  const close = () => { setOpen(false); setReason(""); setError(null); };
  const confirm = () => {
    if (missing) return;
    start(async () => {
      const r = await reopenCashAction(pick, { reason: reason.trim() });
      if (!r.ok) { setError(r.error); return; }
      toast("Caixa reaberto", "ok");
      close();
      router.refresh();
    });
  };
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>{choices ? "Reabrir um caixa" : "Reabrir"}</Button>
      <Dialog open={open} onClose={close} title={choices ? "Reabrir um caixa?" : ownerName ? `Reabrir o caixa de ${ownerName}?` : "Reabrir o caixa?"} width={440}
        description="O caixa volta a aceitar pagamentos e estornos e precisa ser fechado de novo, com nova contagem. Fica registrado quem reabriu e por quê."
        footer={<><Button variant="ghost" onClick={close}>Cancelar</Button>
          <Button variant="danger" onClick={confirm} disabled={!!missing} loading={pending} aria-describedby={missing ? `${fid}-falta` : undefined}>Reabrir o caixa</Button></>}>
        <div className="flex flex-col gap-2">
          {choices && (
            <>
              <label htmlFor={`${fid}-q`} className="text-xs font-medium text-graphite">Qual caixa</label>
              <Select id={`${fid}-q`} value={pick} onChange={(e) => setPick(e.target.value)} className="mb-2 h-11">
                {choices.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </Select>
            </>
          )}
          <label htmlFor={`${fid}-m`} className="text-xs font-medium text-graphite">Motivo da reabertura <span className="font-normal text-muted">(obrigatório)</span></label>
          <Input id={`${fid}-m`} value={reason} maxLength={300} onChange={(e) => { setReason(e.target.value); setError(null); }} placeholder="ex.: estorno de um Pix lançado em dobro" className="h-11" />
          {missing && <p id={`${fid}-falta`} className="text-sm text-graphite">{missing}</p>}
          {error && <p role="alert" className="text-sm text-alert">{error}</p>}
        </div>
      </Dialog>
    </>
  );
}
