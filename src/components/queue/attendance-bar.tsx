"use client";
import { IconCheck, IconClose } from "@/components/icons";
import { attendanceLabel } from "@/lib/field-labels";
import { cn } from "@/lib/cn";

/**
 * "Compareceu" / "Faltou" do lead Agendado. O botão do valor já registrado fica marcado (`aria-pressed`) e dá para corrigir tocando no outro.
 * Faltou cria a próxima ação "Remarcar" (o servidor decide).
 */
export function AttendanceBar({ attendance, busy, onPick }: { attendance: string | null; busy: boolean; onPick: (s: "compareceu" | "faltou") => void }) {
  const done = attendance === "compareceu" || attendance === "faltou";
  return (
    <div role="group" aria-label="Comparecimento" className="flex flex-col gap-2">
      <p className="text-sm text-graphite">{done ? `Comparecimento: ${attendanceLabel(attendance)}` : attendance === "confirmado" ? "Confirmou o horário. Compareceu?" : "Compareceu?"}</p>
      <div className="grid grid-cols-2 gap-2">
        {([["compareceu", "Compareceu", IconCheck], ["faltou", "Faltou", IconClose]] as const).map(([value, label, Icon]) => {
          const on = attendance === value;
          return (
            <button key={value} type="button" aria-pressed={on} disabled={busy || on} onClick={() => onPick(value)}
              className={cn("inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[var(--radius-control)] border text-sm font-medium transition-colors disabled:cursor-default lg:min-h-10",
                on ? (value === "compareceu" ? "border-ok bg-ok-soft text-ok" : "border-alert bg-alert-soft text-alert") : "border-line-strong bg-paper text-ink hover:bg-paper-2 disabled:opacity-60")}>
              <Icon size={15} aria-hidden />{label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
