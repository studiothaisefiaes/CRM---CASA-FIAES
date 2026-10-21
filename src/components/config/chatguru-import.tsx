"use client";
import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { IconUpload } from "@/components/icons";
import { applyChatguruCsvAction, previewChatguruCsvAction } from "@/app/(app)/config/chatguru/actions";
import type { ChatguruImportPreview, ChatguruImportReport } from "@/server/domain/chatguru-csv-import";

const KIND = { chats: "Relatório de Chats", funil: "Funil", anotacoes: "Anotações" } as const;

/** Upload dos CSVs do ChatGuru: prévia primeiro (nada é gravado), depois Importar. Pode repetir: nada duplica. */
export function ChatguruImport() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ChatguruImportPreview | null>(null);
  const [report, setReport] = useState<ChatguruImportReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  const form = () => { const fd = new FormData(); fd.set("file", file!); return fd; };
  const ver = () => file && start(async () => { const r = await previewChatguruCsvAction(form()); if (r.ok) { setPreview(r.data!); setError(null); } else setError(r.error); });
  const importar = () => file && start(async () => { const r = await applyChatguruCsvAction(form()); if (r.ok) { setReport(r.data!); setError(null); } else setError(r.error); });
  const pick = (f: File | undefined) => { if (!f) return; setFile(f); setPreview(null); setReport(null); setError(null); };
  return (
    <div className="grid items-start gap-5 min-[1100px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] min-[1100px]:gap-6">
      <section className="rounded-[var(--radius-card)] border border-line bg-paper p-5 text-sm text-graphite">
        <h2 className="text-ink text-lg font-semibold">Importar do ChatGuru</h2>
        <p className="mt-1">Envie os CSVs que a Casa exporta no ChatGuru, um de cada vez. Pode enviar de novo: nada duplica. Ninguém ganha conversa nova nem recebe mensagem.</p>
        <ul className="mt-3 list-disc pl-5">
          <li><b className="font-semibold text-ink">Relatório de Chats</b> (Relatórios › Chats › Exportar CSV): nome, número, link, data de cadastro e etiquetas.</li>
          <li><b className="font-semibold text-ink">Funil</b> (Funis › Mais opções › Exportar em CSV): a etapa de lá e o responsável ficam na ficha da cliente.</li>
          <li><b className="font-semibold text-ink">Anotações</b> (CSV com número, data, autor e anotação): viram notas internas na conversa.</li>
        </ul>
        <p className="mt-3">CPF, RG, endereço e dados bancários são descartados antes de ler o arquivo.</p>
      </section>
      <div className="flex min-w-0 flex-col gap-5">
      <button type="button" onClick={() => input.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files[0]); }}
        className="w-full rounded-[var(--radius-card)] border-2 border-dashed border-line-strong px-4 py-8 text-center transition-colors hover:border-gold hover:bg-gold-soft/30">
        <IconUpload className="mx-auto text-gold" size={22} />
        <span className="mt-2 block text-sm font-medium">{file ? file.name : "Escolher ou soltar o arquivo .csv"}</span>
      </button>
      <input ref={input} type="file" hidden accept=".csv,text/csv" aria-label="Arquivo CSV do ChatGuru" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
      {!preview && !report && <Button onClick={ver} loading={pending} disabled={!file}>Ver prévia</Button>}
      {preview && !report && (
        <section aria-label="Prévia" className="rounded-[var(--radius-card)] border border-line bg-paper p-5 text-sm">
          <p className="font-display text-lg">{KIND[preview.kind]}: {preview.valid} de {preview.total} linhas com número válido</p>
          <ul className="mt-2 list-disc pl-5 text-graphite">
            <li>{preview.newContacts} contatos novos · {preview.existing} já existiam (só completamos a ficha)</li>
            {preview.tags.length > 0 && <li>Etiquetas: {preview.tags.join(", ")}</li>}
            {preview.notes > 0 && <li>{preview.notes} anotações viram notas internas</li>}
            {preview.invalid.length > 0 && <li>Sem número válido: {preview.invalid.slice(0, 5).map((x) => `linha ${x.line} (${x.value || "vazio"})`).join(", ")}{preview.invalid.length > 5 ? "…" : ""}</li>}
            {preview.ignoredColumns.length > 0 && <li>Colunas que não usamos: {preview.ignoredColumns.join(", ")}</li>}
            {preview.removedColumns.length > 0 && <li>Descartadas (dados pessoais): {preview.removedColumns.join(", ")}</li>}
          </ul>
          <div className="mt-4 flex gap-2"><Button variant="ghost" onClick={() => setPreview(null)}>Voltar</Button><Button onClick={importar} loading={pending} disabled={preview.valid === 0}>Importar</Button></div>
        </section>
      )}
      {report && <p role="status" className="rounded-[var(--radius-card)] bg-ok-soft px-4 py-3 text-sm font-medium text-ok">Importado: {report.contacts} contatos ({report.created} novos){report.notes ? `, ${report.notes} notas` : ""}{report.invalid ? `; ${report.invalid} linhas sem número ficaram de fora` : ""}.</p>}
      {error && <p role="alert" className="text-sm text-alert">{error}</p>}
      </div>
    </div>
  );
}
