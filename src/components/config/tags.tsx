"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { TagDot } from "@/components/tags/tag-dot";
import { TAG_COLORS } from "@/lib/tag-colors";
import { cn } from "@/lib/cn";
import { mergeTagsAction, renameTagAction, setTagColorAction } from "@/app/(app)/config/actions";

type T = { id: string; name: string; color: string | null; uses: number; protected: boolean };
const clientes = (n: number) => `${n.toLocaleString("pt-BR")} ${n === 1 ? "cliente" : "clientes"}`;

/** Configurações › Etiquetas: a equipe cria as etiquetas na conversa; aqui ela dá cor, renomeia e junta as que dizem a mesma coisa. */
export function TagsAdmin({ tags }: { tags: T[] }) {
  const [merging, setMerging] = useState<T | null>(null);
  if (!tags.length) return <p className="rounded-[var(--radius-card)] border border-line bg-paper px-4 py-6 text-sm text-graphite">Nenhuma etiqueta ainda. Elas nascem na conversa, em “+ Etiqueta”.</p>;
  return (
    <div>
      <p className="mb-4 max-w-[70ch] text-sm text-graphite">Etiquetas que a equipe põe nas clientes. Dê uma cor para achar rápido na Fila, renomeie e junte duas que querem dizer a mesma coisa. A contagem é de clientes com a etiqueta.</p>
      <ul className="divide-y divide-line/70 rounded-[var(--radius-card)] border border-line bg-paper">
        {tags.map((t) => <li key={t.id}><Row t={t} onMerge={() => setMerging(t)} /></li>)}
      </ul>
      {merging && <MergeDialog from={merging} options={tags.filter((x) => x.id !== merging.id)} onClose={() => setMerging(null)} />}
    </div>
  );
}

function Row({ t, onMerge }: { t: T; onMerge: () => void }) {
  const [name, setName] = useState(t.name);
  const [color, setColor] = useState(t.color);
  const [pending, start] = useTransition();
  const toast = useToast(); const router = useRouter();
  const rename = () => {
    const v = name.trim().replace(/\s+/g, " ");
    if (!v || v === t.name) { setName(t.name); return; }
    start(async () => { const r = await renameTagAction(t.id, v); if (r.ok) { toast("Etiqueta renomeada"); router.refresh(); } else { toast(r.error, "error"); setName(t.name); } });
  };
  const paint = (c: string | null) => { setColor(c); start(async () => { const r = await setTagColorAction(t.id, c); if (!r.ok) { toast(r.error, "error"); setColor(t.color); } }); };
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
      <span className="flex min-w-[12rem] flex-1 items-center gap-2">
        <TagDot color={color} />
        {t.protected
          ? <span className="font-medium">{t.name} <span className="text-xs font-normal text-muted">(vem do Avec; não muda de nome)</span></span>
          : <Input value={name} onChange={(e) => setName(e.target.value)} onBlur={rename} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
              maxLength={30} aria-label={`Nome da etiqueta ${t.name}`} className="h-9 max-w-[16rem]" disabled={pending} />}
      </span>
      <span className="text-sm text-graphite tabular">{clientes(t.uses)}</span>
      <span role="radiogroup" aria-label={`Cor de ${t.name}`} className="flex flex-wrap items-center gap-1">
        <button type="button" role="radio" aria-checked={!color} aria-label={`Sem cor em ${t.name}`} onClick={() => paint(null)} disabled={pending}
          className={cn("grid size-8 place-items-center rounded-full border text-xs text-muted", !color ? "border-ink" : "border-line")}>–</button>
        {TAG_COLORS.map((c, i) => (
          <button key={c} type="button" role="radio" aria-checked={color === c} aria-label={`Cor ${i + 1} de ${t.name}`} onClick={() => paint(c)} disabled={pending}
            className={cn("grid size-8 place-items-center rounded-full border", color === c ? "border-ink" : "border-transparent")}>
            <span className="size-4 rounded-full" style={{ background: c }} />
          </button>
        ))}
      </span>
      {!t.protected && <Button variant="secondary" size="sm" onClick={onMerge} aria-label={`Juntar ${t.name} com outra`}>Juntar…</Button>}
    </div>
  );
}

function MergeDialog({ from, options, onClose }: { from: T; options: T[]; onClose: () => void }) {
  const [into, setInto] = useState(options[0]?.id ?? "");
  const [pending, start] = useTransition();
  const toast = useToast(); const router = useRouter();
  const target = options.find((o) => o.id === into);
  const go = () => start(async () => {
    const r = await mergeTagsAction(from.id, into);
    if (r.ok) { toast(`Juntadas: ${clientes(r.data?.moved ?? 0)} passaram para “${target?.name}”`); onClose(); router.refresh(); } else toast(r.error, "error");
  });
  return (
    <Dialog open onClose={onClose} title={`Juntar “${from.name}”`}
      description={<>As {clientes(from.uses)} de “{from.name}” passam para a etiqueta escolhida e “{from.name}” deixa de existir.</>}
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button loading={pending} disabled={!into} onClick={go}>Juntar</Button></>}>
      <label className="flex flex-col gap-1.5 text-sm font-medium text-graphite">Juntar em
        <Select value={into} onChange={(e) => setInto(e.target.value)}>{options.map((o) => <option key={o.id} value={o.id}>{o.name} ({clientes(o.uses)})</option>)}</Select>
      </label>
    </Dialog>
  );
}
