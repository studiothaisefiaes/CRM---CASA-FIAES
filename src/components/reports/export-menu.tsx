"use client";
import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { IconDownload } from "@/components/icons";
import { EASE, T } from "@/lib/motion";

/** Um único "Exportar" em vez de um botão por painel. */
export function ExportMenu({ qs, gestor }: { qs: string; gestor: boolean }) {
  const [open, setOpen] = useState(false);
  const items: [string, string][] = [["numeros", "Números do período"], ["resposta", "Primeira resposta"], ["funil", "Funil por marcos"], ["parados", "Parados agora"], ["canal", "Pelo CRM ou pelo celular"],
    ["origem", "Origem até a venda"], ["objecoes", "Perdas e objeções"], ["qualidade", "Qualidade dos dados"], ["followup", "Eficácia do follow-up"], ["calor", "Mapa de calor"],
    ...(gestor ? ([["pessoas", "Pessoa contra a meta"], ["financeiro", "Financeiro das vendas"], ["cobrancas", "Cobranças vencidas e a vencer"]] as [string, string][]) : [])];
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="h-9 pointer-coarse:h-11 px-3 inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-line-strong bg-paper text-sm hover:bg-paper-2">
        <IconDownload size={15} />Exportar
      </button>
      <AnimatePresence>
        {open && (<>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
          <motion.ul initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: T.fast, ease: EASE }}
            className="absolute right-0 top-11 z-50 w-64 max-h-[70vh] overflow-y-auto bg-paper border border-line rounded-[var(--radius-card)] shadow-[var(--shadow-pop)] py-1.5">
            <li className="px-3.5 pt-1 pb-2 text-xs text-muted">Planilha CSV (abre no Excel)</li>
            {items.map(([k, label]) => <li key={k}><a href={`/api/relatorios/${k}?${qs}`} onClick={() => setOpen(false)} className="block px-3.5 py-2 pointer-coarse:py-3 text-sm hover:bg-paper-2">{label}</a></li>)}
          </motion.ul>
        </>)}
      </AnimatePresence>
    </div>
  );
}
