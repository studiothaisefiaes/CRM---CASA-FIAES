"use client";
import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { cancelarComandaAction, undoCancelarComandaAction } from "@/app/(app)/caixa/actions";

/**
 * Cancelar uma comanda aberta (psico r68 #1): nunca num clique. Pergunta, pede o motivo (vai para a auditoria) e o aviso traz "Desfazer";
 * por 10 minutos a comanda também volta pelo painel ("Desfazer cancelamento"). Permissão caixa.cancelar (conferida no servidor).
 */
export function CancelComandaDialog({ open, comandaId, label, onClose, onDone }: { open: boolean; comandaId: string; label: string; onClose: () => void; onDone?: () => void }) {
  const fid = useId();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const missing = reason.trim() ? null : "Para cancelar, escreva o motivo.";
  const close = () => { setReason(""); setError(null); onClose(); };
  const undo = () => start(async () => {
    const r = await undoCancelarComandaAction(comandaId);
    toast(r.ok ? `${label} voltou para a lista` : (r.error ?? "Não foi possível desfazer."), r.ok ? "ok" : "error");
    onDone?.(); router.refresh();
  });
  const confirm = () => {
    if (missing) return;
    start(async () => {
      const r = await cancelarComandaAction(comandaId, reason.trim());
      if (!r.ok) { setError(r.error ?? "Não foi possível cancelar."); return; }
      toast(`${label} cancelada`, "ok", { label: "Desfazer", onClick: undo });
      close(); onDone?.(); router.refresh();
    });
  };
  return (
    <Dialog open={open} onClose={close} title={`Cancelar a ${label.charAt(0).toLowerCase()}${label.slice(1)}?`} width={440}
      description="Ela sai da lista com os itens. Nos próximos 10 minutos dá para desfazer."
      footer={<><Button variant="ghost" onClick={close}>Voltar</Button>
        <Button variant="danger" onClick={confirm} disabled={!!missing} loading={pending} aria-describedby={missing ? `${fid}-falta` : undefined}>Cancelar a comanda</Button></>}>
      <div className="flex flex-col gap-2">
        <label htmlFor={`${fid}-m`} className="text-sm font-medium text-graphite">Motivo do cancelamento <span className="font-normal text-muted">(obrigatório)</span></label>
        <Input id={`${fid}-m`} value={reason} maxLength={300} onChange={(e) => { setReason(e.target.value); setError(null); }} placeholder="ex.: cliente desistiu, comanda em dobro" />
        {missing && <p id={`${fid}-falta`} className="text-sm text-graphite">{missing}</p>}
        {error && <p role="alert" className="text-sm text-alert">{error}</p>}
      </div>
    </Dialog>
  );
}
