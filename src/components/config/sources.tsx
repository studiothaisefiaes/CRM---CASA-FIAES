"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Empty } from "@/components/ui/empty";
import { useToast } from "@/components/ui/toast";
import { IconCheck, IconDownload, IconPlus } from "@/components/icons";
import { createSourceAction, setSourceActiveAction } from "@/app/(app)/config/actions";
import { SOURCE_KIND_LABEL, SOURCE_KINDS, type SourceKind } from "@/lib/source-kinds";

export type SourceRow = { id: string; code: string; label: string; kind: string; prefill: string | null; active: boolean; link: string | null; svg: string | null; png: string | null };

const PREFILL_HINT: Record<SourceKind, string> = {
  instagram: "Oi! Vi vocês no Instagram", google: "Oi! Achei vocês no Google", panfleto: "Oi! Peguei o panfleto da Casa",
  indicacao: "Oi! Fui indicada por uma amiga", anuncio: "Oi! Vi o anúncio de vocês", recepcao: "Oi! Quero agendar um horário", outro: "Oi! Quero saber mais",
};

export function SourcesEditor({ sources, hasChannel }: { sources: SourceRow[]; hasChannel: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <p className="text-sm text-graphite max-w-[60ch]">Cada origem tem um link e um QR do WhatsApp com uma frase pronta. Quando a cliente manda a primeira mensagem por ele, a conversa já nasce com a origem certa.</p>
        <Button onClick={() => setOpen(true)}><IconPlus size={16} />Nova origem</Button>
      </div>
      {!hasChannel && (
        <div className="rounded-[var(--radius-card)] border border-gold/40 bg-gold-soft/50 px-4 py-3 mb-4 text-sm text-gold-ink" role="status">
          Nenhum WhatsApp conectado. Os links e QRs aparecem quando houver um número conectado em <Link href="/config/whatsapp" className="underline font-medium">Configurações › WhatsApp</Link>.
        </div>
      )}
      {sources.length === 0 ? (
        <div className="rounded-[var(--radius-card)] border border-line bg-paper">
          <Empty title="Nenhuma origem ainda" action={<Button onClick={() => setOpen(true)}>Criar a primeira origem</Button>}>
            Crie uma para cada lugar onde a Casa se divulga: bio do Instagram, panfleto, cartaz da recepção.
          </Empty>
        </div>
      ) : (
        <ul className="grid gap-4">
          <AnimatePresence initial={false}>
            {sources.map((s) => <motion.li key={s.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><SourceCard s={s} /></motion.li>)}
          </AnimatePresence>
        </ul>
      )}
      <NewSource open={open} onClose={() => setOpen(false)} />
    </div>
  );
}

function SourceCard({ s }: { s: SourceRow }) {
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition(); const toast = useToast();
  const file = `origem-${s.code}`;
  const copy = async () => {
    if (!s.link) return;
    try { await navigator.clipboard.writeText(s.link); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { toast("Não foi possível copiar. Selecione o link e copie à mão.", "error"); }
  };
  return (
    <article className={`rounded-[var(--radius-card)] border border-line bg-paper p-4 flex flex-col sm:flex-row gap-5 ${s.active ? "" : "opacity-60"}`}>
      <div className="flex-1 min-w-0 flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-medium text-base truncate">{s.label}</h3>
            <div className="flex flex-wrap items-center gap-2 mt-1.5">
              <Badge tone="gold">{SOURCE_KIND_LABEL[s.kind as SourceKind] ?? s.kind}</Badge>
              <span className="text-xs text-muted font-mono">#{s.code}</span>
              {!s.active && <Badge>Desativada</Badge>}
            </div>
          </div>
          <Switch checked={s.active} label={s.active ? `Desativar ${s.label}` : `Ativar ${s.label}`} disabled={pending}
            onChange={(v) => start(async () => { const r = await setSourceActiveAction(s.id, v); if (!r.ok) toast(r.error, "error"); })} />
        </div>
        <p className="text-sm text-graphite">{s.prefill ? <>Frase: <span className="text-ink">“{s.prefill}”</span></> : "Sem frase: a cliente envia só o código."}</p>
        {s.link ? (
          <div className="flex flex-col gap-2">
            <Input readOnly value={s.link} aria-label={`Link de ${s.label}`} onFocus={(e) => e.currentTarget.select()} className="font-mono" />
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" className="pointer-coarse:min-h-11" onClick={copy}>{copied ? <><IconCheck size={14} />Link copiado</> : "Copiar link"}</Button>
              <a href={s.png ?? "#"} download={`${file}.png`} className="inline-flex items-center gap-1.5 h-8 pointer-coarse:min-h-11 px-3 text-sm font-medium rounded-[8px] border border-line-strong hover:bg-paper-2"><IconDownload size={14} />Baixar PNG</a>
              <a href={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(s.svg ?? "")}`} download={`${file}.svg`} className="inline-flex items-center gap-1.5 h-8 pointer-coarse:min-h-11 px-3 text-sm font-medium rounded-[8px] border border-line-strong hover:bg-paper-2"><IconDownload size={14} />Baixar SVG</a>
            </div>
          </div>
        ) : <p className="text-sm text-muted">O link aparece quando houver um WhatsApp conectado.</p>}
      </div>
      {s.svg && (
        <div role="img" aria-label={`QR code de ${s.label}`} className="shrink-0 size-40 self-center sm:self-start rounded-[var(--radius-control)] border border-line bg-white p-1 [&>svg]:size-full" dangerouslySetInnerHTML={{ __html: s.svg }} />
      )}
    </article>
  );
}

export function NewSource({ open, onClose, initialLabel = "" }: { open: boolean; onClose: () => void; initialLabel?: string }) {
  const [label, setLabel] = useState(initialLabel); const [kind, setKind] = useState<SourceKind>("instagram"); const [prefill, setPrefill] = useState(PREFILL_HINT.instagram);
  const [touched, setTouched] = useState(false); const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition(); const toast = useToast();
  const pick = (k: SourceKind) => { setKind(k); if (!touched) setPrefill(PREFILL_HINT[k]); };
  const submit = () => start(async () => {
    setError(null);
    const r = await createSourceAction({ label, kind, prefill: prefill.trim() || null });
    if (!r.ok) { setError(r.error); return; }
    toast("Origem criada"); setLabel(""); setTouched(false); setPrefill(PREFILL_HINT[kind]); onClose();
  });
  return (
    <Dialog open={open} onClose={onClose} title="Nova origem" description="Dê um nome e escolha a frase que a cliente vai ver pronta na conversa."
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button type="submit" form="new-source" loading={pending} disabled={!label.trim()}>Criar origem</Button></>}>
      <form id="new-source" className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); if (label.trim()) submit(); }}>
        <Field label="Nome" htmlFor="src-label" error={error}><Input id="src-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ex.: Bio do Instagram" maxLength={60} /></Field>
        <div className="flex flex-col gap-1.5">
          <span id="src-kind" className="text-sm font-medium text-graphite">Tipo</span>
          <Segmented labelledBy="src-kind" value={kind} onChange={pick} options={SOURCE_KINDS.map((k) => ({ value: k, label: SOURCE_KIND_LABEL[k] }))} />
        </div>
        <Field label="Frase pronta" htmlFor="src-prefill" hint="O código da origem é acrescentado ao fim. Se a cliente apagar o código, a frase ainda identifica a origem.">
          <Textarea id="src-prefill" value={prefill} onChange={(e) => { setPrefill(e.target.value); setTouched(true); }} maxLength={160} rows={2} />
        </Field>
      </form>
    </Dialog>
  );
}
