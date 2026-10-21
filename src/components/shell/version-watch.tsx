"use client";
import { useEffect, useSyncExternalStore } from "react";
import { AnimatePresence, motion } from "motion/react";
import { SPRING_UI } from "@/lib/motion";
import { isVersionSkewError, NEW_VERSION_TEXT } from "@/lib/version-skew";
import { announceNewVersion, checkVersion, newVersionKnown, onNewVersion, setLoadedVersion } from "./version-state";

/** De quanto em quanto tempo a tela pergunta a versão do servidor (com a aba à vista). */
export const VERSION_POLL_MS = 60_000;
/** Voltar para a janela pergunta de novo, mas não mais que uma vez nesse intervalo. */
const FOCUS_MIN_GAP_MS = 10_000;

/** Recarrega a mesma página (a mesma conversa: `?lead=` na Fila e no Quadro, /atendimento/ID no celular). */
const reloadPage = () => window.location.reload();

export function useNewVersion(): boolean {
  return useSyncExternalStore(onNewVersion, newVersionKnown, () => false);
}

/**
 * Versão nova do CRM (20/10, Cati: "atualização derruba a tela"). Pergunta a versão do servidor a cada minuto e ao voltar para a janela;
 * quando muda (ou quando uma ação falha por versão), mostra um aviso pequeno e fixo, "Versão nova do CRM. Atualizar", que só recarrega
 * quando a pessoa toca: nada recarrega sozinho enquanto ela digita. O texto da caixa de mensagem já fica guardado no navegador
 * (`rascunho:<dealId>`) e a página recarregada é a mesma (mesma conversa).
 */
export function VersionWatch({ versao, onReload = reloadPage }: { versao: string; onReload?: () => void }) {
  const stale = useNewVersion();
  useEffect(() => { setLoadedVersion(versao); }, [versao]);
  useEffect(() => {
    if (stale) return;
    const ask = (maxAgeMs = 0) => { if (document.visibilityState === "visible") void checkVersion({ maxAgeMs }); };
    const id = setInterval(() => ask(), VERSION_POLL_MS);
    const onBack = () => ask(FOCUS_MIN_GAP_MS);
    document.addEventListener("visibilitychange", onBack);
    window.addEventListener("focus", onBack);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", onBack); window.removeEventListener("focus", onBack); };
  }, [stale]);
  // Ação ou pedaço de tela da versão antiga que ninguém tratou: em vez do erro, o aviso.
  useEffect(() => {
    const onRejection = (e: PromiseRejectionEvent) => { if (isVersionSkewError(e.reason)) { e.preventDefault(); announceNewVersion(); } };
    const onError = (e: ErrorEvent) => { if (isVersionSkewError(e.error)) announceNewVersion(); };
    window.addEventListener("unhandledrejection", onRejection);
    window.addEventListener("error", onError);
    return () => { window.removeEventListener("unhandledrejection", onRejection); window.removeEventListener("error", onError); };
  }, []);
  return (
    <AnimatePresence>
      {stale && (
        <motion.div key="versao" role="status" aria-live="polite" data-testid="versao-nova"
          initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={SPRING_UI}
          className="fixed z-[90] top-[calc(env(safe-area-inset-top)+0.5rem)] left-1/2 -translate-x-1/2 lg:top-auto lg:left-auto lg:translate-x-0 lg:bottom-5 lg:right-5 flex items-center gap-3 rounded-[var(--radius-control)] bg-ink py-1.5 pl-4 pr-1.5 text-sm text-paper shadow-[var(--shadow-pop)] whitespace-nowrap">
          <span className="size-1.5 shrink-0 rounded-full bg-gold" aria-hidden />
          <span>{NEW_VERSION_TEXT.aviso}</span>
          <button type="button" onClick={onReload} className="h-7 pointer-coarse:min-h-11 px-2.5 rounded-[8px] bg-paper/10 hover:bg-paper/20 text-sm font-semibold text-gold">
            {NEW_VERSION_TEXT.botao}
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
