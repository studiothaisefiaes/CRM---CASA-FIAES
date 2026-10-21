"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { saveAvecRoboAction } from "@/app/(app)/config/avec/actions";

export type AvecRoboLastView = { em: string; ok: boolean; linhasNovas: number; erros: string[]; relatorios: number } | null;

const when = (iso: string) => new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Bahia", dateStyle: "short", timeStyle: "short" }).format(new Date(iso));

/** Configurações › Ligação com o Avec: o robô que baixa os relatórios do Avec todo dia e entrega ao importador. */
export function AvecRoboForm({ ativo, hora, last }: { ativo: boolean; hora: number; last: AvecRoboLastView }) {
  const [on, setOn] = useState(ativo);
  const [h, setH] = useState(hora);
  const [pending, start] = useTransition();
  const toast = useToast();
  return (
    <section className="rounded-[var(--radius-card)] border border-line bg-paper p-5">
      <h2 className="text-lg font-semibold">Atualização automática</h2>
      <p className="mt-1 text-sm text-graphite">Todo dia o CRM baixa sozinho os relatórios do Avec (reservas, itens, pagamentos, cadastros) e importa, igual ao envio manual em Relatórios.</p>
      <p className="mt-3 rounded-[var(--radius-control)] bg-paper-2/70 px-4 py-3 text-sm" role="status">
        {last
          ? <>Última atualização automática: <strong>{when(last.em)}</strong> ({last.ok ? "ok" : "com erro"}), {last.relatorios} relatórios, {last.linhasNovas} registros novos ou atualizados.
              {!last.ok && <span className="mt-1 block text-xs text-graphite">{last.erros.slice(0, 3).join(" · ")}</span>}</>
          : "Ainda não rodou."}
      </p>
      <div className="mt-4 flex items-center justify-between gap-3 rounded-[var(--radius-control)] border border-line px-4 py-3">
        <span className="text-sm">Atualizar automaticamente<span className="block text-xs text-muted">Desligado: nada é baixado; o envio manual continua valendo.</span></span>
        <Switch checked={on} label="Atualizar automaticamente" onChange={setOn} />
      </div>
      <label className="mt-3 flex items-center justify-between gap-3 rounded-[var(--radius-control)] border border-line px-4 py-3 text-sm">
        <span>Horário (Salvador)</span>
        <select value={h} onChange={(e) => setH(Number(e.target.value))} className="rounded-[var(--radius-control)] border border-line-strong bg-paper px-3 py-1.5" aria-label="Horário da atualização">
          {Array.from({ length: 24 }, (_, i) => <option key={i} value={i}>{String(i).padStart(2, "0")}:00</option>)}
        </select>
      </label>
      <div className="mt-5 flex justify-end">
        <Button loading={pending} disabled={on === ativo && h === hora} onClick={() => start(async () => {
          const r = await saveAvecRoboAction({ ativo: on, hora: h });
          toast(r.ok ? "Atualização automática salva" : r.error, r.ok ? "ok" : "error");
        })}>Salvar</Button>
      </div>
    </section>
  );
}
