"use client";
import { useId, useState, useTransition } from "react";
import { motion } from "motion/react";
import { ignoreContactsAction, tagContactsAction, undoIgnoreContactsAction } from "@/app/(app)/contatos/actions";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useQueueSelection } from "@/components/queue/queue-selection";
import { T, EASE } from "@/lib/motion";
import { MassMessageSheet } from "./mass-message-sheet";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * A barra de triagem em massa de Contatos: o mesmo padrão da Fila. "Não é cliente" tira os escolhidos da Fila (o lead é arquivado, nada é apagado)
 * e o aviso traz "Desfazer", que devolve exatamente o que saiu. O servidor confere de novo a sessão, o limite de 100 e o dono
 * (a atendente só age no que é dela ou não tem dono).
 * Etiquetar põe a mesma etiqueta em todas as escolhidas; Exportar CSV baixa só as escolhidas, com a permissão de exportar.
 */
export function ContactsBulkBar({ ids, tagOptions, canExport, mass }: { ids: string[]; tagOptions: string[]; canExport: boolean; mass?: { tags: string[] } | null }) {
  const sel = useQueueSelection();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [tagging, setTagging] = useState(false);
  const [tagName, setTagName] = useState("");
  const listId = useId();
  const [massOpen, setMassOpen] = useState(false);
  if (!sel?.mode) return null;
  const n = ids.length;
  const tag = () => start(async () => {
    const r = await tagContactsAction(ids, tagName);
    if (!r.ok) { toast(r.error, "error"); return; }
    toast(`${plural(r.data!.tagged, "contato etiquetado", "contatos etiquetados")} com “${r.data!.tag}”${r.data!.tagged < n ? ` · ${n - r.data!.tagged} já tinham` : ""}`, "ok");
    setTagging(false); setTagName(""); sel.exit();
  });

  const ignore = () => start(async () => {
    const r = await ignoreContactsAction(ids);
    if (!r.ok) { toast(r.error, "error"); return; }
    const d = r.data!;
    if (!d.ignored) { toast("Nenhum contato foi marcado: os escolhidos ficaram de fora", "error"); return; }
    sel.exit();
    toast(`${plural(d.ignored, "contato marcado", "contatos marcados")} como “Não é cliente”${d.skipped ? ` · ${d.skipped} ${d.skipped === 1 ? "ficou" : "ficaram"} de fora` : ""}`, "ok", {
      label: "Desfazer",
      onClick: () => {
        void undoIgnoreContactsAction({ dealIds: d.dealIds, contactIds: d.contactIds }).then((u) => {
          if (!u.ok) { toast(u.error, "error"); return; }
          const back = u.data!.restored + u.data!.direct, blocked = u.data!.conflicts;
          if (!back && !blocked) { toast("Esses contatos já tinham voltado", "info"); return; }
          toast(`${plural(back, "voltou", "voltaram")}${blocked ? ` · ${plural(blocked, "não voltou", "não voltaram")}: a cliente já tem outro atendimento aberto` : ""}`, blocked ? "info" : "ok");
        });
      },
    });
  });

  return (
    <motion.div role="region" aria-label="Ações em massa" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: T.base, ease: EASE }}
      className="sticky bottom-20 z-30 mt-4 border-t border-line-strong bg-paper px-5 py-2.5 shadow-[0_-8px_24px_-12px_rgb(18_18_18/0.18)] lg:bottom-0 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p data-testid="selecionados" className="font-display text-lg leading-none">
          {n ? plural(n, "selecionado", "selecionados") : <span className="font-sans text-sm text-muted">Toque nos contatos para marcar</span>}
        </p>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="ghost" size="sm" className="h-9 px-3.5 text-sm pointer-coarse:min-h-11" onClick={sel.exit} disabled={pending}>Cancelar</Button>
          {tagging ? (
            <span className="flex items-center gap-2">
              <input aria-label="Nome da etiqueta" list={listId} value={tagName} onChange={(e) => setTagName(e.target.value)} maxLength={30} autoFocus
                className="h-9 w-44 rounded-[var(--radius-control)] border border-line-strong bg-paper px-2.5 text-md pointer-coarse:min-h-11 sm:text-sm" placeholder="Ex.: Noiva" />
              <datalist id={listId}>{tagOptions.map((t) => <option key={t} value={t} />)}</datalist>
              <Button size="sm" className="h-9 px-3.5 text-sm pointer-coarse:min-h-11" disabled={n === 0 || !tagName.trim() || pending} loading={pending} onClick={tag}>Pôr etiqueta</Button>
            </span>
          ) : <Button variant="secondary" size="sm" className="h-9 px-3.5 text-sm pointer-coarse:min-h-11" disabled={n === 0 || pending} onClick={() => setTagging(true)}>Etiquetar</Button>}
          {canExport && (n > 0
            ? <a href={`/api/contatos/csv?ids=${ids.join(",")}`} className="inline-flex h-9 items-center rounded-[8px] border border-line-strong px-3.5 text-sm font-medium hover:bg-paper-2 pointer-coarse:min-h-11">Exportar CSV</a>
            : <Button variant="secondary" size="sm" className="h-9 px-3.5 text-sm" disabled>Exportar CSV</Button>)}
          {mass && <Button variant="secondary" size="sm" className="h-9 px-3.5 text-sm pointer-coarse:min-h-11" disabled={n === 0 || pending} onClick={() => setMassOpen(true)}>Mensagem em massa ({n})</Button>}
          <Button size="sm" className="h-9 px-3.5 text-sm pointer-coarse:min-h-11" disabled={n === 0 || pending} loading={pending} onClick={ignore} title="Sai da Fila e dá para desfazer">Não é cliente</Button>
        </div>
      </div>
      {mass && <MassMessageSheet open={massOpen} onClose={() => setMassOpen(false)} audience={{ contactIds: ids }} tags={[]} summary={`${n} escolhidos`} />}
    </motion.div>
  );
}
