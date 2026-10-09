"use client";
import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { IconDownload } from "@/components/icons";
import { EASE } from "@/lib/motion";

/** Um único "Exportar" em vez de um botão por painel. */
export function ExportMenu({ qs, gestor }: { qs: string; gestor: boolean }) {
  const [open, setOpen] = useState(false);
  const items: [string, string][] = [["funil", "Funil por etapa"], ["resposta", "Tempo de resposta por pessoa"], ["origem", "Origem dos leads"], ["objecoes", "Objeções e motivos de perda"],
    ...(gestor ? ([["financeiro", "Financeiro das vendas"], ["cobrancas", "Cobranças a vencer"]] as [string, string][]) : [])];
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="h-9 px-3 inline-flex items-center gap-1.5 rounded-[10px] border border-line-strong bg-paper text-[13px] hover:bg-paper-2">
        <IconDownload size={15} />Exportar
      </button>
      <AnimatePresence>
        {open && (<>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
          <motion.ul initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.16, ease: EASE }}
            className="absolute right-0 top-11 z-50 w-64 bg-paper border border-line rounded-[14px] shadow-[var(--shadow-pop)] py-1.5">
            <li className="px-3.5 pt-1 pb-2 text-[11.5px] text-muted">Planilha CSV (abre no Excel)</li>
            {items.map(([k, label]) => <li key={k}><a href={`/api/relatorios/${k}?${qs}`} onClick={() => setOpen(false)} className="block px-3.5 py-2 text-[13.5px] hover:bg-paper-2">{label}</a></li>)}
          </motion.ul>
        </>)}
      </AnimatePresence>
    </div>
  );
}
