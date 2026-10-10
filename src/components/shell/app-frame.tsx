"use client";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { isConversationPath } from "@/lib/lead-href";
import { cn } from "@/lib/cn";

/**
 * A moldura do conteúdo. Na conversa em tela cheia do celular não há barra inferior (o `Sidebar` a esconde) nem faixas no topo:
 * sem a folga de 5 rem embaixo, a conversa ocupa a tela toda e o composer encosta no fundo.
 */
export function AppFrame({ banners, children }: { banners: ReactNode; children: ReactNode }) {
  const conversation = isConversationPath(usePathname());
  return (
    <div className={cn("lg:pl-[232px] min-h-dvh lg:pb-0", !conversation && "pb-20")}>
      <div className={conversation ? "max-lg:hidden" : undefined}>{banners}</div>
      {children}
    </div>
  );
}
