"use client";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";

/**
 * Aviso explícito antes de ligar qualquer envio automático (automação com mensagem, resposta fora do horário).
 * Cancelar não liga nada. A confirmação é da tela; o servidor registra na auditoria quem ligou.
 */
export function SendConfirmDialog({ open, onClose, onConfirm, pending, what, reach }: { open: boolean; onClose: () => void; onConfirm: () => void; pending?: boolean; what: string; reach?: number | null }) {
  return (
    <Dialog open={open} onClose={onClose} title="Ligar o envio automático?"
      description={<><b className="font-semibold text-ink">Isto vai enviar mensagens reais para clientes.</b> {what}{reach != null && <> <b className="font-semibold text-ink">Agora isto atingiria {reach} {reach === 1 ? "cliente" : "clientes"}.</b></>}</>}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button loading={pending} onClick={onConfirm}>Entendi, ligar</Button>
      </>} />
  );
}
