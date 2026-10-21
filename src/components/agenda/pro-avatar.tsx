"use client";
import { useState } from "react";
import { initials } from "@/lib/format";
import { paletteHex, textOn } from "@/lib/palette";
import { cn } from "@/lib/cn";

/** Foto da profissional (6B.16) ou as iniciais num círculo com a cor dela (6A). */
export function ProAvatar({ name, color, photoUrl, size = 32, className, soft = false }: { name: string; color: string | null; photoUrl: string | null; size?: number; className?: string;
  /** Nova Agenda: iniciais num tom suave da cor dela (a cor forte fica para o status do horário). */ soft?: boolean }) {
  const [failed, setFailed] = useState(false);
  const style = { width: size, height: size, fontSize: Math.max(12, Math.round(size * 0.38)) };
  if (photoUrl && !failed) {
    // Foto servida pela rota com sessão (6B.16): o otimizador do Next não passa o cookie.
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={photoUrl} alt="" width={size} height={size} loading="lazy" onError={() => setFailed(true)} style={style} className={cn("shrink-0 rounded-full bg-paper-3 object-cover", className)} />;
  }
  const hex = paletteHex(color);
  return (
    <span aria-hidden data-avatar="iniciais" style={{ ...style, ...(hex ? (soft ? { background: `color-mix(in srgb, ${hex} 22%, #fdfdfc)`, color: `color-mix(in srgb, ${hex} 70%, #121212)` } : { background: hex, color: textOn(hex) }) : {}) }}
      className={cn("grid shrink-0 place-items-center rounded-full font-semibold", !hex && "bg-paper-3 text-graphite", className)}>{initials(name)}</span>
  );
}
