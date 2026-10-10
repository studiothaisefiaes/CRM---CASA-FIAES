"use client";
import { useTransition } from "react";
import { startConversationAction, unignoreContactAction } from "@/app/(app)/contatos/actions";
import { IconChat } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

/**
 * "Iniciar conversa" (ou "Continuar conversa", quando já há lead aberto): leva ao lead e deixa o cursor no campo de mensagem.
 * Não envia nada. A Server Action redireciona; só volta aqui se der erro.
 */
export function StartConversation({ contactId, hasOpenLead, className }: { contactId: string; hasOpenLead: boolean; className?: string }) {
  const [pending, start] = useTransition();
  const toast = useToast();
  return (
    <Button size="lg" className={`pointer-coarse:min-h-12 ${className ?? ""}`} loading={pending}
      onClick={() => start(async () => { const r = await startConversationAction(contactId); if (r && !r.ok) toast(r.error, "error"); })}>
      {!pending && <IconChat size={17} />}{hasOpenLead ? "Continuar conversa" : "Iniciar conversa"}
    </Button>
  );
}

/** "Voltar a ser cliente": tira a marca de "Não é cliente" (e devolve o lead à fila, se der). */
export function BackToClient({ contactId }: { contactId: string }) {
  const [pending, start] = useTransition();
  const toast = useToast();
  return (
    <Button variant="secondary" size="md" className="pointer-coarse:min-h-11" loading={pending}
      onClick={() => start(async () => {
        const r = await unignoreContactAction(contactId);
        if (!r.ok) { toast(r.error, "error"); return; }
        toast(r.data?.restored ? "Voltou a ser cliente · o lead voltou para a fila" : "Voltou a ser cliente", "ok");
      })}>
      Voltar a ser cliente
    </Button>
  );
}
