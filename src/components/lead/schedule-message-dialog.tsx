"use client";
import { useState, useTransition } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { scheduleMessageAction } from "@/app/(app)/conversa/actions";
import { bahiaAt } from "@/lib/next-action";
import { bahiaDateInput, bahiaTimeInput, fromBahiaInputs } from "@/lib/bahia-input";
import { stripSignature } from "@/lib/signature";

/** Padrão do diálogo: amanhã 10:00 em Salvador. */
const tomorrowAt10 = () => bahiaAt(Date.now(), 1, 10).getTime();

/**
 * "Agendar envio": dia e hora de Salvador; o servidor confere Casa aberta, 5 min a 60 dias. Padrão: amanhã 10:00.
 * Os campos nascem com o padrão ao montar: quem usa monta o diálogo só enquanto está aberto (o campo da conversa faz assim).
 */
export function ScheduleMessageDialog({ open, onClose, dealId, text, onDone }: { open: boolean; onClose: () => void; dealId: string; text: string; onDone: (atIso: string) => void }) {
  const [day, setDay] = useState(() => bahiaDateInput(tomorrowAt10())); const [time, setTime] = useState(() => bahiaTimeInput(tomorrowAt10()));
  const [cancelIfReply, setCancelIfReply] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const submit = () => {
    const at = fromBahiaInputs(day, time);
    if (!at) { setError("Escolha o dia e a hora."); return; }
    start(async () => {
      const r = await scheduleMessageAction({ dealId, text, at: at.toISOString(), cancelIfReply });
      if (!r.ok) { setError(r.error); return; }
      onDone(r.data!.at); onClose();
    });
  };
  return (
    <Dialog open={open} onClose={onClose} title="Agendar envio" width={420}
      description="A mensagem sai no dia e hora escolhidos, assinada por você, só com a Casa aberta."
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button onClick={submit} loading={pending}>Agendar</Button></>}>
      <div className="flex flex-col gap-3">
        <p className="rounded-[var(--radius-control)] bg-paper-2 px-3 py-2 text-sm text-graphite line-clamp-3">{stripSignature(text)}</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Dia" htmlFor="ag-dia"><Input id="ag-dia" type="date" value={day} onChange={(e) => setDay(e.target.value)} /></Field>
          <Field label="Hora" htmlFor="ag-hora"><Input id="ag-hora" type="time" value={time} onChange={(e) => setTime(e.target.value)} /></Field>
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={cancelIfReply} onChange={(e) => setCancelIfReply(e.target.checked)} className="mt-0.5 size-4" aria-label="Não enviar se a cliente escrever antes" />
          <span>Não enviar se a cliente escrever antes <span className="block text-muted">Você recebe um aviso e decide.</span></span>
        </label>
        {error && <p role="alert" className="text-sm text-alert">{error}</p>}
      </div>
    </Dialog>
  );
}
