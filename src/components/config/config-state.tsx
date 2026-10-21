import type { ConfigState } from "@/lib/config-tabs";
import { cn } from "@/lib/cn";

/**
 * O estado de uma configuração, para bater o olho: ligado (verde, bolinha cheia), desligado (cinza, bolinha vazia),
 * quebrado (vermelho, só o WhatsApp caído) ou só o resumo do que vale ("38 respostas").
 */
export function ConfigStatePill({ state, className }: { state: ConfigState; className?: string }) {
  if (state.on == null && !state.alert) return <span className={cn("text-sm text-graphite tabular-nums", className)}>{state.text}</span>;
  const tone = state.alert ? "bg-alert-soft text-alert" : state.on ? "bg-ok-soft text-ok" : "bg-paper-2 text-graphite";
  return (
    <span data-state={state.alert ? "alerta" : state.on ? "ligado" : "desligado"}
      className={cn("inline-flex min-h-7 items-center gap-1.5 rounded-full px-2.5 text-sm font-semibold whitespace-nowrap", tone, className)}>
      <span aria-hidden className={cn("size-2 rounded-full", state.alert ? "bg-alert" : state.on ? "bg-ok" : "border-[1.5px] border-graphite")} />
      {state.text}
    </span>
  );
}
