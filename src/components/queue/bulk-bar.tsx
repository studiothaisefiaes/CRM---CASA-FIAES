"use client";
import { useTransition } from "react";
import { motion } from "motion/react";
import type { BulkOptions } from "@/server/queries/queue";
import { archiveAction, bulkAssignAction, bulkMoveAction, restoreAction } from "@/app/(app)/funil/actions";
import { Button } from "@/components/ui/button";
import { Menu } from "@/components/ui/menu";
import { useToast } from "@/components/ui/toast";
import { DUR, EASE } from "@/lib/motion";
import { useCloseLead } from "./open-lead";
import { useQueueSelection } from "./queue-selection";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const BTN = "h-9 pointer-coarse:min-h-11 px-3.5 text-sm";

/**
 * A barra de ações em massa (triagem): aparece embaixo da Fila com a seleção ligada. Arquivar ("Não é cliente") tem "Desfazer" no aviso;
 * Atribuir a… é só da gestão; Mover etapa só oferece etapas que não pedem diálogo. O servidor confere tudo de novo (sessão, limite de 100
 * e dono: a atendente só age nos próprios leads e nos sem dono).
 */
export function BulkBar({ ids, options, openId }: { ids: string[]; options: BulkOptions; openId: string | null }) {
  const sel = useQueueSelection();
  const toast = useToast();
  const closeLead = useCloseLead();
  const [pending, start] = useTransition();
  if (!sel?.mode) return null;
  const n = ids.length;
  const idle = n === 0 || pending;

  const finish = (message: string, tone: "ok" | "info" = "ok", action?: { label: string; onClick: () => void }) => {
    toast(message, tone, action);
    sel.exit();
  };

  const archive = () => start(async () => {
    const r = await archiveAction(ids);
    if (!r.ok) { toast(r.error, "error"); return; }
    const d = r.data!;
    if (!d.archived) { toast("Nenhum lead foi arquivado: os escolhidos ficaram de fora", "error"); return; }
    if (openId && d.ids.includes(openId)) closeLead();
    finish(`${plural(d.archived, "arquivado", "arquivados")}${d.skipped ? ` · ${d.skipped} ${d.skipped === 1 ? "ficou" : "ficaram"} de fora` : ""}`, "ok", {
      label: "Desfazer",
      onClick: () => {
        void restoreAction(d.ids).then((u) => {
          if (!u.ok) { toast(u.error, "error"); return; }
          const back = u.data!.restored, blocked = u.data!.conflicts.length;
          if (!back && !blocked) { toast("Esses leads já tinham voltado", "info"); return; }
          toast(`${plural(back, "voltou", "voltaram")} para a fila${blocked ? ` · ${plural(blocked, "não voltou", "não voltaram")}: a cliente já tem outro atendimento aberto` : ""}`, blocked ? "info" : "ok");
        });
      },
    });
  });

  const assign = (userId: string, name: string) => start(async () => {
    const r = await bulkAssignAction(ids, userId);
    if (!r.ok) { toast(r.error, "error"); return; }
    const d = r.data!;
    finish(d.assigned ? `${plural(d.assigned, "lead atribuído", "leads atribuídos")} a ${name.split(" ")[0]}` : `Esses leads já eram de ${name.split(" ")[0]}`, d.assigned ? "ok" : "info");
  });

  const move = (key: string, name: string) => start(async () => {
    const r = await bulkMoveAction(ids, key);
    if (!r.ok) { toast(r.error, "error"); return; }
    const d = r.data!;
    finish(d.moved ? `${plural(d.moved, "lead movido", "leads movidos")} para ${name}` : `Esses leads já estavam em ${name}`, d.moved ? "ok" : "info");
  });

  return (
    <motion.div role="region" aria-label="Ações em massa" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: DUR.base, ease: EASE }}
      className="shrink-0 border-t border-line-strong bg-paper px-3 py-2.5 shadow-[0_-8px_24px_-12px_rgb(18_18_18/0.18)]">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p data-testid="selecionados" className="font-serif text-lg leading-none">
          {n ? plural(n, "selecionado", "selecionados") : <span className="font-sans text-sm text-muted">Toque nos leads para marcar</span>}
        </p>
        <Button variant="ghost" size="sm" className={`${BTN} -mr-2`} onClick={sel.exit} disabled={pending}>Cancelar</Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" className={BTN} disabled={idle} loading={pending} onClick={archive} title="Não é cliente: sai da fila e dá para desfazer">Arquivar</Button>
        {options.canAssign && options.people.length > 0 && (
          <Menu label="Atribuir a…" up align="left" className="inline-block" triggerClassName={`${BTN} border border-line-strong bg-paper text-ink ${idle ? "pointer-events-none opacity-45" : ""}`}
            trigger={<span className="whitespace-nowrap">Atribuir a…</span>} items={options.people.map((p) => ({ label: p.name, onSelect: () => assign(p.id, p.name) }))} />
        )}
        {options.stages.length > 0 && (
          <Menu label="Mover etapa" up align="left" className="inline-block" triggerClassName={`${BTN} border border-line-strong bg-paper text-ink ${idle ? "pointer-events-none opacity-45" : ""}`}
            trigger={<span className="whitespace-nowrap">Mover etapa</span>} items={options.stages.map((s) => ({ label: s.name, onSelect: () => move(s.key, s.name) }))} />
        )}
      </div>
    </motion.div>
  );
}
