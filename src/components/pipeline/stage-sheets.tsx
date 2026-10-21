"use client";
import { useEffect, useRef, useState } from "react";
import type { SheetDeal } from "@/server/queries/deal";
import { getDealForSheet, type Viewer } from "@/app/(app)/atendimento/actions";
import { useToast } from "@/components/ui/toast";
import { useLeadActions } from "@/components/queue/use-lead-actions";

/**
 * Soltar um card em Agendado, Fechado ou Perdido abre a mesma folha da Fila (data, venda ou motivo), porque o servidor não move para essas etapas
 * sem os dados (ver `moveDealAction`). Quem monta usa uma `key` nova a cada soltura, então cada abertura começa do zero.
 * Busca só o que as folhas pedem (`getDealForSheet`, sem a conversa); `onReady` avisa que a folha abriu (ou que não deu), e até lá o card mostra "Abrindo…".
 * Cancelar não faz nada: o card nunca saiu da coluna de origem. `onMoved` roda quando a folha confirma (o Quadro põe o card na coluna nova).
 */
export function StageSheets({ dealId, name, toKey, viewer, onMoved, onReady }: { dealId: string; name: string; toKey: string; viewer: Viewer; onMoved: () => void; onReady: () => void }) {
  const toast = useToast();
  const [detail, setDetail] = useState<SheetDeal | null>(null);
  const actions = useLeadActions({ d: detail, name, viewer, reload: async () => onMoved() });
  const opened = useRef(false);

  useEffect(() => {
    let off = false;
    void getDealForSheet(dealId).then((r) => {
      if (off) return;
      if (!r.ok) { toast(r.error, "error"); onReady(); return; }
      setDetail(r.data);
    });
    return () => { off = true; };
  }, [dealId, toast, onReady]);

  const { moveTo } = actions;
  useEffect(() => {
    if (!detail || opened.current) return;
    opened.current = true;
    moveTo(toKey);
    onReady();
  }, [detail, toKey, moveTo, onReady]);

  return <>{actions.sheets}</>;
}
