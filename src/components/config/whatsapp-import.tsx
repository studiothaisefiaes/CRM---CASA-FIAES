"use client";
import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { IconUpload } from "@/components/icons";
import { applyZapAction, discardZapAction, previewZapAction, searchZapClientsAction } from "@/app/(app)/config/importar-whatsapp/actions";
import type { ZapPreview, ZapReport } from "@/server/domain/whatsapp-import";

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Bahia" }) : "?");
const n = (v: number, um: string, varios: string) => `${v} ${v === 1 ? um : varios}`;
const phoneLabel = (p: string) => p.replace(/^\+55(\d{2})(\d{4,5})(\d{4})$/, "($1) $2-$3");
type Client = { id: string; name: string | null; phone: string };

/**
 * Trazer conversa antiga do WhatsApp: o .zip ou .txt do "Exportar conversa" → prévia (quem é a Casa, a cliente, o período, quantas
 * são novas) → Importar. Nada é enviado. Na ficha, a cliente já vem escolhida (`contact`).
 */
export function WhatsappImport({ contact }: { contact?: { id: string; name: string | null } }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ZapPreview | null>(null);
  const [report, setReport] = useState<ZapReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [pending, start] = useTransition();
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Client[]>([]);
  const [choosing, setChoosing] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const search = (v: string) => {
    setQ(v); clearTimeout(timer.current);
    if (v.trim().length < 2) { setFound([]); return; }
    timer.current = setTimeout(() => { void searchZapClientsAction(v).then(setFound); }, 250);
  };

  const pick = (f: File | undefined) => {
    if (!f) return;
    if (preview) void discardZapAction(preview.token);
    setFile(f); setPreview(null); setReport(null); setError(null);
  };
  const ver = async () => {
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) { setError("O arquivo passa de 50 MB. Exporte sem mídia ou envie só o .txt."); return; }
    setUploading(true); setError(null);
    try {
      const fd = new FormData(); fd.set("file", file); if (contact) fd.set("contactId", contact.id);
      const r = await fetch("/api/importar/whatsapp", { method: "POST", body: fd }).then((x) => x.json()).catch(() => ({ ok: false, error: "Não deu certo. Tente de novo." }));
      if (r.ok) setPreview(r.data); else setError(r.error);
    } finally { setUploading(false); }
  };
  const opts = (p: ZapPreview, over: { casa?: string; contactId?: string | null } = {}) => ({
    casa: over.casa ?? p.casa, contactId: contact?.id ?? (over.contactId !== undefined ? over.contactId : p.contact?.id ?? null), fixed: !!contact,
  });
  const refaz = (over: { casa?: string; contactId?: string | null }) => preview && start(async () => {
    const r = await previewZapAction(preview.token, opts(preview, over));
    if (r.ok) { setPreview(r.data); setError(null); } else setError(r.error);
  });
  const importar = () => preview && start(async () => {
    const r = await applyZapAction(preview.token, opts(preview));
    if (r.ok) { setReport(r.data); setPreview(null); setError(null); } else setError(r.error);
  });

  const multi = preview && preview.participants.length > 0;
  return (
    <div className="grid items-start gap-5 min-[1100px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] min-[1100px]:gap-6">
      <section className="rounded-[var(--radius-card)] border border-line bg-paper p-5 text-sm text-graphite">
        <h2 className={contact ? "text-ink text-lg font-semibold" : "sr-only"}>Trazer conversa antiga do WhatsApp</h2>
        <p className="mt-1">O sistema só tem as mensagens desde julho de 2026. Para trazer o que veio antes, exporte a conversa no celular da Casa e envie o arquivo aqui. Nada é enviado para a cliente, e enviar de novo não duplica.</p>
        <ol className="mt-3 list-decimal pl-5 space-y-1">
          <li><b className="font-semibold text-ink">Android:</b> abra a conversa › ⋮ › Mais › Exportar conversa › Incluir mídia (ou Sem mídia) › salve ou mande para o computador.</li>
          <li><b className="font-semibold text-ink">iPhone:</b> abra a conversa › toque no nome da cliente › Exportar conversa › Anexar mídia (ou Sem mídia) › Salvar em Arquivos.</li>
          <li>Envie aqui o <b className="font-semibold text-ink">.zip</b> (ou o .txt), até 50 MB. Fotos, áudios e PDFs entram até 25 MB por conversa.</li>
        </ol>
        <p className="mt-3">Conversa de grupo não entra. As mensagens trazidas aparecem com o selo “importada” e não abrem aviso, prazo nem não lida.</p>
      </section>
      <div className="flex min-w-0 flex-col gap-5">
        <button type="button" onClick={() => input.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files[0]); }}
          className="w-full rounded-[var(--radius-card)] border-2 border-dashed border-line-strong px-4 py-8 text-center transition-colors hover:border-gold hover:bg-gold-soft/30">
          <IconUpload className="mx-auto text-gold" size={22} />
          <span className="mt-2 block text-sm font-medium">{file ? file.name : "Escolher ou soltar o .zip ou .txt da conversa"}</span>
        </button>
        <input ref={input} type="file" hidden accept=".zip,.txt,application/zip,text/plain" aria-label="Arquivo da conversa exportada" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
        {!preview && !report && <Button onClick={ver} loading={uploading} disabled={!file}>Ver prévia</Button>}
        {preview && (
          <section aria-label="Prévia" className="rounded-[var(--radius-card)] border border-line bg-paper p-5 text-sm">
            <p className="font-display text-lg">{n(preview.total, "mensagem", "mensagens")} de {day(preview.from)} a {day(preview.to)}</p>
            <ul className="mt-2 list-disc pl-5 text-graphite">
              <li><b className="font-semibold text-ink">{n(preview.newCount, "nova", "novas")}</b>{preview.contact ? ` · ${preview.existingCount} já estão na conversa (ficam como estão)` : ""}</li>
              {preview.media.files > 0 && <li>{preview.media.imported} mídias entram (foto, áudio, PDF){preview.media.skipped ? ` · ${preview.media.skipped} ficam só como “mídia não importada”` : ""}</li>}
              {!preview.media.files && preview.media.skipped > 0 && <li>{preview.media.skipped} mídias ficam só como “mídia não importada” (arquivo sem mídia)</li>}
              {(preview.ignored.system > 0 || preview.ignored.deleted > 0) && <li>Ignoradas: {n(preview.ignored.system, "aviso do WhatsApp", "avisos do WhatsApp")}{preview.ignored.deleted ? `, ${n(preview.ignored.deleted, "apagada", "apagadas")}` : ""}</li>}
            </ul>
            {multi && (
              <fieldset className="mt-4">
                <legend className="font-semibold text-ink">Quem é a Casa nesta conversa?</legend>
                <div className="mt-2 flex flex-col gap-1.5">
                  {preview.participants.map((p) => (
                    <label key={p.name} className="flex min-h-11 items-center gap-2.5 rounded-[var(--radius-control)] border border-line px-3 has-[:checked]:border-gold has-[:checked]:bg-gold-soft/30">
                      <input type="radio" name="casa" checked={preview.casa === p.name} onChange={() => refaz({ casa: p.name })} disabled={pending} />
                      <span className="min-w-0 flex-1 truncate">{p.name}</span><span className="text-xs text-muted">{n(p.count, "mensagem", "mensagens")}</span>
                    </label>
                  ))}
                  {preview.participants.length === 1 && (
                    <label className="flex min-h-11 items-center gap-2.5 rounded-[var(--radius-control)] border border-line px-3 has-[:checked]:border-gold has-[:checked]:bg-gold-soft/30">
                      <input type="radio" name="casa" checked={preview.casa === ""} onChange={() => refaz({ casa: "" })} disabled={pending} />
                      <span>Nenhum: só a cliente escreveu</span>
                    </label>
                  )}
                </div>
              </fieldset>
            )}
            <div className="mt-4">
              <p className="font-semibold text-ink">Cliente</p>
              {preview.contact && !choosing ? (
                <p className="mt-1 flex flex-wrap items-center gap-2 text-graphite">
                  <span data-testid="zap-cliente" className="text-ink">{preview.contact.name ?? "Sem nome"} · {phoneLabel(preview.contact.phone)}</span>
                  <span className="text-xs text-muted">{preview.contact.source === "arquivo" ? "pelo telefone do arquivo" : preview.contact.source === "nome" ? "pelo nome do contato" : preview.contact.source === "ficha" ? "desta ficha" : "escolhida"}</span>
                  {!contact && <button type="button" className="text-xs underline underline-offset-2" onClick={() => setChoosing(true)}>trocar</button>}
                </p>
              ) : (
                <div className="mt-1">
                  <p className="text-graphite">{choosing ? "Procure a cliente pelo nome ou telefone:" : "Não achamos a cliente pelo arquivo. Procure pelo nome ou telefone:"}</p>
                  <Input className="mt-2" value={q} onChange={(e) => search(e.target.value)} placeholder="Nome ou telefone" aria-label="Procurar cliente" />
                  {found.length > 0 && q.trim().length >= 2 && (
                    <ul className="mt-2 flex flex-col gap-1">
                      {found.map((c) => (
                        <li key={c.id}><button type="button" className="w-full min-h-11 rounded-[var(--radius-control)] border border-line px-3 text-left hover:border-gold" onClick={() => { setQ(""); setFound([]); setChoosing(false); refaz({ contactId: c.id }); }}>
                          {c.name ?? "Sem nome"} <span className="text-muted">· {phoneLabel(c.phone)}</span></button></li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
            <div className="mt-5 flex gap-2">
              <Button variant="ghost" onClick={() => { void discardZapAction(preview.token); setPreview(null); }}>Voltar</Button>
              <Button onClick={importar} loading={pending} disabled={!preview.contact || choosing || preview.newCount === 0}>Importar</Button>
            </div>
          </section>
        )}
        {report && (
          <div role="status" className="rounded-[var(--radius-card)] bg-ok-soft px-4 py-3 text-sm text-ok">
            <p className="font-medium">Importado: {n(report.inserted, "mensagem", "mensagens")} de {day(report.from)} a {day(report.to)}{report.existing ? ` · ${report.existing} já estavam` : ""}{report.media ? ` · ${report.media} mídias` : ""}.</p>
            <Link href={`/contatos/${report.contactId}?aba=conversas`} className="mt-1 inline-block font-semibold underline underline-offset-2">Abrir a conversa</Link>
          </div>
        )}
        {error && <p role="alert" className="text-sm text-alert">{error}</p>}
      </div>
    </div>
  );
}
