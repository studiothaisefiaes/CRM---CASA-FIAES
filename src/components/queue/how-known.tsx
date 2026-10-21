"use client";
import { useMemo, useRef, useState } from "react";
import type { DealDetail } from "@/server/queries/deal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { originChoices } from "@/lib/origin-choices";
import { cn } from "@/lib/cn";
import type { LeadActions } from "./use-lead-actions";

const CHIP = "inline-flex min-h-11 items-center rounded-full border px-3.5 text-sm font-medium select-none transition-colors lg:min-h-9";

/**
 * "Como conheceu?": aparece quando a origem do lead é "Não identificada". Um toque numa opção grava a origem (com a auditoria de/para);
 * "Outra" pede o texto. Depois de salvar, o painel e a Fila passam a mostrar a origem e a pergunta some.
 */
export function HowKnown({ d, actions, compact = false }: { d: DealDetail; actions: LeadActions; /** Painel Agora: uma linha-pergunta enxuta. */ compact?: boolean }) {
  const choices = useMemo(() => originChoices(d.sources, d.origins), [d.sources, d.origins]);
  const [other, setOther] = useState(false);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sending = useRef(false);

  const save = async (key: string, choice: { sourceId: string } | { origin: string }) => {
    if (sending.current) return;
    sending.current = true; setSaving(key); setError(null);
    const ok = await actions.setOrigin(choice);
    sending.current = false; setSaving(null);
    if (!ok) setError("Não foi possível salvar. Tente de novo.");
  };
  const saveOther = () => {
    const v = text.trim();
    if (!v) { setError("Escreva como a cliente conheceu a Casa."); return; }
    if (v.length > 40) { setError("Use até 40 caracteres."); return; }
    void save("outra", { origin: v });
  };

  return (
    <section aria-labelledby="como-conheceu" data-testid="como-conheceu" className={cn("flex flex-col", compact ? "gap-1.5" : "gap-2.5 rounded-[var(--radius-card)] border border-gold/50 bg-gold-soft/60 px-3.5 py-3")}>
      <h4 id="como-conheceu" className={compact ? "text-xs font-semibold text-graphite" : "font-display text-lg leading-tight text-ink"}>Como conheceu a Casa?</h4>
      <div role="group" aria-labelledby="como-conheceu" className={cn("flex flex-wrap", compact ? "gap-1.5 [&>button]:min-h-8 [&>button]:px-2.5 [&>button]:text-sm pointer-coarse:[&>button]:min-h-11" : "gap-2")}>
        {choices.map((c) => (
          <button key={c.key} type="button" disabled={!!saving} aria-busy={saving === c.key || undefined}
            onClick={() => void save(c.key, c.sourceId ? { sourceId: c.sourceId } : { origin: c.label })}
            className={cn(CHIP, "border-control bg-paper text-ink hover:border-ink disabled:opacity-60")}>{c.label}</button>
        ))}
        <button type="button" aria-expanded={other} disabled={!!saving} onClick={() => setOther((v) => !v)}
          className={cn(CHIP, other ? "border-ink bg-ink text-paper" : "border-control bg-paper text-ink hover:border-ink", "disabled:opacity-60")}>Outra</button>
      </div>
      {other && (
        <div className="flex gap-2">
          <label className="min-w-0 flex-1">
            <span className="sr-only">Como a cliente conheceu a Casa</span>
            <Input value={text} maxLength={40} autoFocus autoComplete="off" enterKeyHint="done" placeholder="Ex.: vizinha do salão" onChange={(e) => { setText(e.target.value); setError(null); }}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); saveOther(); } }} className="h-11" />
          </label>
          <Button size="md" className="h-11 shrink-0" loading={saving === "outra"} disabled={!!saving} onClick={saveOther}>Salvar</Button>
        </div>
      )}
      {error && <p role="alert" className="text-sm text-alert">{error}</p>}
    </section>
  );
}
