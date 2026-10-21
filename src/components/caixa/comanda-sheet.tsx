"use client";
import { ActionSheet } from "@/components/queue/action-sheet";
import { ComandaBody, useComandaDetail, type ComandaCatalog } from "./comanda-panel";

export type { ComandaCatalog } from "./comanda-panel";

/** A comanda numa folha (Agenda, Hoje e o Caixa no celular): o mesmo corpo do painel do Caixa. Recarrega do servidor a cada ação. */
export function ComandaSheet({ comandaId, open, onClose, catalog }: { comandaId: string | null; open: boolean; onClose: () => void; catalog: ComandaCatalog }) {
  const { d, error, setError, load } = useComandaDetail(comandaId, open);
  return (
    <ActionSheet open={open} onClose={onClose} title={d ? `Comanda ${d.number} · ${d.clientName}` : "Comanda"} footer={null}>
      {!d ? (error ? <p role="alert" className="text-sm text-alert">{error}</p> : <p className="text-sm text-muted">Carregando…</p>)
        : <ComandaBody d={d} catalog={catalog} error={error} setError={setError} reload={load} />}
    </ActionSheet>
  );
}
