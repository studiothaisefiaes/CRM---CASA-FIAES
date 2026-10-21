"use client";
import { useEffect, useState, useTransition } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import { useToast } from "@/components/ui/toast";
import { listLibraryAction, sendLibraryFileAction } from "@/app/(app)/conversa/actions";
import type { LibraryItem } from "@/server/domain/library";

const KIND_LABEL: Record<string, string> = { image: "Foto", video: "Vídeo", document: "PDF", audio: "Áudio" };
const TODAS = "__todas__";

/** “Da biblioteca” (clipe da conversa): abas por etiqueta, miniatura e “Enviar” em um toque. Quem envia é a atendente, sempre. */
export function LibraryPicker({ dealId, open, onClose, onSent }: { dealId: string; open: boolean; onClose: () => void; onSent?: (waitedSeconds: number | null) => void }) {
  const [items, setItems] = useState<LibraryItem[] | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [tag, setTag] = useState(TODAS);
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState<string | null>(null);
  const [, start] = useTransition(); const toast = useToast();

  useEffect(() => {
    if (!open) return;
    let alive = true;
    void listLibraryAction({}).then((r) => {
      if (!alive) return;
      if (r.ok) { setItems(r.data!.items); setTags(r.data!.tags); setError(null); } else setError(r.error);
    });
    return () => { alive = false; };
  }, [open]);

  const shown = (items ?? []).filter((i) => (tag === TODAS || i.tags.includes(tag)) && (!q.trim() || `${i.name} ${i.caption ?? ""}`.toLowerCase().includes(q.trim().toLowerCase())));
  const send = (it: LibraryItem) => { setSending(it.id); start(async () => {
    const r = await sendLibraryFileAction(dealId, it.id, it.caption);
    setSending(null);
    if (!r.ok) return toast(r.error, "error");
    toast(`${it.name} enviado`, "ok"); onSent?.(r.data?.waitedSeconds ?? null); onClose();
  }); };

  return (
    <Dialog open={open} onClose={onClose} title="Qual arquivo da Biblioteca você quer mandar?" width={560}>
      {error ? <p role="alert" className="text-sm text-alert">{error}</p> : items === null ? <p className="text-sm text-muted" role="status">Abrindo a Biblioteca…</p> : (
        <div className="flex flex-col gap-3">
          {tags.length > 0 && <Segmented label="Etiquetas" value={tag} onChange={setTag} options={[{ value: TODAS, label: "Todas" }, ...tags.map((t) => ({ value: t, label: t }))]} />}
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar pelo nome" aria-label="Buscar na Biblioteca" />
          <ul className="flex max-h-[50vh] flex-col divide-y divide-line/70 overflow-y-auto rounded-[var(--radius-card)] border border-line">
            {shown.map((it) => (
              <li key={it.id} className="flex items-center gap-3 p-2.5">
                {it.thumbUrl
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={it.thumbUrl} alt={`Miniatura de ${it.name}`} className="size-14 shrink-0 rounded-[8px] bg-paper-2 object-cover" />
                  : <span className="grid size-14 shrink-0 place-items-center rounded-[8px] bg-paper-2 text-xs font-semibold text-gold-ink">{KIND_LABEL[it.kind] ?? "Arquivo"}</span>}
                <p className="min-w-0 flex-1 text-sm"><span className="block truncate font-medium">{it.name}</span>
                  <span className="block truncate text-muted">{KIND_LABEL[it.kind] ?? "Arquivo"}{it.caption ? ` · ${it.caption}` : ""}</span></p>
                <Button size="sm" loading={sending === it.id} disabled={sending !== null} onClick={() => send(it)} aria-label={`Enviar ${it.name}`}>Enviar</Button>
              </li>
            ))}
            {shown.length === 0 && <li className="px-4 py-8 text-center text-sm text-muted">{items.length === 0 ? "A Biblioteca está vazia. A gestão sobe os arquivos em Configurações › Biblioteca." : "Nenhum arquivo com essa etiqueta ou nome."}</li>}
          </ul>
        </div>
      )}
    </Dialog>
  );
}
