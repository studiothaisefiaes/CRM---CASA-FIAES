"use client";
import { useMemo } from "react";
import { useToast } from "@/components/ui/toast";
import { addNoteAction, markCallAction } from "@/app/(app)/conversa/actions";
import type { CallActions } from "./conversation";

/** "Anotar o que foi falado" na ligação (nota interna ligada a ela) e o atalho "Marcar horário" (a folha de agendar da conversa). */
export function useCallActions(dealId: string | null | undefined, reload: () => unknown, onBook?: () => void): CallActions | undefined {
  const toast = useToast();
  return useMemo(() => (dealId ? {
    onNote: async (messageId, note) => {
      const r = await addNoteAction({ dealId, body: note.body, subject: note.subject || null, messageId, mentions: [] });
      if (!r.ok) { toast(r.error, "error"); return false; }
      toast("Anotação da ligação salva", "ok");
      void reload();
      return true;
    },
    onBook,
    // Ligação recebida sem resultado: "Foi atendida" / "Foi perdida", com Desfazer (volta ao que era, e a espera junto).
    onMark: async (messageId, status) => {
      const r = await markCallAction({ messageId, status });
      if (!r.ok) { toast(r.error, "error"); return false; }
      void reload();
      const previous = r.data!.previous;
      const text = status === "atendida" ? "Ligação marcada como atendida" : status === "perdida" ? "Ligação marcada como perdida" : "Ligação sem resultado de novo";
      toast(text, "ok", status === "recebida" ? undefined : { label: "Desfazer", onClick: () => { void markCallAction({ messageId, status: previous }).then((u) => { if (!u.ok) toast(u.error, "error"); void reload(); }); } });
      return true;
    },
  } : undefined), [dealId, reload, onBook, toast]);
}
