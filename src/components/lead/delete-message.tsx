"use client";
import { useCallback, useState, useTransition } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { stripSignature } from "@/lib/signature";
import { deleteForEveryoneAction, hideMessageAction } from "@/app/(app)/conversa/actions";
import type { Msg } from "./conversation";

/**
 * "Apagar para todos" (17/10): pede a confirmação, apaga no WhatsApp da cliente e atualiza a conversa. Se o WhatsApp recusar
 * (mensagem antiga demais), o motivo aparece no aviso e nada muda.
 */
export function useDeleteForEveryone(onDone: () => void) {
  const [target, setTarget] = useState<Msg | null>(null);
  const [pending, start] = useTransition();
  const toast = useToast();
  const onDelete = useCallback((m: Msg) => setTarget(m), []);
  const confirm = () => target && start(async () => {
    const r = await deleteForEveryoneAction(target.id);
    if (!r.ok) { toast(r.error, "error"); return; }
    setTarget(null);
    toast("Mensagem apagada para todos");
    onDone();
  });
  // "Apagar só aqui": a mensagem some da conversa no CRM (qualquer uma, da cliente ou da Casa) e o WhatsApp não muda.
  const [hideTarget, setHideTarget] = useState<Msg | null>(null);
  const onHide = useCallback((m: Msg) => setHideTarget(m), []);
  const confirmHide = () => hideTarget && start(async () => {
    const r = await hideMessageAction(hideTarget.id);
    if (!r.ok) { toast(r.error, "error"); return; }
    setHideTarget(null);
    toast("Mensagem apagada daqui");
    onDone();
  });
  const hidePreview = hideTarget ? (stripSignature(hideTarget.body).trim() || "Mensagem sem texto").slice(0, 160) : "";
  const preview = target ? (stripSignature(target.body).trim() || "Mensagem sem texto").slice(0, 160) : "";
  const dialog = (
    <Dialog open={!!target} onClose={() => !pending && setTarget(null)} title="Apagar para todos?"
      description="A mensagem some do WhatsApp da cliente. Na conversa fica marcada como apagada. Não dá para desfazer."
      footer={<>
        <Button variant="ghost" onClick={() => setTarget(null)} disabled={pending}>Voltar</Button>
        <Button variant="danger" loading={pending} onClick={confirm}>Apagar para todos</Button>
      </>}>
      {preview && <p className="rounded-[var(--radius-control)] bg-paper-2 px-3 py-2 text-sm text-graphite whitespace-pre-wrap break-words">{preview}</p>}
    </Dialog>
  );
  const hideDialog = (
    <Dialog open={!!hideTarget} onClose={() => !pending && setHideTarget(null)} title="Apagar só aqui?"
      description="A mensagem some desta conversa no CRM. No WhatsApp da cliente nada muda. Fica registrado quem apagou."
      footer={<>
        <Button variant="ghost" onClick={() => setHideTarget(null)} disabled={pending}>Voltar</Button>
        <Button variant="danger" loading={pending} onClick={confirmHide}>Apagar só aqui</Button>
      </>}>
      {hidePreview && <p className="rounded-[var(--radius-control)] bg-paper-2 px-3 py-2 text-sm text-graphite whitespace-pre-wrap break-words">{hidePreview}</p>}
    </Dialog>
  );
  return { onDelete, onHide, dialog: <>{dialog}{hideDialog}</> };
}
