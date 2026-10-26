"use client";
import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { deleteLibraryFileAction, updateLibraryFileAction, uploadLibraryFileAction } from "@/app/(app)/config/biblioteca/actions";

export type LibraryRow = { id: string; name: string; caption: string | null; tags: string[]; kind: string; sizeBytes: number | null; thumbUrl: string | null };
const KIND_LABEL: Record<string, string> = { image: "Foto", video: "Vídeo", document: "PDF", audio: "Áudio" };
const size = (n: number | null) => (n == null ? "" : n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const parseTags = (s: string) => s.split(",").map((t) => t.trim()).filter(Boolean);

/** Configurações › Biblioteca: os arquivos da Casa. Subir, mudar nome, legenda e etiquetas, apagar. Nada daqui sai sozinho para a cliente. */
export function LibraryEditor({ items, suggestedTags, enabled, maxMb, canManage }: { items: LibraryRow[]; suggestedTags: string[]; enabled: boolean; maxMb: number; canManage: boolean }) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<LibraryRow | null>(null);
  const [deleting, setDeleting] = useState<LibraryRow | null>(null);
  const [pending, start] = useTransition(); const toast = useToast();
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Que arquivos a Casa manda com frequência?</h2>
          <p className="mt-1 max-w-[60ch] text-sm text-graphite">Foto, vídeo MP4, PDF ou áudio de até {maxMb} MB (o vídeo é comprimido ao subir: pode escolher um de até 64 MB). Na conversa, o clipe tem “Da biblioteca”: a atendente escolhe e envia em um toque.</p>
        </div>
        {canManage && enabled && <Button onClick={() => setAdding(true)}>Subir arquivo</Button>}
      </div>
      {!enabled && <p role="status" className="rounded-[var(--radius-card)] border border-line bg-paper-2/60 px-4 py-3 text-sm">A Biblioteca está desligada. Ligue em Configurações › Recursos para subir e enviar arquivos.</p>}
      <ul className="divide-y divide-line/70 rounded-[var(--radius-card)] border border-line bg-paper">
        {items.map((it) => (
          <li key={it.id} className="flex flex-wrap items-center gap-3 p-3">
            {it.thumbUrl
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={it.thumbUrl} alt="" className="size-14 shrink-0 rounded-[8px] bg-paper-2 object-cover" />
              : <span className="grid size-14 shrink-0 place-items-center rounded-[8px] bg-paper-2 text-xs font-semibold text-gold-ink">{KIND_LABEL[it.kind] ?? "Arquivo"}</span>}
            <p className="min-w-0 flex-1 text-sm"><span className="block truncate font-medium">{it.name}</span>
              <span className="block truncate text-muted">{KIND_LABEL[it.kind]} · {size(it.sizeBytes)}{it.tags.length ? ` · ${it.tags.join(", ")}` : ""}</span></p>
            {canManage && enabled && (
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => setEditing(it)} aria-label={`Editar ${it.name}`}>Editar</Button>
                <Button size="sm" variant="ghost" onClick={() => setDeleting(it)} aria-label={`Apagar ${it.name}`}>Apagar</Button>
              </div>
            )}
          </li>
        ))}
        {items.length === 0 && <li className="px-4 py-8 text-center text-sm text-muted">Nenhum arquivo ainda.</li>}
      </ul>
      <AddDialog open={adding} onClose={() => setAdding(false)} suggestedTags={suggestedTags} maxMb={maxMb} />
      <EditDialog key={editing?.id ?? "x"} row={editing} onClose={() => setEditing(null)} suggestedTags={suggestedTags} />
      <Dialog open={!!deleting} onClose={() => setDeleting(null)} title="Apagar este arquivo da Biblioteca?"
        description="Ele deixa de aparecer e de ser enviado. As conversas que já receberam continuam mostrando o arquivo."
        footer={<><Button variant="secondary" onClick={() => setDeleting(null)}>Cancelar</Button>
          <Button loading={pending} onClick={() => start(async () => { const r = await deleteLibraryFileAction(deleting!.id); if (r.ok) { toast("Arquivo apagado", "ok"); setDeleting(null); } else toast(r.error, "error"); })}>Apagar</Button></>}>
        <p className="text-sm font-medium">{deleting?.name}</p>
      </Dialog>
    </div>
  );
}

function TagsField({ value, onChange, suggested }: { value: string; onChange: (v: string) => void; suggested: string[] }) {
  const cur = parseTags(value);
  const toggle = (t: string) => onChange((cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]).join(", "));
  return (
    <div>
      <label className="block text-sm font-medium text-graphite" htmlFor="lib-tags">Etiquetas (separe por vírgula)</label>
      <Input id="lib-tags" className="mt-1.5" value={value} onChange={(e) => onChange(e.target.value)} placeholder="Ex.: Preços" />
      <div className="mt-2 flex flex-wrap gap-1.5">
        {suggested.map((t) => <button type="button" key={t} aria-pressed={cur.includes(t)} onClick={() => toggle(t)}
          className={`rounded-full border px-2.5 py-1 text-xs ${cur.includes(t) ? "border-ink bg-ink text-paper" : "border-line text-graphite"}`}>{t}</button>)}
      </div>
    </div>
  );
}

