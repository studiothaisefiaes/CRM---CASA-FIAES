"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { dayVisitAction } from "@/app/(app)/agenda/actions";
import { useToast } from "@/components/ui/toast";
import { CancelSheet } from "@/components/agenda/cancel-sheet";
import { DayVisitSheet, type DayVisitData } from "@/components/agenda/day-visit";
import { checkCancel } from "@/lib/appointment-status";

const BTN = "min-h-9 flex-1 rounded-[10px] border border-line-strong bg-paper px-2 text-sm font-medium hover:border-ink disabled:opacity-60 pointer-coarse:min-h-11";
/**
 * No cartão "Próximo passo" da conversa (item 6, 17/10): ver a visita do dia inteira, cancelar o horário com o motivo (a mesma porta da
 * Agenda: o lembrete pendente cai na hora de enviar) e, depois de cancelar, "Lembrar de remarcar" daqui a 15, 30 ou 60 dias, que abre o
 * Retomar já com a data e a mensagem de retomada (com "Escrever com IA", se ligada). Nada sai sem o Programar.
 */
export function VisitActions({ appointmentId, onCancelled }: { appointmentId: string; /** Depois de cancelar: pergunta "Lembrar de remarcar?". */ onCancelled: () => void }) {
  const [visitOpen, setVisitOpen] = useState(false);
  const [openedAt] = useState(() => Date.now());
  const [cancelData, setCancelData] = useState<DayVisitData | null>(null);
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();

  const askCancel = () => start(async () => {
    const r = await dayVisitAction(appointmentId);
    if (!r.ok) { toast(r.error, "error"); return; }
    if (!r.data!.canMark) { toast("Seu perfil não cancela horário. Peça para a recepção ou a gestão.", "error"); return; }
    if (!r.data!.visit?.services.some((s) => checkCancel(s.status).ok)) { toast("Esse horário não pode mais ser cancelado.", "error"); return; }
    setCancelData(r.data!);
  });
  const v = cancelData?.visit;
  const first = v?.services.find((s) => s.appointmentId === appointmentId && checkCancel(s.status).ok) ?? v?.services.find((s) => checkCancel(s.status).ok);

  return (
    <>
      <div className="flex gap-2">
        <button type="button" className={BTN} onClick={() => setVisitOpen(true)}>Ver a visita</button>
        <button type="button" className={BTN} disabled={pending} onClick={askCancel}>Cancelar horário</button>
      </div>
      {visitOpen && <DayVisitSheet appointmentId={appointmentId} open={visitOpen} onClose={() => setVisitOpen(false)} nowMs={openedAt} hideConversation />}
      {v && first && (
        <CancelSheet open onClose={() => setCancelData(null)} agendaMode={cancelData!.agendaMode} visitCount={v.services.length}
          item={{ appointmentId: first.appointmentId, name: v.name, scheduledAt: first.start, service: first.service, dealId: null }}
          onDone={(r) => {
            setCancelData(null);
            toast(r.cancelled > 1 ? `${r.cancelled} horários cancelados` : "Horário cancelado");
            onCancelled();
            router.refresh();
          }} />
      )}
    </>
  );
}
