"use client";
import { useEffect, useRef, useState } from "react";
import { initials } from "@/lib/format";
import { cn } from "@/lib/cn";
import { avatarUrl } from "@/lib/avatar-url";

/**
 * Um observador só para todas as fotos da tela. O `loading="lazy"` do navegador baixa tudo a até 1250–2500 px da tela: na Fila eram
 * dezenas de fotos disputando a banda com a conversa (17/10). Aqui a foto só é pedida a até 200 px de aparecer (também dentro da lista que rola).
 */
const MARGIN = "200px";
let observer: IntersectionObserver | null = null;
const waiting = new Map<Element, () => void>();
function watch(el: Element, onVisible: () => void): () => void {
  if (typeof IntersectionObserver === "undefined") { onVisible(); return () => {}; }
  observer ??= new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const cb = waiting.get(e.target);
      waiting.delete(e.target);
      observer?.unobserve(e.target);
      cb?.();
    }
  }, { rootMargin: MARGIN, scrollMargin: MARGIN } as IntersectionObserverInit);
  waiting.set(el, onVisible);
  observer.observe(el);
  return () => { waiting.delete(el); observer?.unobserve(el); };
}
/** Só testes: esquece o observador (cada teste instala o seu). */
export function __resetAvatarObserver() { observer?.disconnect(); observer = null; waiting.clear(); }

/**
 * Foto de perfil do WhatsApp (a miniatura de 128 px); sem foto (ou se falhar) mostra as iniciais. Com `version` (quando o worker revisou a foto)
 * a URL leva `?v=` e o navegador guarda por 1 ano sem perguntar de novo (a URL muda quando a foto muda).
 */
export function ContactAvatar({ contactId, hasAvatar, name, size = 32, className, version }: { contactId: string; hasAvatar: boolean; name: string; size?: number; className?: string; version?: string | null }) {
  const url = avatarUrl(contactId, version);
  // A falha vale para ESTA foto: o cabeçalho troca de cliente na mesma instância e a próxima tem de tentar a dela.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const [near, setNear] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const wantsPhoto = hasAvatar && failedUrl !== url;
  useEffect(() => {
    if (!wantsPhoto || near || !ref.current) return;
    return watch(ref.current, () => setNear(true));
  }, [wantsPhoto, near]);
  const style = { width: size, height: size, fontSize: Math.max(12, Math.round(size * 0.36)) };
  if (wantsPhoto && near) {
    return <img src={url} alt="" width={size} height={size} decoding="async" onError={() => setFailedUrl(url)} style={style} className={cn("shrink-0 rounded-full object-cover bg-paper-3", className)} />;
  }
  // Foto ainda não pedida: círculo neutro do mesmo tamanho (as iniciais piscariam antes da foto).
  if (wantsPhoto) return <span ref={ref} aria-hidden data-foto-pendente="" style={style} className={cn("inline-block shrink-0 rounded-full bg-paper-3", className)} />;
  return <span aria-hidden style={style} className={cn("shrink-0 rounded-full bg-gold-soft text-gold-ink font-semibold grid place-items-center", className)}>{initials(name)}</span>;
}
