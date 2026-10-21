"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AgendaItem } from "@/server/queries/agenda";
import { appointmentAgendaStatus, STATUS_LABEL, type AgendaStatus } from "@/lib/agenda";
import type { AppointmentMark } from "@/lib/appointment-status";
import { setAttendanceAction, undoMissedAttendanceAction } from "@/app/(app)/funil/actions";
import { useConfirmNoShow } from "@/components/ui/confirm-no-show";
import { notesAction, setAppointmentStatusAction, undoStatusAction } from "@/app/(app)/agenda/actions";
import { attendanceToast } from "@/components/queue/use-lead-actions";
import { useToast } from "@/components/ui/toast";
import { formatPhoneClient } from "@/lib/phone-client";

/** O nome que a tela mostra: o da ficha; sem nome, o telefone formatado. */
export const shownName = (i: AgendaItem) => (i.phone && i.name === i.phone ? formatPhoneClient(i.phone) : i.name);

const DONE: Record<AppointmentMark, (n: string) => string> = {
  confirmado: (n) => `Horário de ${n} confirmado`, chegou: (n) => `${n} chegou`, em_atendimento: (n) => `${n} em atendimento`,
  compareceu: (n) => `${n}: atendimento finalizado`, faltou: (n) => `${n} faltou`, agendado: (n) => `Pedido de ${n} aceito`,
};

export type AgendaActions = {
  pending: boolean;
  mark: (i: AgendaItem, status: AppointmentMark, after?: () => void) => void;
  undo: (i: AgendaItem, after?: () => void) => void;
  saveNotes: (i: AgendaItem, notes: string, after?: () => void) => void;
  apply: (items: AgendaItem[]) => AgendaItem[];
};

/**
 * As ações do card na Agenda. Lead (sem horário na agenda): o mesmo Compareceu/Faltou da Fila. Horário: a porta única de status do 6B.
 * A tela mostra a situação nova antes do recarregar.
 */
export function useAgendaActions(nowMs: number): AgendaActions {
  const toast = useToast();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [marked, setMarked] = useState<Record<string, { status: AgendaStatus; dbStatus: string | null }>>({});
  const apply = (items: AgendaItem[]) => items.map((i) => (marked[i.key] ? { ...i, ...marked[i.key] } : i));
  const shown = (i: AgendaItem, status: string) => ({ status: appointmentAgendaStatus({ startsAt: i.scheduledAt, status }, new Date(nowMs)), dbStatus: status });

  const confirmNoShow = useConfirmNoShow();
  const doMark = (i: AgendaItem, status: AppointmentMark, after?: () => void) => start(async () => {
    const name = shownName(i);
    if (i.source === "lead" && i.dealId) {
      if (status !== "compareceu" && status !== "faltou") return;
      const r = await setAttendanceAction(i.dealId, status);
      if (!r.ok) { toast(r.error, "error"); return; }
      setMarked((m) => ({ ...m, [i.key]: { status, dbStatus: null } }));
      const dealId = i.dealId;
      const undoLead = status === "faltou" && r.data?.changed ? { label: "Desfazer", onClick: () => start(async () => {
        const u = await undoMissedAttendanceAction(dealId);
        if (!u.ok) { toast(u.error, "error"); return; }
        setMarked((m) => { const n = { ...m }; delete n[i.key]; return n; });
        toast(`Desfeito: a falta de ${name} saiu`);
        router.refresh();
      }) } : undefined;
      toast(attendanceToast(name, status, r.data), r.data?.changed ? "ok" : "info", undoLead);
    } else if (i.appointmentId) {
      const r = await setAppointmentStatusAction(i.appointmentId, status);
      if (!r.ok) { toast(r.error, "error"); return; }
      setMarked((m) => ({ ...m, [i.key]: shown(i, status) }));
      // 17/10: Chegou vale para a visita inteira; o aviso diz quantos outros serviços dela entraram junto.
      const more = r.data?.alsoArrived ?? 0;
      const visit = more ? ` (e mais ${more} ${more === 1 ? "serviço" : "serviços"} da visita)` : "";
      // Faltou tem Desfazer no próprio aviso (QA r58, M-2), pela mesma porta do Desfazer da folha.
      const undoAppt = status === "faltou" && r.data?.changed ? { label: "Desfazer", onClick: () => undo(i) } : undefined;
      toast(r.data?.changed || more ? `${DONE[status](name)}${visit}` : "Já estava registrado", r.data?.changed || more ? "ok" : "info", undoAppt);
    } else return;
    after?.();
    router.refresh();
  });
  /** Faltou pede confirmação em todo lugar (QA r58, M-2). */
  const mark = (i: AgendaItem, status: AppointmentMark, after?: () => void) => (status === "faltou"
    ? confirmNoShow({ who: shownName(i), detail: i.service ?? null, onConfirm: () => doMark(i, status, after) })
    : doMark(i, status, after));

  const undo = (i: AgendaItem, after?: () => void) => start(async () => {
    if (!i.appointmentId) return;
    const r = await undoStatusAction(i.appointmentId);
    if (!r.ok) { toast(r.error, "error"); return; }
    const back = shown(i, r.data!.to);
    setMarked((m) => ({ ...m, [i.key]: back }));
    toast(`Desfeito: ${shownName(i)} voltou para ${STATUS_LABEL[back.status]}`);
    after?.();
    router.refresh();
  });

  const saveNotes = (i: AgendaItem, notes: string, after?: () => void) => start(async () => {
    if (!i.appointmentId) return;
    const r = await notesAction(i.appointmentId, notes);
    if (!r.ok) { toast(r.error, "error"); return; }
    toast(r.data?.changed ? "Observação salva" : "Nada mudou", r.data?.changed ? "ok" : "info");
    after?.();
    router.refresh();
  });

  return { pending, mark, undo, saveNotes, apply };
}
