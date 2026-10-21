"use client";
import { useState, useTransition } from "react";
import { SaveButton } from "@/components/ui/save-button";
import { useToast } from "@/components/ui/toast";
import { saveAgendaSettingsAction } from "@/app/(app)/config/actions";
import { STEP_OPTIONS, type AgendaMode } from "@/lib/agenda-settings";
import { cn } from "@/lib/cn";

const MODES: { value: AgendaMode; title: string; text: string }[] = [
  { value: "consulta", title: "Só consulta", text: "Como hoje: o CRM mostra a agenda, mas não marca, não remarca, não bloqueia e não põe na lista de espera. Status, observação e cancelamento continuam valendo. Use enquanto o Avec for a agenda que a cliente vê." },
  { value: "dupla", title: "Nos dois sistemas", text: "Tudo ligado no CRM. Até a troca para o CRM, a equipe marca, remarca, bloqueia e cancela também no Avec, e o CRM lembra disso a cada vez." },
  { value: "so_crm", title: "Só CRM", text: "A troca para o CRM foi feita: a agenda da Casa é só a do CRM, sem o lembrete do Avec." },
];

/**
 * Configurações › Agenda: o modo (consulta, dupla, só CRM) e o passo da grade e das sugestões.
 * `parts` mostra só um dos dois (F5: o modo fica na Área de cuidado, o passo em Agenda e caixa); o que não aparece é salvo como está.
 */
export function AgendaSettingsForm({ mode, passoMin, parts = "tudo" }: { mode: AgendaMode; passoMin: number; parts?: "tudo" | "modo" | "passo" }) {
  const [m, setM] = useState(mode);
  const [step, setStep] = useState(passoMin);
  const [pending, start] = useTransition();
  const toast = useToast();
  const dirty = m !== mode || step !== passoMin;
  return (
    <section className="rounded-[var(--radius-card)] border border-line bg-paper p-5">
      {parts !== "passo" && <>
      <h2 className="text-lg font-semibold">Modo da agenda</h2>
      <p className="mt-1 max-w-[62ch] text-sm text-graphite">Enquanto o agendamento online e a Avec IA estiverem ligados no Avec, um horário marcado só no CRM fica livre lá e uma cliente pode marcar por cima.</p>
      <fieldset className="mt-4 grid gap-2.5">
        <legend className="sr-only">Modo da agenda</legend>
        {MODES.map((o) => (
          <label key={o.value} className={cn("flex cursor-pointer items-start gap-3 rounded-[var(--radius-control)] border px-4 py-3 transition-colors",
            m === o.value ? "border-ink bg-paper-2/70" : "border-line-strong hover:bg-paper-2/50")}>
            <input type="radio" name="agenda-modo" value={o.value} checked={m === o.value} onChange={() => setM(o.value)} className="mt-1 size-4 accent-[var(--color-ink)]" />
            <span className="flex flex-col gap-0.5">
              <span className="text-base font-medium">{o.title}{o.value === mode && <span className="ml-2 text-sm font-normal text-muted">(agora)</span>}</span>
              <span className="text-sm text-graphite">{o.text}</span>
            </span>
          </label>
        ))}
      </fieldset>
      </>}
      <div className={cn("flex flex-wrap items-end justify-between gap-4", parts !== "passo" && "mt-5")}>
        {parts !== "modo" ? <div className="flex flex-col gap-1.5 text-sm">
          <label htmlFor="agenda-passo" className="font-medium text-graphite">Passo da grade e das sugestões</label>
          <select id="agenda-passo" value={step} onChange={(e) => setStep(Number(e.target.value))} aria-describedby="agenda-passo-dica"
            className="h-11 w-36 rounded-[var(--radius-control)] border border-control bg-paper px-3 text-base text-ink lg:h-10">
            {STEP_OPTIONS.map((s) => <option key={s} value={s}>{s} min</option>)}
          </select>
          <p id="agenda-passo-dica" className="text-muted">De quanto em quanto tempo o Procurar horário sugere (09:00, 09:30…).</p>
        </div> : <span />}
        <SaveButton dirty={dirty} loading={pending} onClick={() => start(async () => {
          const r = await saveAgendaSettingsAction({ mode: m, passoMin: step });
          toast(r.ok ? "Agenda salva" : r.error, r.ok ? "ok" : "error");
        })}>Salvar</SaveButton>
      </div>
    </section>
  );
}
