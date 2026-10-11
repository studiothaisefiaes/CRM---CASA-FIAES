"use client";
import { useTransition } from "react";
import { motion } from "motion/react";
import { ignoreContactsAction, undoIgnoreContactsAction } from "@/app/(app)/contatos/actions";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useQueueSelection } from "@/components/queue/queue-selection";
import { T, EASE } from "@/lib/motion";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * A barra de triagem em massa de Contatos: o mesmo padrão da Fila. "Não é cliente" tira os escolhidos da Fila (o lead é arquivado, nada é apagado)
 * e o aviso traz "Desfazer", que devolve exatamente o que saiu. O servidor confere de novo a sessão, o limite de 100 e o dono
 * (a atendente só age no que é dela ou não tem dono).
 */
export function ContactsBulkBar({ ids }: { ids: string[] }) {
  const sel = useQueueSelection();
  const toast = useToast();
  const [pending, start] = useTransition();
  if (!sel?.mode) return null;
  const n = ids.length;

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
        <p data-testid="selecionados" className="font-serif text-lg leading-none">
          {n ? plural(n, "selecionado", "selecionados") : <span className="font-sans text-sm text-muted">Toque nos contatos para marcar</span>}
        </p>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" className="h-9 px-3.5 text-sm pointer-coarse:min-h-11" onClick={sel.exit} disabled={pending}>Cancelar</Button>
          <Button size="sm" className="h-9 px-3.5 text-sm pointer-coarse:min-h-11" disabled={n === 0 || pending} loading={pending} onClick={ignore} title="Sai da Fila e dá para desfazer">Não é cliente</Button>
        </div>
      </div>
    </motion.div>
  );
}
