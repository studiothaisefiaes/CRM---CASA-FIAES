"use client";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";

/** Confirmação de "Retomar avisos agora": a mesma no banner global e em Configurações › WhatsApp. */
export function ResumeAlertsDialog({ open, onClose, onConfirm, pending }: { open: boolean; onClose: () => void; onConfirm: () => void; pending: boolean }) {
  return (
    <Dialog open={open} onClose={onClose} title="Retomar avisos agora?"
      description="Os avisos voltam para todas as conversas desse número, inclusive as antigas. Retomar agora?"
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button loading={pending} onClick={onConfirm}>Retomar agora</Button>
      </>} />
  );
}
