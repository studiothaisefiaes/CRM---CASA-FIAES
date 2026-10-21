"use client";
import { useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useHours } from "@/components/pipeline/timer";
import { isOpen } from "@/lib/business-hours";
import { shiftDay, todayBahia } from "@/lib/agenda";
import { slotMs } from "@/lib/schedule";
import { fillFirstName } from "@/lib/retomada";

export const REMARCAR_PRAZOS = [15, 30, 60] as const;
export const REMARCAR_MOTIVO = "Remarcar o horário que ela cancelou";
export const REMARCAR_TEXTO = "Oi, {primeiro_nome}! Tudo bem? Passando para saber se você quer remarcar seu horário na Casa Fiaes. Posso ver um dia bom para você?";

/** Daqui a `days` dias, às 10:00 de Salvador; dia em que a Casa não abre passa para o próximo aberto. */
export function remarcarAt(nowMs: number, days: number, open: (ms: number) => boolean): number {
  let day = shiftDay(todayBahia(new Date(nowMs)), days);
  for (let i = 0; i < 7 && !open(slotMs(day, "10:00")); i++) day = shiftDay(day, 1);
  return slotMs(day, "10:00");
}

/**
 * Depois de cancelar pela conversa (item 6, 17/10: a cliente pediu para cancelar, sem data para voltar): "Lembrar de remarcar" daqui a
 * 15, 30 ou 60 dias abre o Retomar com a data, o motivo e a mensagem de retomada (editável, com "Escrever com IA"). Nada sai sozinho
 * sem o Programar.
 */
export function RemarcarDialog({ open, onClose, name, onPick }: {
  open: boolean; onClose: () => void; name: string | null; onPick: (o: { text: string; motivo: string; at: number }) => void;
}) {
  const hours = useHours();
  const [openedAt] = useState(() => Date.now());
  const pick = (days: number) => onPick({ motivo: REMARCAR_MOTIVO, text: fillFirstName(REMARCAR_TEXTO, name), at: remarcarAt(openedAt, days, (ms) => isOpen(ms, hours)) });
  return (
    <Dialog open={open} onClose={onClose} title="Lembrar de remarcar?"
      description="Programa uma mensagem de retomada para ela. Você confere o texto e a data antes."
      footer={<Button variant="ghost" onClick={onClose}>Agora não</Button>}>
      <div className="flex gap-2" data-testid="lembrar-remarcar">
        {REMARCAR_PRAZOS.map((d) => <Button key={d} variant="secondary" className="flex-1" onClick={() => pick(d)}>Daqui a {d} dias</Button>)}
      </div>
    </Dialog>
  );
}
