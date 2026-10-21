"use client";
import { useState, useTransition } from "react";
import { motion } from "motion/react";
import type { BulkOptions } from "@/server/queries/queue";
import { archiveAction, bulkMoveAction, restoreAction } from "@/app/(app)/funil/actions";
import { bulkResolveAction } from "@/app/(app)/conversa/actions";
import { Button } from "@/components/ui/button";
import { Menu, type MenuItem } from "@/components/ui/menu";
import { useToast } from "@/components/ui/toast";
import { IconClock } from "@/components/icons";
import { T, EASE } from "@/lib/motion";
import { dueLabel } from "@/lib/next-action";
import { useCloseLead } from "./open-lead";
import { useQueueSelection } from "./queue-selection";
import { RetomarDialog } from "./retomar-dialog";
import { PassarDialog } from "./passar-dialog";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const BTN = "h-9 pointer-coarse:min-h-11 px-3.5 text-sm";

/**
 * A barra das conversas marcadas (nova organização, 16/10): Retomar (dia, hora e mensagem opcional para todas; o 1º nome entra sozinho),
 * Passar para (com a permissão), Resolver; no ⋯, Mover etapa e "Não é cliente" (com Desfazer). O servidor confere tudo de novo
 * (sessão, limite e dono: a atendente só age nas próprias e nas sem ninguém).
 */
export function BulkBar({ ids, options, openId }: { ids: string[]; options: BulkOptions; openId: string | null }) {
  const sel = useQueueSelection();
  const toast = useToast();
  const closeLead = useCloseLead();
  const [pending, start] = useTransition();
  const [dialog, setDialog] = useState<{ kind: "retomar" | "passar"; n: number } | null>(null);
  if (!sel?.mode) return null;
  const n = ids.length;
  const idle = n === 0 || pending;

  const finish = (message: string, tone: "ok" | "info" = "ok", action?: { label: string; onClick: () => void }) => {
    toast(message, tone, action);
    sel.exit();
  };

  const resolve = () => start(async () => {
    const r = await bulkResolveAction(ids);
    if (!r.ok) { toast(r.error, "error"); return; }
    const d = r.data!;
    if (openId && d.ids.includes(openId)) closeLead();
    finish(d.resolved ? `${plural(d.resolved, "conversa resolvida", "conversas resolvidas")}. Se alguma escrever, volta sozinha.${d.skipped ? ` ${d.skipped} ficaram de fora.` : ""}` : "Nenhuma foi resolvida (já estavam resolvidas ou são de outra pessoa).", d.resolved ? "ok" : "info");
  });

  const archive = () => start(async () => {
    const r = await archiveAction(ids);
    if (!r.ok) { toast(r.error, "error"); return; }
    const d = r.data!;
    if (!d.archived) { toast("Nenhuma conversa saiu: as escolhidas ficaram de fora", "error"); return; }
    if (openId && d.ids.includes(openId)) closeLead();
    finish(`${plural(d.archived, "marcada como não é cliente", "marcadas como não é cliente")}${d.skipped ? ` · ${d.skipped} ${d.skipped === 1 ? "ficou" : "ficaram"} de fora` : ""}`, "ok", {
      label: "Desfazer",
      onClick: () => {
        void restoreAction(d.ids).then((u) => {
          if (!u.ok) { toast(u.error, "error"); return; }
          const back = u.data!.restored, blocked = u.data!.conflicts.length;
          if (!back && !blocked) { toast("Essas conversas já tinham voltado", "info"); return; }
          toast(`${plural(back, "voltou", "voltaram")}${blocked ? ` · ${plural(blocked, "não voltou", "não voltaram")}: a cliente já tem outra conversa aberta` : ""}`, blocked ? "info" : "ok");
        });
      },
    });
  });

  const move = (key: string, name: string) => start(async () => {
    const r = await bulkMoveAction(ids, key);
    if (!r.ok) { toast(r.error, "error"); return; }
    const d = r.data!;
    finish(d.moved ? `${plural(d.moved, "conversa movida", "conversas movidas")} para ${name}` : `Essas conversas já estavam em ${name}`, d.moved ? "ok" : "info");
  });

  const more: MenuItem[] = [
    ...options.stages.map((s) => ({ label: `Mover para ${s.name}`, onSelect: () => move(s.key, s.name) })),
    { label: "Não é cliente", danger: true, onSelect: archive },
  ];

  return (
    <motion.div role="region" aria-label="Ações para as marcadas" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: T.base, ease: EASE }}
      className="shrink-0 border-t border-line-strong bg-paper px-3 py-2.5 shadow-[0_-8px_24px_-12px_rgb(18_18_18/0.18)]">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p data-testid="selecionados" className="font-display text-lg leading-none">
          {n ? plural(n, "marcada", "marcadas") : <span className="font-sans text-sm text-muted">Toque nas conversas para marcar</span>}
        </p>
        <Button variant="ghost" size="sm" className={`${BTN} -mr-2`} onClick={sel.exit} disabled={pending}>Cancelar</Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" className={BTN} disabled={idle} onClick={() => setDialog({ kind: "retomar", n: (dialog?.n ?? 0) + 1 })}><IconClock size={15} aria-hidden />Retomar</Button>
        {options.canAssign && options.people.length > 0 && (
          <Button variant="secondary" size="sm" className={BTN} disabled={idle} onClick={() => setDialog({ kind: "passar", n: (dialog?.n ?? 0) + 1 })}>Passar para</Button>
        )}
        <Button variant="secondary" size="sm" className={BTN} disabled={idle} loading={pending} onClick={resolve}>Resolver</Button>
        <Menu label="Mais ações para as marcadas" up align="left" className="inline-block" triggerClassName={`${BTN} border border-line-strong bg-paper text-ink ${idle ? "pointer-events-none opacity-45" : ""}`}
          trigger={<span className="whitespace-nowrap">Mais</span>} items={more} />
      </div>
      {dialog?.kind === "retomar" && (
        <RetomarDialog key={`r${dialog.n}`} open onClose={() => setDialog(null)} dealIds={ids}
          onDone={(r) => { setDialog(null); finish(r.texto ? `${plural(r.count, "mensagem programada", "mensagens programadas")} · ${dueLabel(Date.parse(r.dueAt), Date.now())}` : `${plural(r.count, "lembrete criado", "lembretes criados")} · ${dueLabel(Date.parse(r.dueAt), Date.now())}`); }} />
      )}
      {dialog?.kind === "passar" && (
        <PassarDialog key={`p${dialog.n}`} open onClose={() => setDialog(null)} dealIds={ids} people={options.people} ownerId={null} viewerId={null}
          onDone={(r) => { setDialog(null); finish(r.count ? `${plural(r.count, "conversa", "conversas")} agora com ${r.name.split(" ")[0]}` : `Essas conversas já estavam com ${r.name.split(" ")[0]}`, r.count ? "ok" : "info"); }} />
      )}
    </motion.div>
  );
}
