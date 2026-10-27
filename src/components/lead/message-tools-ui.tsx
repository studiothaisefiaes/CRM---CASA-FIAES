"use client";
import { useCallback, useMemo, useState, useTransition } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { stripSignature } from "@/lib/signature";
import type { MessageToolsState } from "@/lib/message-tools-state";
import { editMessageAction, reactAction } from "@/app/(app)/conversa/actions";
import { ForwardDialog } from "./forward-dialog";
import type { BubbleTools, Msg } from "./conversation";

/** Reagir e Editar na conversa (Task 12): o que cada balão oferece e o diálogo de edição. O servidor confere tudo de novo. */
export function useMessageTools(state: MessageToolsState | undefined, viewerId: string | undefined, onDone: () => void, dealId?: string) {
  const [target, setTarget] = useState<Msg | null>(null);
  const [text, setText] = useState("");
  // Encaminhar uma (seta do balão) ou várias (modo seleção, 24/10). `done` avisa a conversa se encaminhou (a seleção acaba) ou se voltou.
  const [fwd, setFwd] = useState<{ msgs: Msg[]; done?: (sent: boolean) => void } | null>(null);
  const [pending, start] = useTransition();
  const toast = useToast();
  const react = useCallback((m: Msg, emoji: string) => {
    // Mesmo emoji de novo tira a reação (o servidor faz a troca).
    void reactAction(m.id, emoji).then((r) => { if (!r.ok) toast(r.error, "error"); else onDone(); });
  }, [toast, onDone]);
  const edit = useCallback((m: Msg) => { setTarget(m); setText(stripSignature(m.body).trim()); }, []);
  const windowMs = (state?.editWindowMin ?? 0) * 60_000;
  const tools: BubbleTools | undefined = useMemo(() => {
    if (!state || (!state.reagir && !state.editar && !state.encaminhar)) return undefined;
    return {
      ...(state.reagir ? { react } : {}),
      ...(state.encaminhar ? {
        forward: (m: Msg) => setFwd({ msgs: [m] }),
        forwardMany: (msgs: Msg[], done: (sent: boolean) => void) => setFwd({ msgs, done }),
        maxSelect: state.maxMensagens,
        canForward: (m: Msg) => m.id !== "optimistic" && !m.deleted && !m.importedAt && m.status !== "pending" && m.status !== "failed" && ["text", "image", "video", "audio", "document"].includes(m.kind) && !(m.kind !== "text" && m.purgedAt),
      } : {}),
      ...(state.editar ? {
        edit,
        canEdit: (m: Msg) => m.direction === "out" && m.kind === "text" && m.sentVia === "crm" && ["sent", "delivered", "read"].includes(m.status) && !m.deleted && !!m.externalId && !!viewerId && m.byId === viewerId
          && Date.now() - new Date(m.createdAt).getTime() <= windowMs,
      } : {}),
    };
  }, [state, react, edit, viewerId, windowMs]);
  const save = () => target && start(async () => {
    const r = await editMessageAction(target.id, text);
    if (!r.ok) { toast(r.error, "error"); return; }
    setTarget(null); toast("Mensagem editada", "ok"); onDone();
  });
  const dialog = (
    <Dialog open={!!target} onClose={() => !pending && setTarget(null)} title="Editar mensagem" description={`A cliente vê “editada”. Dá para editar até ${state?.editWindowMin ?? 15} minutos depois de enviar.`}
      footer={<><Button variant="ghost" onClick={() => setTarget(null)} disabled={pending}>Voltar</Button><Button loading={pending} disabled={!text.trim()} onClick={save}>Salvar</Button></>}>
      <Textarea aria-label="Texto da mensagem" value={text} maxLength={4000} onChange={(e) => setText(e.target.value)} />
    </Dialog>
  );
  const forwardDialog = <ForwardDialog key={fwd ? fwd.msgs.map((m) => m.id).join() : "fechado"} messages={fwd?.msgs ?? null} dealId={dealId ?? null} max={state?.maxDestinos ?? 10}
    onClose={(sent) => { fwd?.done?.(sent); setFwd(null); }} />;
  return { tools, dialog: <>{dialog}{forwardDialog}</> };
}
