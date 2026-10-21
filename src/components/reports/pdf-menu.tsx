"use client";
import { useState } from "react";
import { Menu } from "@/components/ui/menu";
import { useToast } from "@/components/ui/toast";
import { IconDownload } from "@/components/icons";

/** "Baixar PDF": o servidor gera (alguns segundos) e o arquivo baixa; enquanto isso o botão avisa. */
export function PdfMenu({ periodo, team }: { periodo: string; team: boolean }) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const baixar = async (tipo: "periodo" | "equipe") => {
    if (busy) return;
    setBusy(true);
    toast("Gerando o PDF…", "info");
    try {
      const res = await fetch(`/api/relatorios/pdf?tipo=${tipo}&periodo=${encodeURIComponent(periodo)}`);
      if (!res.ok) { toast((await res.text()) || "Não deu para gerar o PDF. Tente de novo.", "error"); return; }
      const blob = await res.blob();
      const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "relatorio.pdf";
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement("a"), { href: url, download: name });
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      toast("PDF baixado", "ok");
    } catch { toast("Sem conexão com o servidor. Tente de novo.", "error"); }
    finally { setBusy(false); }
  };
  return (
    <Menu label="Baixar PDF" align="right"
      trigger={<span className="inline-flex items-center gap-1.5 text-sm"><IconDownload size={15} />{busy ? "Gerando…" : "Baixar PDF"}</span>}
      triggerClassName="h-9 pointer-coarse:h-11 px-3 border border-line-strong bg-paper text-ink"
      items={[
        { label: "Relatório do período", detail: "números, etapas, origens, perdas", onSelect: () => void baixar("periodo") },
        ...(team ? [{ label: "Por atendente", detail: "lado a lado, sem ranking", onSelect: () => void baixar("equipe") }] : []),
      ]} />
  );
}
