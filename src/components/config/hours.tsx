"use client";
import { useState, useTransition } from "react";
import { SaveButton } from "@/components/ui/save-button";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { saveHoursAction } from "@/app/(app)/config/actions";
import type { BusinessHours, DayKey } from "@/lib/business-hours";

// Lista em 24 h, de meia em meia hora: o campo "time" do navegador mostra 12 h em alguns aparelhos e corta o "PM".
const SLOTS = Array.from({ length: 49 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`);
const slotsWith = (v: string) => (SLOTS.includes(v) ? SLOTS : [...SLOTS, v].sort());

const DAYS: [DayKey, string][] = [["1", "Segunda"], ["2", "Terça"], ["3", "Quarta"], ["4", "Quinta"], ["5", "Sexta"], ["6", "Sábado"], ["0", "Domingo"]];

/** Horário de atendimento: o prazo de resposta só conta dentro dele e nenhuma automação dispara fora. */
export function HoursEditor({ hours }: { hours: BusinessHours }) {
  const [h, setH] = useState(hours);
  const [pending, start] = useTransition(); const toast = useToast();
  const dirty = JSON.stringify(h) !== JSON.stringify(hours);
  const time = "h-9 w-[84px] rounded-[9px] border border-control bg-paper px-2 text-sm tabular disabled:opacity-40";
  return (
    <section className="rounded-[var(--radius-card)] border border-line bg-paper p-5 mb-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Horário de atendimento</h2>
          <p className="text-sm text-graphite mt-1 max-w-[62ch]">O prazo de resposta só corre dentro deste horário. Fora dele, nenhum alerta toca e nenhuma conversa muda de etapa: tudo espera a Casa abrir.</p>
        </div>
        <SaveButton size="sm" dirty={dirty} loading={pending} onClick={() => start(async () => { const r = await saveHoursAction(h); toast(r.ok ? "Horário salvo" : r.error, r.ok ? "ok" : "error"); })}>Salvar horário</SaveButton>
      </div>
      <ul className="mt-4 grid sm:grid-cols-2 gap-x-8 gap-y-2">
        {DAYS.map(([k, label]) => {
          const w = h[k];
          return (
            <li key={k} className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <Switch checked={!!w} label={`${label} aberto`} onChange={(on) => setH({ ...h, [k]: on ? ["08:00", "18:00"] : null })} />
              <span className="w-20 text-sm">{label}</span>
              {w ? (
                <span className="flex items-center gap-2">
                  <select aria-label={`${label} abre`} className={time} value={w[0]} onChange={(e) => setH({ ...h, [k]: [e.target.value, w[1]] })}>{slotsWith(w[0]).map((t) => <option key={t}>{t}</option>)}</select>
                  <span className="text-muted text-sm">às</span>
                  <select aria-label={`${label} fecha`} className={time} value={w[1]} onChange={(e) => setH({ ...h, [k]: [w[0], e.target.value] })}>{slotsWith(w[1]).map((t) => <option key={t}>{t}</option>)}</select>
                </span>
              ) : <span className="text-sm text-muted">Fechado</span>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
