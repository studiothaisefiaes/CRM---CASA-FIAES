"use client";
import { useEffect, useSyncExternalStore } from "react";
import { audioState, installAudioUnlock, isMuted, subscribeAudio, unlockAudio } from "./sound";

/**
 * O navegador só toca som depois de um toque na página. Enquanto o som estiver bloqueado e houver alertas,
 * mostra ao lado do sino um convite de uma linha; qualquer toque na página (inclusive nele) libera o som.
 */
export function SoundUnlockHint({ show, className = "" }: { show: boolean; className?: string }) {
  useEffect(() => { installAudioUnlock(); }, []);
  const state = useSyncExternalStore(subscribeAudio, audioState, () => "running" as const);
  if (!show || state !== "locked" || isMuted()) return null;
  return (
    <button type="button" onClick={unlockAudio}
      className={`inline-flex items-center min-h-11 lg:min-h-8 px-2 rounded-[var(--radius-control)] text-[13px] lg:text-xs text-gold-ink whitespace-nowrap hover:bg-paper-3 underline-offset-2 hover:underline ${className}`}>
      <span className="min-[375px]:hidden">Ativar som</span>
      <span className="hidden min-[375px]:inline">Toque para ativar o som</span>
    </button>
  );
}
