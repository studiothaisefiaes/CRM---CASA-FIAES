"use client";
import { useEffect, useSyncExternalStore } from "react";
import { cn } from "@/lib/cn";
import { IconVolume } from "@/components/icons";
import { audioState, installAudioUnlock, isMuted, subscribeAudio, unlockAudio } from "./sound";

/**
 * O navegador só toca som depois de um toque na página. Enquanto o som estiver bloqueado e houver alertas,
 * mostra ao lado do sino um convite de uma linha; qualquer toque na página (inclusive nele) libera o som.
 */
/** `short`: só o ícone, com o nome acessível "Ativar som" (cabeçalho do celular, onde divide espaço com a marca e a etiqueta Demonstração). */
export function SoundUnlockHint({ show, className = "", short = false }: { show: boolean; className?: string; short?: boolean }) {
  useEffect(() => { installAudioUnlock(); }, []);
  const state = useSyncExternalStore(subscribeAudio, audioState, () => "running" as const);
  if (!show || state !== "locked" || isMuted()) return null;
  if (short) {
    return (
      <button type="button" onClick={unlockAudio} aria-label="Ativar som" title="Ativar o som dos alertas"
        className={cn("size-11 grid place-items-center rounded-[var(--radius-control)] text-gold-ink hover:bg-paper-3", className)}>
        <IconVolume size={19} />
      </button>
    );
  }
  return (
    <button type="button" onClick={unlockAudio}
      className={cn("inline-flex items-center min-h-11 lg:min-h-8 px-2 rounded-[var(--radius-control)] text-sm lg:text-xs text-gold-ink whitespace-nowrap hover:bg-paper-3 underline-offset-2 hover:underline", className)}>
      <span className="min-[375px]:hidden">Ativar som</span>
      <span className="hidden min-[375px]:inline">Ativar o som dos alertas</span>
    </button>
  );
}
