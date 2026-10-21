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

/** Com versão nova, de quanto em quanto tempo confere se dá para recarregar sozinha. */
export const AUTO_RELOAD_CHECK_MS = 5_000;
/** Sem tecla nem toque há esse tempo (ninguém mexendo agora). */
export const AUTO_RELOAD_IDLE_MS = 10_000;

/**
 * Dá para recarregar sem atrapalhar? Não com um campo de texto preenchido em foco (digitando) nem com janela aberta (marcar horário,
 * encaminhar…). O rascunho da caixa de mensagem já fica guardado no navegador, mas o de outras janelas não.
 */
function safeToReload(): boolean {
  if (document.querySelector('[role="dialog"], [aria-modal="true"], dialog[open]')) return false;
  const el = document.activeElement as HTMLElement | null;
  if (!el) return true;
  if (el.isContentEditable && (el.textContent ?? "").trim()) return false;
  if ((el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && !["checkbox", "radio", "button", "submit"].includes(el.type))) && el.value.trim()) return false;
  return true;
}

export function useNewVersion(): boolean {
  return useSyncExternalStore(onNewVersion, newVersionKnown, () => false);
}

/**
 * Versão nova do CRM (20/10, Cati: "atualização derruba a tela"). Pergunta a versão do servidor a cada minuto e ao voltar para a janela;
 * quando muda (ou quando uma ação falha por versão), mostra um aviso pequeno e fixo, "Versão nova do CRM. Atualizar". Recarrega quando a
 * pessoa toca ou sozinha quando é seguro (ver `safeToReload`): nada recarrega enquanto ela digita ou tem uma janela aberta. O texto da caixa de mensagem já fica guardado no navegador
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
  // 21/10 (dono: "as mensagens tão demorando"): com versão nova o tempo real para de atualizar a tela (o refresh da versão antiga recarregaria
  // a página no meio do que a pessoa faz). Então recarrega sozinha assim que for seguro: ninguém digitando, nenhuma janela aberta, 10 s sem mexer.
  useEffect(() => {
    if (!stale) return;
    let lastInput = Date.now();
    const mark = () => { lastInput = Date.now(); };
    const id = setInterval(() => { if (Date.now() - lastInput >= AUTO_RELOAD_IDLE_MS && safeToReload()) { clearInterval(id); onReload(); } }, AUTO_RELOAD_CHECK_MS);
    window.addEventListener("keydown", mark, true);
    window.addEventListener("pointerdown", mark, true);
    return () => { clearInterval(id); window.removeEventListener("keydown", mark, true); window.removeEventListener("pointerdown", mark, true); };
  }, [stale, onReload]);
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
