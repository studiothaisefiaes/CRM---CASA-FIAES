"use client";
import { useId, useRef, type KeyboardEvent } from "react";
import { cn } from "@/lib/cn";

export type SegmentedOption<T extends string = string> = { value: T; label: string };

/** Escolha única em chips (ex.: forma de pagamento). Setas movem a seleção; Tab sai do grupo. */
export function Segmented<T extends string = string>({ options, value, onChange, label, labelledBy, className }: {
  options: SegmentedOption<T>[]; value: T | null | undefined; onChange: (v: T) => void;
  /** Nome acessível do grupo, quando não há um rótulo visível apontado por `labelledBy`. */
  label?: string; labelledBy?: string; className?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const groupId = useId();
  const selected = options.findIndex((o) => o.value === value);
  const move = (i: number) => {
    const n = (i + options.length) % options.length;
    onChange(options[n].value);
    refs.current[n]?.focus();
  };
  const onKey = (e: KeyboardEvent, i: number) => {
    if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); move(i + 1); }
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); move(i - 1); }
    else if (e.key === "Home") { e.preventDefault(); move(0); }
    else if (e.key === "End") { e.preventDefault(); move(options.length - 1); }
  };
  return (
    <div role="radiogroup" id={groupId} aria-label={label} aria-labelledby={labelledBy} className={cn("flex flex-wrap gap-2", className)}>
      {options.map((o, i) => {
        const on = i === selected;
        return (
          <button
            key={o.value} ref={(el) => { refs.current[i] = el; }} type="button" role="radio" aria-checked={on}
            tabIndex={on || (selected === -1 && i === 0) ? 0 : -1}
            onClick={() => onChange(o.value)} onKeyDown={(e) => onKey(e, i)}
            className={cn(
              "h-9 px-3.5 rounded-full border text-sm font-medium select-none transition-[background,color,border-color] duration-150 pointer-coarse:min-h-11",
              on ? "bg-ink text-paper border-ink" : "bg-paper text-graphite border-control hover:border-graphite hover:text-ink",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
