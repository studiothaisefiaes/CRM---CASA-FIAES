"use client";
import { useState } from "react";
import { useToast } from "@/components/ui/toast";
import { IconDownload } from "@/components/icons";

const BTN = "h-9 pointer-coarse:h-11 px-3 inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-line-strong bg-paper text-sm text-ink hover:bg-paper-2 disabled:opacity-60";

/** "Baixar Excel" (link direto) e "Baixar PDF" (o servidor gera em alguns segundos; o botão avisa enquanto isso). */
export function AvecDownloadButtons({ id }: { id: string }) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const pdf = async () => {
    if (busy) return;
    setBusy(true);
    toast("Gerando o PDF…", "info");
    try {
      const res = await fetch(`/api/relatorios/avec/${id}/pdf`);
      if (!res.ok) { toast((await res.text()) || "Não deu para gerar o PDF. Tente de novo.", "error"); return; }
      const blob = await res.blob();
      const cd = res.headers.get("content-disposition") ?? "";
      const utf = /filename\*=UTF-8''([^;]+)/.exec(cd)?.[1];
      const name = utf ? decodeURIComponent(utf) : /filename="([^"]+)"/.exec(cd)?.[1] ?? "relatorio-avec.pdf";
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement("a"), { href: url, download: name });
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      toast("PDF baixado", "ok");
    } catch { toast("Sem conexão com o servidor. Tente de novo.", "error"); }
    finally { setBusy(false); }
  };
  return (
    <>
      <a href={`/api/relatorios/avec/${id}/excel`} className={BTN}><IconDownload size={15} />Baixar Excel</a>
      <button type="button" onClick={() => void pdf()} disabled={busy} aria-busy={busy || undefined} className={BTN}><IconDownload size={15} />{busy ? "Gerando…" : "Baixar PDF"}</button>
    </>
  );
}
