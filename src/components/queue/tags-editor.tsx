"use client";
import { useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addTagAction, removeTagAction } from "@/app/(app)/funil/actions";
import { addContactTagAction, removeContactTagAction } from "@/app/(app)/contatos/actions";
import { IconClose, IconPlus } from "@/components/icons";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { TagDot } from "@/components/tags/tag-dot";

type Tag = { id: string; name: string; color?: string | null };

/**
 * Etiquetas da cliente, no bloco "Quem é": toda a equipe põe e tira. "+ Etiqueta" abre um campo com as etiquetas que já existem como sugestão;
 * escrever um nome novo cria a etiqueta na hora. Aparecem também no card da Fila.
 */
/** Na conversa usa `dealId`; na ficha da cliente, `contactId`. As etiquetas ficam sempre na cliente. */
export function TagsEditor({ dealId, contactId, tags, options }: { dealId?: string; contactId?: string; tags: Tag[]; options: string[] }) {
  const toast = useToast();
  const router = useRouter();
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [list, setList] = useState(tags);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const has = new Set(list.map((t) => t.name.toLowerCase()));
  const suggestions = options.filter((o) => !has.has(o.toLowerCase()));

  const add = (name: string) => start(async () => {
    if (!name.trim()) return;
    const r = contactId ? await addContactTagAction(contactId, name) : await addTagAction(dealId!, name);
    if (!r.ok) { toast(r.error, "error"); return; }
    setList((l) => (l.some((t) => t.id === r.data!.id) ? l : [...l, r.data!].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))));
    setText("");
    input.current?.focus();
    router.refresh();
  });
  const remove = (t: Tag) => start(async () => {
    const r = contactId ? await removeContactTagAction(contactId, t.id) : await removeTagAction(dealId!, t.id);
    if (!r.ok) { toast(r.error, "error"); return; }
    setList((l) => l.filter((x) => x.id !== t.id));
    router.refresh();
  });

  return (
    <div className="flex flex-col gap-2" aria-label="Etiquetas">
      <div className="flex flex-wrap items-center gap-1.5">
        {list.map((t) => (
          <span key={t.id} className="inline-flex items-center gap-0.5 rounded-full border border-line-strong bg-paper pl-2.5 text-sm text-ink-2">
            <TagDot color={t.color} className="mr-1" />{t.name}
            <button type="button" disabled={pending} onClick={() => remove(t)} aria-label={`Tirar a etiqueta ${t.name}`}
              className="grid size-8 place-items-center rounded-full text-muted hover:text-alert disabled:opacity-60 lg:size-6">
              <IconClose size={12} aria-hidden />
            </button>
          </span>
        ))}
        {!editing && (
          <button type="button" onClick={() => { setEditing(true); requestAnimationFrame(() => input.current?.focus()); }}
            className="inline-flex min-h-11 items-center gap-1 rounded-full px-2 text-sm font-medium text-gold-ink hover:underline lg:min-h-7">
            <IconPlus size={14} aria-hidden />Etiqueta
          </button>
        )}
      </div>
      {editing && (
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); add(text); }}>
          <input ref={input} list={listId} value={text} onChange={(e) => setText(e.target.value)} maxLength={30} placeholder="Ex.: VIP, Noiva"
            aria-label="Nome da etiqueta" onKeyDown={(e) => { if (e.key === "Escape") { setEditing(false); setText(""); } }}
            className="min-h-11 min-w-0 flex-1 rounded-[var(--radius-control)] border border-control bg-paper px-3 text-base lg:min-h-9 lg:text-sm" />
          <datalist id={listId}>{suggestions.map((o) => <option key={o} value={o} />)}</datalist>
          <button type="submit" disabled={pending || !text.trim()}
            className={cn("min-h-11 rounded-[var(--radius-control)] bg-ink px-3.5 text-sm font-medium text-paper disabled:opacity-50 lg:min-h-9")}>Pôr</button>
          <button type="button" onClick={() => { setEditing(false); setText(""); }} className="min-h-11 px-2 text-sm text-graphite hover:text-ink lg:min-h-9">Fechar</button>
        </form>
      )}
    </div>
  );
}
