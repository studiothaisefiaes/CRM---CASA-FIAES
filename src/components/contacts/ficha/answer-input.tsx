"use client";
import { useId } from "react";
import { Input, Textarea } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import { Button } from "@/components/ui/button";
import { LONG_TEXT_MAX, TEXT_MAX, type AnswerValue } from "@/lib/fichas";
import { blankAnswer, type StepQuestion } from "@/lib/ficha-view";

const SIM_NAO = [{ value: "sim", label: "Sim" }, { value: "nao", label: "Não" }];

/**
 * O campo de uma pergunta das fichas, do tipo certo: texto, texto longo, data, uma opção, várias opções, sim ou não.
 * O texto da pergunta é o rótulo do campo. `onCommit` avisa quando a pessoa termina de escolher/digitar (sair do campo ou escolher),
 * para o "Editar dados" salvar sozinho; o passo a passo só usa `onChange`.
 */
export function AnswerInput({ q, value, onChange, onCommit, disabled, compact }: {
  q: StepQuestion; value: AnswerValue | null; onChange: (v: AnswerValue | null) => void; onCommit?: (v: AnswerValue | null) => void; disabled?: boolean; compact?: boolean;
}) {
  const id = useId();
  const text = typeof value === "string" ? value : "";
  const list = Array.isArray(value) ? value : [];
  const labelCls = compact ? "text-xs text-muted" : "text-lg font-semibold leading-snug text-ink";
  const group = q.kind === "opcao" || q.kind === "caixas" || q.kind === "sim_nao";
  const choose = (v: AnswerValue | null) => { onChange(v); onCommit?.(v); };
  return (
    <div className="flex flex-col gap-2.5">
      {group ? <p id={`${id}-l`} className={labelCls}>{q.label}</p> : <label htmlFor={id} className={labelCls}>{q.label}</label>}
      {q.kind === "texto" && <Input id={id} value={text} maxLength={TEXT_MAX} disabled={disabled} onChange={(e) => onChange(e.target.value)} onBlur={() => onCommit?.(value)} />}
      {q.kind === "texto_longo" && <Textarea id={id} value={text} rows={5} maxLength={LONG_TEXT_MAX} disabled={disabled} onChange={(e) => onChange(e.target.value)} onBlur={() => onCommit?.(value)} />}
      {q.kind === "data" && <Input id={id} type="date" min="1900-01-01" value={text} disabled={disabled} onChange={(e) => onChange(e.target.value)} onBlur={() => onCommit?.(value)} />}
      {q.kind === "sim_nao" && <Segmented options={SIM_NAO} value={text || null} labelledBy={`${id}-l`} onChange={choose} />}
      {q.kind === "opcao" && <Segmented options={q.options.map((o) => ({ value: o, label: o }))} value={text || null} labelledBy={`${id}-l`} onChange={choose} />}
      {q.kind === "caixas" && (
        <div role="group" aria-labelledby={`${id}-l`} className="flex flex-col gap-1">
          {q.options.map((o) => (
            <label key={o} className="flex min-h-11 items-center gap-2.5 text-base text-ink lg:min-h-9">
              <input type="checkbox" className="size-4 accent-[var(--color-ink)]" checked={list.includes(o)} disabled={disabled}
                onChange={(e) => choose((() => { const next = e.target.checked ? [...list, o] : list.filter((x) => x !== o); return next.length ? next : null; })())} />
              {o}
            </label>
          ))}
        </div>
      )}
      {group && !blankAnswer(value) && !disabled && (
        <div><Button variant="ghost" size="sm" onClick={() => choose(null)}>Limpar resposta</Button></div>
      )}
    </div>
  );
}