/** Vídeo pelo tipo ou, quando o navegador não diz o tipo (.mov no Windows), pela extensão. */
const isVideo = (f: File) => f.type.startsWith("video/") || /\.(mp4|m4v|mov)$/i.test(f.name);

function AddDialog({ open, onClose, suggestedTags, maxMb }: { open: boolean; onClose: () => void; suggestedTags: string[]; maxMb: number }) {
  const file = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(""); const [caption, setCaption] = useState(""); const [tags, setTags] = useState(""); const [picked, setPicked] = useState<File | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition(); const toast = useToast();
  const submit = () => start(async () => {
    if (!picked) return setErr("Escolha um arquivo.");
    // Vídeo vai até 64 MB: o servidor comprime e confere o limite depois (whatsapp/video.ts).
    if (isVideo(picked) ? picked.size > 64 * 1024 * 1024 : picked.size > maxMb * 1024 * 1024)
      return setErr(isVideo(picked) ? "O vídeo passa de 64 MB. Corte um pedaço e tente de novo." : `O arquivo passa de ${maxMb} MB. Escolha um menor.`);
    const form = new FormData();
    form.set("file", picked); form.set("name", name.trim() || picked.name.replace(/\.[^.]+$/, "")); form.set("caption", caption); form.set("tags", JSON.stringify(parseTags(tags)));
    // A ação pode nem responder (internet caiu no meio de um vídeo grande): erro claro em vez de a tela quebrar.
    const r = await uploadLibraryFileAction(form).catch(() => ({ ok: false as const, error: "Não deu para subir o arquivo. Confira a internet e tente de novo." }));
    if (!r.ok) return setErr(r.error);
    toast("Arquivo na Biblioteca", "ok"); setPicked(null); setName(""); setCaption(""); setTags(""); setErr(null); onClose();
  });
  return (
    <Dialog open={open} onClose={onClose} title="Qual arquivo você quer subir?" footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button loading={pending} onClick={submit}>Subir</Button></>}>
      <div className="flex flex-col gap-3">
        <input ref={file} type="file" hidden accept="image/*,video/mp4,video/quicktime,application/pdf,audio/*" aria-label="Escolher arquivo" onChange={(e) => { setPicked(e.target.files?.[0] ?? null); setErr(null); }} />
        <Button variant="secondary" onClick={() => file.current?.click()}>{picked ? picked.name : "Escolher foto, vídeo MP4, PDF ou áudio"}</Button>
        <div><label className="block text-sm font-medium text-graphite" htmlFor="lib-nome">Nome</label>
          <Input id="lib-nome" className="mt-1.5" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="Ex.: Tabela de preços" /></div>
        <div><label className="block text-sm font-medium text-graphite" htmlFor="lib-legenda">Legenda (vai junto com o arquivo)</label>
          <Textarea id="lib-legenda" className="mt-1.5" value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={1000} /></div>
        <TagsField value={tags} onChange={setTags} suggested={suggestedTags} />
        {pending && picked && isVideo(picked) && <p role="status" className="text-sm text-graphite">Enviando o vídeo e deixando mais leve… Pode levar 1 ou 2 minutos. Não feche esta tela.</p>}
        {err && <p role="alert" className="text-sm text-alert">{err}</p>}
      </div>
    </Dialog>
  );
}

function EditDialog({ row, onClose, suggestedTags }: { row: LibraryRow | null; onClose: () => void; suggestedTags: string[] }) {
  const [name, setName] = useState(row?.name ?? ""); const [caption, setCaption] = useState(row?.caption ?? ""); const [tags, setTags] = useState((row?.tags ?? []).join(", "));
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition(); const toast = useToast();
  return (
    <Dialog open={!!row} onClose={onClose} title="O que muda neste arquivo?" footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button>
      <Button loading={pending} onClick={() => start(async () => {
        const r = await updateLibraryFileAction(row!.id, { name, caption: caption.trim() || null, tags: parseTags(tags) });
        if (!r.ok) return setErr(r.error);
        toast("Salvo", "ok"); onClose();
      })}>Salvar</Button></>}>
      <div className="flex flex-col gap-3">
        <div><label className="block text-sm font-medium text-graphite" htmlFor="lib-nome-e">Nome</label>
          <Input id="lib-nome-e" className="mt-1.5" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} /></div>
        {row?.kind !== "audio" && <div><label className="block text-sm font-medium text-graphite" htmlFor="lib-legenda-e">Legenda</label>
          <Textarea id="lib-legenda-e" className="mt-1.5" value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={1000} /></div>}
        <TagsField value={tags} onChange={setTags} suggested={suggestedTags} />
        {err && <p role="alert" className="text-sm text-alert">{err}</p>}
      </div>
    </Dialog>
  );
}
