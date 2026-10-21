"use client";
import { Menu } from "@/components/ui/menu";
import { IconDownload } from "@/components/icons";

/** "Exportar conversa" (LGPD): texto ou PDF; com notas internas só se pedir. O servidor registra quem exportou. */
export function ExportConversation({ contactId }: { contactId: string }) {
  // Download de arquivo (não é navegação de página): um link temporário baixa sem sair da ficha.
  const go = (q: string) => { const a = document.createElement("a"); a.href = `/api/contatos/${contactId}/conversa?${q}`; a.rel = "noopener"; document.body.appendChild(a); a.click(); a.remove(); };
  return (
    <Menu label="Exportar conversa"
      trigger={<span className="inline-flex items-center gap-1.5 text-sm font-medium"><IconDownload size={15} />Exportar conversa</span>}
      triggerClassName="h-10 px-3 rounded-[var(--radius-control)] border border-line-strong hover:bg-paper-2"
      items={[
        { label: "Texto (.txt)", onSelect: () => go("formato=txt") },
        { label: "PDF", onSelect: () => go("formato=pdf") },
        { label: "Texto com notas internas", detail: "Só para uso da equipe", onSelect: () => go("formato=txt&notas=1") },
      ]} />
  );
}
