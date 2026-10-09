"use client";
import { useRef, useState, useTransition } from "react";
import { importClientsAction } from "./actions";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { IconUpload } from "@/components/icons";
import type { ImportReport } from "@/server/domain/import";

export function ImportButton() {
  const [open, setOpen] = useState(false); const [pending, start] = useTransition();
  const [report, setReport] = useState<ImportReport | null>(null); const [err, setErr] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null); const input = useRef<HTMLInputElement>(null);
  const reset = () => { setReport(null); setErr(null); setFile(null); };
  const run = () => start(async () => {
    if (!file) return setErr("Escolha um arquivo .csv.");
    const fd = new FormData(); fd.set("file", file);
    const r = await importClientsAction(fd);
    if (r.ok) setReport(r.report); else setErr(r.error);
  });
  return (
    <>
      <Button size="sm" className="h-9" onClick={() => { reset(); setOpen(true); }}><IconUpload size={15} />Importar clientes</Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Importar histórico de clientes" width={480}
        description="Planilha em CSV com uma coluna de telefone. Também lê nome, e-mail, data de nascimento, último atendimento e cliente desde. Pode importar de novo: quem já existe só é atualizado."
        footer={report ? <Button onClick={() => setOpen(false)}>Concluir</Button> : <><Button variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button><Button onClick={run} loading={pending} disabled={!file}>Importar</Button></>}>
        {!report ? (
          <div>
            <button type="button" onClick={() => input.current?.click()} className="w-full rounded-[14px] border-2 border-dashed border-line-strong hover:border-gold hover:bg-gold-soft/30 transition-colors px-4 py-8 text-center"
              onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) { setFile(f); setErr(null); } }}>
              <IconUpload className="mx-auto text-gold" size={22} />
              <p className="mt-2 text-[14px] font-medium">{file ? file.name : "Escolher arquivo .csv"}</p>
              <p className="text-[12px] text-muted mt-1">{file ? `${(file.size / 1024).toFixed(0)} KB` : "ou arraste aqui"}</p>
            </button>
            <input ref={input} type="file" accept=".csv,text/csv" hidden onChange={(e) => { setFile(e.target.files?.[0] ?? null); setErr(null); }} />
            {err && <p className="text-[13px] text-alert mt-3" role="alert">{err}</p>}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-[12px] bg-ok-soft p-3"><p className="font-serif text-[30px] leading-none text-ok">{report.imported}</p><p className="text-[12px] text-ok mt-1">novos</p></div>
            <div className="rounded-[12px] bg-paper-2 p-3"><p className="font-serif text-[30px] leading-none">{report.updated}</p><p className="text-[12px] text-graphite mt-1">atualizados</p></div>
            <div className="rounded-[12px] bg-alert-soft p-3"><p className="font-serif text-[30px] leading-none text-alert">{report.invalid.length}</p><p className="text-[12px] text-alert mt-1">telefone inválido</p></div>
            {report.invalid.length > 0 && <p className="col-span-3 text-left text-[12.5px] text-graphite mt-2">Linhas ignoradas: {report.invalid.slice(0, 12).map((i) => `${i.line} (${i.value || "vazio"})`).join(", ")}{report.invalid.length > 12 ? "…" : ""}</p>}
          </div>
        )}
      </Dialog>
    </>
  );
}
