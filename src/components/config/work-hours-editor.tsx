"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { setWorkHoursAction } from "@/app/(app)/config/actions";
import type { BusinessHours } from "@/lib/business-hours";
import {
  casaAsWorkHours, daysOutsideCasa, summarizeWorkHours, WEEK_ORDER, WEEKDAY_LONG, workHoursSchema, type DayKey, type WorkHours, type WorkRange,
} from "@/lib/work-hours";

const pad = (n: number) => String(n).padStart(2, "0");
// De 06:00 a 24:00, de 15 em 15 min. Lista em 24 h: o campo "time" do navegador mostra 12 h em alguns aparelhos e corta o "PM".
const TIMES = Array.from({ length: (24 - 6) * 4 + 1 }, (_, i) => { const m = 360 + i * 15; return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`; });
const timesWith = (v: string) => (TIMES.includes(v) ? TIMES : [...TIMES, v].sort());
const SELECT = "h-11 w-[5.5rem] rounded-[9px] border border-control bg-paper px-2 text-base tabular text-ink lg:h-9 lg:text-sm";

/** "na segunda e no domingo" */
const onDays = (days: string[]) => {
  const one = (d: string) => (d === "domingo" || d === "sábado" ? `no ${d}` : `na ${d}`);
  const parts = days.map(one);
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} e ${parts.at(-1)}` : parts[0];
};

/**
 * Horário de trabalho de uma profissional (Configurações › Profissionais): os 7 dias com liga e desliga, "das … às …" e intervalo
 * opcional (2 faixas). Sem horário próprio ela segue o da Casa; "Igual ao da Casa" apaga o próprio. Trabalhar num dia em que a Casa
 * fecha pergunta antes de salvar. O servidor valida de novo.
 */
export function WorkHoursEditor({ professionalId, name, value, casa }: { professionalId: string; name: string; value: WorkHours | null; casa: BusinessHours }) {
  const [draft, setDraft] = useState<WorkHours | null>(value);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ days: string[]; hours: WorkHours } | null>(null);
  const [pending, start] = useTransition();
  const toast = useToast();
  const casaText = summarizeWorkHours(casaAsWorkHours(casa));

  /** O horário próprio vai das 06:00 às 24:00: a Casa aberta antes disso (24 h) começa às 06:00. */
  const clamp = ([a, b]: WorkRange): WorkRange => [a < "06:00" ? "06:00" : a, b];
  const fromCasa = (): WorkHours => Object.fromEntries(WEEK_ORDER.map((k) => [k, casa[k] ? [clamp(casa[k]!)] : null])) as WorkHours;
  const edit = (k: DayKey, ranges: WorkRange[] | null) => { setDraft((d) => (d ? { ...d, [k]: ranges } : d)); setError(null); setConfirm(null); };
  const save = (hours: WorkHours | null) => start(async () => {
    const r = await setWorkHoursAction(professionalId, hours);
    setConfirm(null);
    if (!r.ok) { setError(r.error); return; }
    toast(hours ? "Horário salvo" : `${name} segue o horário da Casa`);
    if (!hours) setDraft(null);
  });
  const trySave = () => {
    if (!draft) return;
    const parsed = workHoursSchema.safeParse(draft);
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "Confira o horário de trabalho."); return; }
    const outside = daysOutsideCasa(parsed.data, casa);
    if (outside.length) { setConfirm({ days: outside, hours: parsed.data }); return; }
    save(parsed.data);
  };
  /** Ligar um dia: o horário da Casa naquele dia, ou 9h–18h quando a Casa fecha. */
  const dayDefault = (k: DayKey): WorkRange => (casa[k] ? clamp(casa[k]!) : ["09:00", "18:00"]);

  if (!draft) return (
    <div className="flex flex-col items-start gap-3">
      <p className="text-sm text-graphite">{`Segue o horário da Casa: ${casaText}`}</p>
      <Button variant="secondary" onClick={() => setDraft(fromCasa())}>Definir horário próprio</Button>
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      {value && <p className="text-sm text-graphite">{`Horário próprio: ${summarizeWorkHours(value)}`}</p>}
      <ul className="flex flex-col divide-y divide-line/70 rounded-[var(--radius-card)] border border-line">
        {WEEK_ORDER.map((k) => {
          const day = WEEKDAY_LONG[Number(k)];
          const ranges = draft[k];
          const set = (i: number, j: 0 | 1, v: string) => edit(k, (ranges ?? []).map((r, x) => (x === i ? (j === 0 ? [v, r[1]] : [r[0], v]) : r)) as WorkRange[]);
          const range = (i: number, label: string) => (
            <span className="flex items-center gap-1.5">
              <select aria-label={`${label}, das`} className={SELECT} value={ranges![i][0]} onChange={(e) => set(i, 0, e.target.value)}>{timesWith(ranges![i][0]).map((t) => <option key={t}>{t}</option>)}</select>
              <span className="text-sm text-muted">às</span>
              <select aria-label={`${label}, às`} className={SELECT} value={ranges![i][1]} onChange={(e) => set(i, 1, e.target.value)}>{timesWith(ranges![i][1]).map((t) => <option key={t}>{t}</option>)}</select>
            </span>
          );
          return (
            <li key={k} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
              <Switch checked={!!ranges?.length} label={`${day}: trabalha`} onChange={(on) => edit(k, on ? [dayDefault(k)] : null)} />
              <span className="w-[4.5rem] text-sm font-medium">{day}</span>
              {ranges?.length ? (
                <span className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  {range(0, day)}
                  {ranges.length > 1 ? (
                    <>
                      <span className="text-sm text-muted">e</span>
                      {range(1, `${day}, depois do intervalo`)}
                      <button type="button" aria-label={`${day}: tirar intervalo`} onClick={() => edit(k, [[ranges[0][0], ranges[1][1]]])}
                        className="min-h-11 px-1 text-sm text-gold-ink underline-offset-4 hover:underline lg:min-h-8">tirar intervalo</button>
                    </>
                  ) : (
                    <button type="button" aria-label={`${day}: adicionar intervalo`}
                      onClick={() => edit(k, ranges[0][0] < "12:00" && ranges[0][1] > "13:00" ? [[ranges[0][0], "12:00"], ["13:00", ranges[0][1]]] : [ranges[0], ["13:00", "14:00"]])}
                      className="min-h-11 px-1 text-sm text-gold-ink underline-offset-4 hover:underline lg:min-h-8">+ intervalo</button>
                  )}
                </span>
              ) : <span className="text-sm text-muted">Folga{!casa[k] ? " (a Casa não abre)" : ""}</span>}
            </li>
          );
        })}
      </ul>
      {error && <p role="alert" className="text-sm text-alert">{error}</p>}
      {confirm ? (
        <div className="flex flex-wrap items-center justify-end gap-2 rounded-[var(--radius-control)] border border-gold/40 bg-gold-soft/60 px-4 py-3">
          <p className="mr-auto text-sm text-gold-ink">{`A Casa não abre ${onDays(confirm.days)}. Ela vai atender mesmo assim?`}</p>
          <Button variant="ghost" size="sm" onClick={() => setConfirm(null)}>Voltar</Button>
          <Button size="sm" loading={pending} onClick={() => save(confirm.hours)}>Sim, salvar</Button>
        </div>
      ) : (
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" disabled={pending} onClick={() => (value ? save(null) : setDraft(null))}>Igual ao da Casa</Button>
          <Button loading={pending} onClick={trySave}>Salvar horário</Button>
        </div>
      )}
    </div>
  );
}
