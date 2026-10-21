"use client";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { isConversationPath } from "@/lib/lead-href";
import { isFrozenPath } from "@/lib/design-frozen";
import { cn } from "@/lib/cn";
import { useSidebarCollapsed } from "./sidebar-state";

/**
 * A moldura do conteúdo. Em paisagem com notch ela já reserva `safe-area-inset-left/right` (só aqui; as barras fixas abaixo fazem o seu, que não herdam isto). Na conversa em tela cheia do celular não há barra inferior (o `Sidebar` a esconde) nem faixas no topo:
 * sem a folga de 5 rem embaixo, a conversa ocupa a tela toda e o composer encosta no fundo.
 */
export function AppFrame({ banners, children }: { banners: ReactNode; children: ReactNode }) {
  const path = usePathname();
  const conversation = isConversationPath(path);
  const { collapsed } = useSidebarCollapsed();
  return (
    <div className={cn(isFrozenPath(path) && "ds-congelada", "min-h-dvh transition-[padding] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]", collapsed ? "lg:pl-[72px]" : "lg:pl-[232px]", "lg:pb-0 max-lg:pl-[env(safe-area-inset-left)] max-lg:pr-[env(safe-area-inset-right)]", !conversation && "pb-20")}>
      <div className={conversation ? "max-lg:hidden" : undefined}>{banners}</div>
      {children}
    </div>
  );
}
