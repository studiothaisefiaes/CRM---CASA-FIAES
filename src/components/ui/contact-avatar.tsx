"use client";
import { useState } from "react";
import { initials } from "@/lib/format";
import { cn } from "@/lib/cn";

/** Foto de perfil do WhatsApp; sem foto (ou se falhar) mostra as iniciais. */
export function ContactAvatar({ contactId, hasAvatar, name, size = 32, className }: { contactId: string; hasAvatar: boolean; name: string; size?: number; className?: string }) {
  const [failed, setFailed] = useState(false);
  const style = { width: size, height: size, fontSize: Math.round(size * 0.36) };
  if (hasAvatar && !failed) {
    return <img src={`/api/avatar/${contactId}`} alt="" width={size} height={size} loading="lazy" onError={() => setFailed(true)} style={style} className={cn("shrink-0 rounded-full object-cover bg-paper-3", className)} />;
  }
  return <span aria-hidden style={style} className={cn("shrink-0 rounded-full bg-gold-soft text-gold-ink font-semibold grid place-items-center", className)}>{initials(name)}</span>;
}
