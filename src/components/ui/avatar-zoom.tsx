"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { ContactAvatar } from "@/components/ui/contact-avatar";
import { IconClose } from "@/components/icons";
import { isTop, popModal, pushModal } from "@/components/ui/modal-stack";
import { SPRING_UI } from "@/lib/motion";
import { cn } from "@/lib/cn";
import { avatarUrl } from "@/lib/avatar-url";

/**
 * A foto do WhatsApp da cliente em tamanho grande, que amplia ao tocar (painel da conversa e ficha, 17/10).
 * Sem foto: as iniciais, sem botão. A foto ampliada fecha com Esc, tocando fora dela ou no botão Fechar.
 */
export function AvatarZoom({ contactId, hasAvatar, name, size = 32, version, className }: {
  contactId: string; hasAvatar: boolean; name: string; size?: number; version?: string | null; className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const avatar = <ContactAvatar contactId={contactId} hasAvatar={hasAvatar} name={name} size={size} version={version} className={className} />;
  if (!hasAvatar || failed) return avatar;
  // Ampliada: o original (a miniatura de 128 px ficaria borrada).
  const src = avatarUrl(contactId, version, true);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label={`Ver a foto de ${name}`}
        className={cn("shrink-0 rounded-full cursor-zoom-in transition-transform duration-150 hover:scale-[1.03] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold", className)}>
        {avatar}
      </button>
      <PhotoLightbox open={open} onClose={() => setOpen(false)} src={src} name={name} onError={() => { setOpen(false); setFailed(true); }} />
    </>
  );
}

function PhotoLightbox({ open, onClose, src, name, onError }: { open: boolean; onClose: () => void; src: string; name: string; onError: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const id = pushModal();
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (!isTop(id)) return;
      if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); onCloseRef.current(); }
      if (e.key === "Tab") { e.preventDefault(); closeRef.current?.focus(); } // um único controle: o foco fica nele
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); popModal(id); prev?.focus?.(); };
  }, [open]);
  if (typeof document === "undefined") return null;
  return createPortal(
    <AnimatePresence>
      {open && (
        <div role="dialog" aria-modal="true" aria-label={`Foto de ${name}`} className="fixed inset-0 z-[80] grid place-items-center p-4">
          <motion.div data-testid="foto-fundo" className="absolute inset-0 bg-ink/80 cursor-zoom-out" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.img src={src} alt={`Foto de ${name}`} onError={onError}
            initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }} transition={SPRING_UI}
            className="relative max-h-[min(80dvh,640px)] max-w-[min(92vw,640px)] rounded-[var(--radius-panel)] object-contain bg-paper-3 shadow-[var(--shadow-pop)]" />
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Fechar a foto"
            className="absolute right-3 top-[max(0.75rem,env(safe-area-inset-top))] size-11 grid place-items-center rounded-full bg-paper/90 text-ink hover:bg-paper">
            <IconClose size={18} aria-hidden />
          </button>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
