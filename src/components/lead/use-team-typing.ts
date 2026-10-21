"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLive } from "@/components/shell/live";
import { TYPING_SHOW_MS, shouldPingTyping, typingNow } from "@/lib/collision";

/**
 * Colisão (pesquisa 20/10): quem mais da equipe está escrevendo nesta conversa, pelo tempo real, e o `ping` de quem digita aqui
 * (no máximo a cada 3 s, só com texto no campo). O texto nunca sai do aparelho.
 * Quando alguém envia (mensagem_enviada), o aviso some na hora.
 */
export function useTeamTyping(dealId: string, me: string | null | undefined) {
  const seen = useRef(new Map<string, { name: string; at: number }>());
  const [names, setNames] = useState<string[]>([]);
  const recompute = useCallback(() => {
    const now = Date.now();
    for (const [id, v] of seen.current) if (now - v.at >= TYPING_SHOW_MS) seen.current.delete(id);
    setNames(typingNow(seen.current, me, now));
  }, [me]);
  // Enquanto alguém aparece escrevendo, confere a cada segundo se o aviso já venceu (sem aviso novo em 7 s, some).
  const showing = names.length > 0;
  useEffect(() => {
    if (!showing) return;
    const id = setInterval(recompute, 1_000);
    return () => clearInterval(id);
  }, [showing, recompute]);
  useLive([`escrevendo:${dealId}`, `deal:${dealId}`], (e) => {
    if (e.type === "mensagem_enviada") { seen.current.clear(); recompute(); return; }
    if (e.type !== "escrevendo" || typeof e.userId !== "string" || !me || e.userId === me) return;
    seen.current.set(e.userId, { name: typeof e.nome === "string" && e.nome.trim() ? e.nome : "Alguém da equipe", at: Date.now() });
    recompute();
  });
  const last = useRef(0);
  const ping = useCallback((text: string) => {
    const now = Date.now();
    if (!shouldPingTyping(text, last.current, now)) return;
    last.current = now;
    try { void fetch(`/api/conversa/${dealId}/escrevendo`, { method: "POST", credentials: "same-origin" }).catch(() => {}); } catch { /* sem rede: só não avisa */ }
  }, [dealId]);
  return { names, ping };
}
