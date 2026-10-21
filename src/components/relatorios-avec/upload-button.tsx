"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { IconCheck, IconUpload } from "@/components/icons";
import { cn } from "@/lib/cn";
import { checkUpload, funnelLine, summaryLines, type AvecUploadResult } from "./format";

const kb = (b: number) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`);

/**
 * "Enviar relatórios do Avec": escolhe (ou arrasta) vários .xlsx, envia de uma vez e mostra o que entrou no CRM.
 * O servidor saneia, guarda e aplica cada arquivo; enviar de novo o mesmo arquivo não duplica nada.
 */
export function AvecUploadButton({ label = "Enviar relatórios do Avec" }: { label?: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<AvecUploadResult | null>(null);

  const pick = (list: FileList | null) => { const f = list ? [...list] : []; setFiles(f); setErr(f.length ? checkUpload(f) : null); };
  const close = () => { if (busy) return; setOpen(false); if (result) router.refresh(); };
  const send = async () => {
    const invalid = checkUpload(files);
    if (invalid) return setErr(invalid);
    setBusy(true); setErr(null);
    try {
      const fd = new FormData();
      for (const f of files) fd.append("files", f);
      const res = await fetch("/api/relatorios/avec", { method: "POST", body: fd });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body) setErr(body?.error ?? "Não deu para enviar. Tente de novo.");
      else setResult(body as AvecUploadResult);
    } catch { setErr("Sem conexão com o servidor. Tente de novo."); }
    finally { setBusy(false); }
  };

  const lines = result ? summaryLines(result.summary) : [];
  const failed = result?.files.filter((f) => f.error) ?? [];
  return (
    <>
      <Button size="sm" className="h-9" onClick={() => { setFiles([]); setErr(null); setResult(null); setOpen(true); }}><IconUpload size={15} />{label}</Button>
      <Dialog open={open} onClose={close} width={560} title={result ? "Relatórios enviados" : "Enviar relatórios do Avec"}
        description={result ? undefined : "No Avec, exporte cada relatório em Excel (.xlsx) e escolha aqui, vários de uma vez. CPF, RG, endereço e dados de banco saem antes de guardar. Nada é enviado no WhatsApp. Mandar o mesmo arquivo de novo não duplica nada."}
        footer={result ? <Button onClick={close}>Concluir</Button>
          : <><Button variant="secondary" onClick={close} disabled={busy}>Cancelar</Button><Button onClick={send} loading={busy} disabled={!files.length || !!checkUpload(files)}>{busy ? "Enviando…" : files.length > 1 ? `Enviar ${files.length} arquivos` : "Enviar"}</Button></>}>
        {!result ? (
          <div>
            <button type="button" disabled={busy} onClick={() => input.current?.click()}
              onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (!busy) pick(e.dataTransfer.files); }}
              className="w-full rounded-[var(--radius-card)] border-2 border-dashed border-line-strong hover:border-gold hover:bg-gold-soft/30 transition-colors px-4 py-7 text-center disabled:opacity-60">
              <IconUpload className="mx-auto text-gold" size={22} />
              <p className="mt-2 text-base font-medium">{files.length ? `${files.length} ${files.length === 1 ? "arquivo escolhido" : "arquivos escolhidos"}` : "Escolher arquivos .xlsx"}</p>
              <p className="text-xs text-muted mt-1">{files.length ? "toque para trocar" : "ou arraste aqui"}</p>
            </button>
            <input ref={input} type="file" multiple hidden accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => { pick(e.target.files); e.target.value = ""; }} />
            {files.length > 0 && (
              <ul className="mt-3 max-h-48 overflow-y-auto scroll-thin divide-y divide-line rounded-[var(--radius-control)] border border-line text-sm">
                {files.map((f, i) => <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-3 px-3 py-2"><span className="min-w-0 truncate">{f.name}</span><span className="shrink-0 text-muted tabular">{kb(f.size)}</span></li>)}
              </ul>
            )}
            {busy && <p className="mt-3 text-sm text-graphite" role="status">Lendo e guardando os relatórios. Pode levar alguns minutos com muitos arquivos; não feche esta janela.</p>}
            {err && <p className="text-sm text-alert mt-3" role="alert">{err}</p>}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {lines.length ? (
              <div>
                <p className="text-sm font-medium text-graphite mb-2">O que entrou no CRM</p>
                <ul className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {lines.map((l) => (
                    <li key={l.key} className="rounded-[var(--radius-control)] bg-ok-soft px-3 py-2.5">
                      <p className="font-display text-xl leading-none text-ok tabular">{l.n.toLocaleString("pt-BR")}</p>
                      <p className="text-xs text-ok mt-1">{l.label}</p>
                    </li>
                  ))}
                </ul>
              </div>
            ) : <p className="rounded-[var(--radius-control)] bg-paper-2 px-3 py-2.5 text-sm text-graphite">Nada novo: o que veio nesses relatórios já estava no CRM.</p>}
            {funnelLine(result.funil) && <p className="rounded-[var(--radius-control)] bg-gold-soft px-3 py-2.5 text-sm text-gold-ink">{funnelLine(result.funil)}</p>}
            <div>
              <p className="text-sm font-medium text-graphite mb-2">Arquivos ({result.files.length}){failed.length > 0 && <span className="text-alert"> · {failed.length} com problema</span>}</p>
              <ul className="max-h-60 overflow-y-auto scroll-thin divide-y divide-line rounded-[var(--radius-control)] border border-line text-sm">
                {result.files.map((f, i) => (
                  <li key={`${f.fileName}-${i}`} className="px-3 py-2">
                    <div className="flex items-start justify-between gap-3">
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{f.title || f.fileName}</span>
                        {f.title && <span className="block truncate text-xs text-muted">{f.fileName}</span>}
                      </span>
                      <span className={cn("shrink-0 inline-flex items-center gap-1 text-xs", f.error ? "text-alert" : f.newReport ? "text-ok" : "text-muted")}>
                        {f.error ? "Não entrou" : f.newReport ? <><IconCheck size={13} />{f.rowCount.toLocaleString("pt-BR")} {f.rowCount === 1 ? "linha" : "linhas"}</> : "Já estava guardado"}
                      </span>
                    </div>
                    {f.error && <p className="mt-1 text-xs text-alert">{f.error}</p>}
                    {!f.error && f.removedColumns.length > 0 && <p className="mt-1 text-xs text-muted">Não guardado (dado pessoal): {f.removedColumns.join(", ")}</p>}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </Dialog>
    </>
  );
}
