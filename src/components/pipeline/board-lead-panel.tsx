"use client";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ConversationPane } from "@/components/queue/conversation-pane";
import { useCloseLead } from "@/components/queue/open-lead";
import { loadConversation } from "@/components/queue/conversation-cache";
import { paneName } from "@/components/queue/last-message";
import { isTop, popModal, pushModal } from "@/components/ui/modal-stack";
import { useToast } from "@/components/ui/toast";
import { composerHasText } from "@/components/lead/composer-draft";
import { SPRING_SHEET } from "@/lib/motion";

const FOCUSABLE = "a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex='-1'])";
const TEXT_INPUT = /^(text|search|email|tel|url|number|password|)$/;

/** Texto digitado no campo em foco (um campo de texto: caixa de marcar e botão têm `value` sempre preenchido). */
const typing = () => {
  const el = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
  if (!el) return false;
  const textual = el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && TEXT_INPUT.test((el as HTMLInputElement).type ?? ""));
  return textual && !!el.value?.trim();
};

/**
 * A conversa aberta pelo Quadro (/funil?lead=ID): o MESMO painel da Fila (`ConversationPane`: cabeçalho, conversa, Agora/Cliente e Editar dados)
 * numa gaveta à direita, por cima das colunas (Plano 5: o LeadSheet, com os campos antigos, saiu). Fechar, voltar e "Próximo da fila" ficam
 * no Quadro (`useCloseLead`/`useOpenLead` em /funil). `name`: o nome do card, para o leitor de tela; lead fora do Quadro (link antigo) = "Conversa".
 */
export function BoardLeadPanel({ dealId, name }: { dealId: string | null; name: string | null }) {
  return <AnimatePresence>{dealId && <Panel key="painel" dealId={dealId} name={name} />}</AnimatePresence>;
}

function Panel({ dealId, name }: { dealId: string; name: string | null }) {
  const close = useCloseLead();
  // Lead fora das colunas (link antigo, filtro, resolvida): o nome vem com a conversa (a mesma busca do painel, sem pedido a mais).
  const [loaded, setLoaded] = useState<{ id: string; name: string } | null>(null);
  useEffect(() => {
    if (name) return;
    let off = false;
    void loadConversation(dealId).then((r) => { if (!off && r.ok) setLoaded({ id: dealId, name: paneName(r.data, null) }); }, () => {});
    return () => { off = true; };
  }, [dealId, name]);
  const label = name ?? (loaded?.id === dealId ? loaded.name : null);
  const toast = useToast();
  const ref = useRef<HTMLElement | null>(null);
  // Resposta escrita no campo (mesmo sem foco nele: o 1º Esc do campo só tira o foco): fechar desmontaria o campo e o texto se perderia.
  const tryClose = useRef(() => {});
  useEffect(() => {
    tryClose.current = () => {
      if (composerHasText(dealId)) { toast("Há uma resposta escrita. Envie ou apague antes de fechar.", "info"); return; }
      close();
    };
  });
  useEffect(() => {
    const id = pushModal();
    const opener = document.activeElement as HTMLElement | null; // o card que abriu: o foco volta para ele ao fechar
    const t = setTimeout(() => { if (isTop(id) && !ref.current?.contains(document.activeElement)) ref.current?.focus(); }, 30);
    const onKey = (e: KeyboardEvent) => {
      if (!isTop(id)) return; // um diálogo por cima (Agendar, Editar dados) cuida do próprio Esc e Tab
      if (e.key === "Escape" && !e.defaultPrevented && !typing()) { e.preventDefault(); tryClose.current(); }
      if (e.key === "Tab" && ref.current) {
        // Modal de verdade: o Tab não sai para os cards atrás da gaveta.
        const f = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
        if (!f.length) { e.preventDefault(); return; }
        const a = document.activeElement;
        if (!ref.current.contains(a) || a === ref.current) { e.preventDefault(); (e.shiftKey ? f[f.length - 1] : f[0]).focus(); }
        else if (e.shiftKey && a === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && a === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => { clearTimeout(t); document.removeEventListener("keydown", onKey); popModal(id); if (opener?.isConnected) opener.focus(); };
  }, []);
  return (
    <>
      <motion.div data-testid="fundo-painel" aria-hidden className="fixed inset-0 z-40 bg-ink/25 lg:bg-ink/15" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => tryClose.current()} />
      <motion.aside ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={label ? `Conversa com ${label}` : "Conversa"} initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }} transition={SPRING_SHEET}
        className="fixed z-50 inset-y-0 right-0 outline-none w-full lg:w-[min(1180px,calc(100vw-260px))] bg-paper shadow-[-30px_0_60px_-30px_rgb(40_30_15/0.35)] grid grid-cols-1 grid-rows-[minmax(0,1fr)] xl:grid-cols-[minmax(0,1fr)_300px]">
        <ConversationPane key={dealId} dealId={dealId} initial={null} back="below-lg" />
      </motion.aside>
    </>
  );
}
