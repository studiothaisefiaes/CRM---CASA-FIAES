"use client";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { dueLabel } from "@/lib/next-action";

export type KeepAction = "resolver" | "perdido";

/** O título da pergunta: "Manter a mensagem de amanhã 10:00?" (uma) ou "Manter as 2 mensagens programadas?" (várias). */
export function keepScheduledTitle(items: { at: string | Date }[], nowMs: number): string {
  if (items.length === 1) return `Manter a mensagem de ${dueLabel(new Date(items[0].at).getTime(), nowMs)}?`;
  return `Manter as ${items.length} mensagens programadas?`;
}

/**
 * Resolver ou marcar Perdido com mensagem programada pendente (P5, 17/10): a mensagem sairia mesmo com a conversa encerrada
 * ("ficou alguma dúvida?" para quem já resolveu). Manter segue com a mensagem; Cancelar cancela a programada e segue. Fechar desiste de tudo.
 */
export function KeepScheduledDialog({ open, action, items, nowMs, pending, onKeep, onCancelMessage, onClose }: {
  open: boolean; action: KeepAction; items: { at: string | Date }[]; nowMs: number; pending: boolean;
  onKeep: () => void; onCancelMessage: () => void; onClose: () => void;
}) {
  const first = items.length ? dueLabel(Math.min(...items.map((i) => new Date(i.at).getTime())), nowMs) : "";
  const what = action === "resolver" ? "A conversa vai ser resolvida" : "A conversa vai para Perdido";
  const msg = items.length === 1 ? "a mensagem programada ainda vai sair para a cliente." : `as mensagens programadas ainda vão sair para a cliente. A primeira sai ${first}.`;
  return (
    <Dialog open={open} onClose={onClose} title={keepScheduledTitle(items, nowMs)} width={440}
      description={`${what}, mas ${msg}`}
      footer={
        <>
          <Button variant="secondary" disabled={pending} onClick={onCancelMessage}>Cancelar</Button>
          <Button loading={pending} onClick={onKeep}>Manter</Button>
        </>
      } />
  );
}
