"use client";
import { usePathname } from "next/navigation";
import type { QueueItem } from "@/server/queries/queue";
import { PaneHeader } from "./pane-header";
import { ConversationSkeletonShell } from "./conversation-pane";
import { knownItem } from "./open-lead";
import { NO_ACTIONS } from "./use-lead-actions";
import { formatPhoneClient } from "@/lib/phone-client";

/** O que a tela mostra enquanto a conversa carrega: o item que a lista já tinha (cabeçalho, espera e última mensagem), sem tela em branco. */
export function ConversationOpeningView({ item }: { item: QueueItem | null }) {
  const name = item ? (item.name === item.phone ? formatPhoneClient(item.phone) : item.name) : "";
  return (
    <div className="min-h-0 h-full flex flex-col bg-paper" aria-busy="true">
      <header className="shrink-0 border-b border-line">
        <PaneHeader item={item} d={null} name={name} answered={false} back="below-lg" tab="conversa" onTab={() => {}} actions={NO_ACTIONS} viewer={null} onClose={() => {}} />
      </header>
      <ConversationSkeletonShell item={item} />
    </div>
  );
}

/** Versão de `loading.tsx`: descobre o lead pela rota (/atendimento/ID). */
export function ConversationOpening() {
  const id = usePathname().split("/")[2] ?? null;
  return <ConversationOpeningView item={knownItem(id)} />;
}
