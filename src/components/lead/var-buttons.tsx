"use client";
import type { RefObject } from "react";
import { REPLY_VAR_HELP } from "@/lib/quick-reply";

/** Põe `token` onde está o cursor do campo (ou no fim) e devolve o texto novo; o cursor vai para depois do token. */
export function insertToken(el: HTMLTextAreaElement | null, value: string, token: string): string {
  const start = el?.selectionStart ?? value.length, end = el?.selectionEnd ?? value.length;
  const next = value.slice(0, start) + token + value.slice(end);
  if (el) requestAnimationFrame(() => { el.focus(); el.setSelectionRange(start + token.length, start + token.length); });
  return next;
}

/** Botões das variáveis ao escrever uma resposta pronta: um toque põe {primeiro_nome}, {saudacao}… no cursor. */
export function VarButtons({ target, value, onChange }: { target: RefObject<HTMLTextAreaElement | null>; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Variáveis">
      {REPLY_VAR_HELP.map((v) => (
        <button key={v.token} type="button" title={`${v.token}: ${v.label}`} onMouseDown={(e) => e.preventDefault()}
          onClick={() => onChange(insertToken(target.current, value, v.token))}
          className="h-8 rounded-full border border-line bg-paper px-3 text-sm text-graphite hover:border-gold hover:text-ink">
          {v.button}
        </button>
      ))}
    </div>
  );
}
