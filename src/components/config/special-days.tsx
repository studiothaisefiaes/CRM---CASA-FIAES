"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { SaveButton } from "@/components/ui/save-button";
import { useToast } from "@/components/ui/toast";
import { saveSpecialDaysAction } from "@/app/(app)/config/etapas/actions";
import type { SpecialDay } from "@/lib/special-days";

// Lista em 24 h, de meia em meia hora (o campo "time" do navegador mostra 12 h em alguns aparelhos).
const SLOTS = Array.from({ length: 49 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`);
const field = "h-9 rounded-[9px] border border-control bg-paper px-2 text-sm tabular";
const norm = (d: SpecialDay[]) => JSON.stringify(d.map((x) => ({ day: x.day, window: x.window, text: x.text?.trim() || null })));

/** Dias especiais: feriado (Casa fechada) ou horário reduzido em dias avulsos. Valem para mensagens, prazos e Agenda. */
export function SpecialDaysEditor({ days, today, diasAFrente, ligada = true }: { days: SpecialDay[]; today: string; diasAFrente: number; ligada?: boolean }) {
  const initial = days.filter((d) => d.day >= today);
  const [rows, setRows] = useState<SpecialDay[]>(initial);
  const [saved, setSaved] = useState(initial);
  const [pending, start] = useTransition(); const toast = useToast();
  const dirty = norm(rows) !== norm(saved);
  const set = (i: number, patch: Partial<SpecialDay>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const save = () => start(async () => {
    const r = await saveSpecialDaysAction(rows);
    if (!r.ok) { toast(r.error, "error"); return; }
    setSaved(rows);
    toast(r.agenda === "consulta" ? "Dias salvos. A Agenda está só em consulta: o bloqueio não foi criado." : "Dias especiais salvos", "ok");
  });
  return (
    <section className="rounded-[var(--radius-card)] border border-line bg-paper p-5 mb-6" aria-labelledby="dias-especiais-titulo">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="dias-especiais-titulo" className="text-lg font-semibold">Em que dias a Casa abre diferente?</h2>
          <p className="text-sm text-graphite mt-1 max-w-[62ch]">Feriado ou horário reduzido. Vale para as mensagens, para os prazos e para a Agenda: dia fechado bloqueia a Casa inteira. Até {diasAFrente} dias à frente.</p>
          {!ligada && <p className="text-sm text-alert mt-2">A função Dias especiais está desligada em Configurações › Recursos: nada disto vale enquanto estiver assim.</p>}
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={() => setRows([...rows, { day: today, window: null, text: null }])}>Adicionar dia</Button>
          <SaveButton size="sm" dirty={dirty} disabled={!ligada} loading={pending} onClick={save}>Salvar dias</SaveButton>
        </div>
      </div>
      {rows.length === 0 ? <p className="mt-4 text-sm text-muted">Nenhum dia especial. A Casa segue o horário da semana.</p> : (
        <ul className="mt-4 space-y-4">
          {rows.map((r, i) => (
            <li key={i} className="rounded-[12px] border border-line p-3 grid gap-2">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <input type="date" aria-label={`Data do dia especial ${i + 1}`} className={field} min={today} value={r.day} onChange={(e) => set(i, { day: e.target.value })} />
                <select aria-label={`Como a Casa fica em ${r.day}`} className={field} value={r.window ? "reduzido" : "fechada"}
                  onChange={(e) => set(i, { window: e.target.value === "fechada" ? null : ["08:00", "13:00"] })}>
                  <option value="fechada">Fechada</option>
                  <option value="reduzido">Horário reduzido</option>
                </select>
                {r.window && (
                  <span className="flex items-center gap-2">
                    <span className="text-sm text-muted">Das</span>
                    <select aria-label={`Abre em ${r.day}`} className={field} value={r.window[0]} onChange={(e) => set(i, { window: [e.target.value, r.window![1]] })}>{SLOTS.map((t) => <option key={t}>{t}</option>)}</select>
                    <span className="text-sm text-muted">às</span>
                    <select aria-label={`Fecha em ${r.day}`} className={field} value={r.window[1]} onChange={(e) => set(i, { window: [r.window![0], e.target.value] })}>{SLOTS.map((t) => <option key={t}>{t}</option>)}</select>
                  </span>
                )}
                <Button size="sm" variant="ghost" onClick={() => setRows(rows.filter((_, j) => j !== i))}>Remover dia</Button>
              </div>
              <label className="grid gap-1 text-sm">
                <span className="text-graphite">Texto para quem escrever nesse dia (opcional)</span>
                <textarea aria-label={`Texto do dia ${r.day}`} rows={2} maxLength={600} className="rounded-[9px] border border-control bg-paper px-2 py-1.5 text-sm"
                  placeholder="Deixe em branco para usar a Resposta fora do horário de sempre" value={r.text ?? ""} onChange={(e) => set(i, { text: e.target.value || null })} />
              </label>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
