"use client";
import { useId, useRef, useState } from "react";
import { Input } from "@/components/ui/field";
import { firstName } from "@/lib/authorship";
import { cn } from "@/lib/cn";
import type { AuxPreview } from "@/server/domain/agenda/appointment-assistants";

export type AuxOption = { id: string; name: string; assistantOf?: string | null };
const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
/** Teto da tela, igual ao do servidor (`MAX_AUXILIARES`). */
export const MAX_AUX = 6;

/**
 * Auxiliares de um serviço da folha Marcar (0089): quantas a Casa quiser. As fixas de quem atende (`assistantOf`) vêm primeiro, num
 * toque ("+ Sidney"); "+ Outra auxiliar" abre a busca por nome. Cada escolhida vira um chip com ×; quem não está livre no período
 * ganha o aviso do motor logo abaixo (`preview`). Passando do que a comanda aceita, avisa quem fica só na agenda. Esc fecha só a busca.
 */
export function AuxiliariesField({ index, mainId, mainName, options, value, onChange, preview = [], comandaMax = null }: {
  index: number; mainId: string; mainName: string | null; options: AuxOption[]; value: string[]; onChange: (ids: string[]) => void;
  preview?: AuxPreview[]; comandaMax?: number | null;
}) {
  const uid = useId();
  const [searching, setSearching] = useState(false);
  const [q, setQ] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const pool = options.filter((p) => p.id !== mainId && !value.includes(p.id));
  const fixed = mainId ? pool.filter((p) => p.assistantOf === mainId) : [];
  const term = fold(q.trim());
  const hits = term ? pool.filter((p) => fold(p.name).includes(term)).slice(0, 8) : [];
  const nameOf = (id: string) => options.find((p) => p.id === id)?.name ?? "Auxiliar";
  const full = value.length >= MAX_AUX;
  const add = (id: string) => { onChange([...value, id]); setQ(""); setSearching(false); };
  const warn = preview.filter((p) => p.state !== "livre" && value.includes(p.professionalId));
  const over = comandaMax != null && value.length > comandaMax ? value.slice(comandaMax).map((id) => firstName(nameOf(id)) ?? nameOf(id)) : [];

  return (
    <div className="flex flex-col gap-2" role="group" aria-labelledby={`${uid}-t`}>
      <p id={`${uid}-t`} className="text-sm text-graphite">Auxiliares <span className="text-muted">· opcional</span></p>
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label={`Auxiliares do serviço ${index + 1}`}>
          {value.map((id) => {
            const st = preview.find((p) => p.professionalId === id)?.state;
            return (
              <li key={id} data-auxiliar={id} className={cn("inline-flex h-9 items-center gap-1 rounded-full pl-3 pr-1 text-sm",
                st && st !== "livre" ? "bg-alert-soft text-alert" : "bg-paper-2 text-ink-2")}>
                {nameOf(id)}
                <button type="button" aria-label={`Tirar ${nameOf(id)} das auxiliares`} onClick={() => onChange(value.filter((x) => x !== id))}
                  className="inline-flex size-7 items-center justify-center rounded-full text-base leading-none hover:bg-paper-3 pointer-coarse:size-9">×</button>
              </li>
            );
          })}
        </ul>
      )}
      {warn.map((w) => <p key={w.professionalId} role="status" className="text-sm text-alert">{w.text}</p>)}
      {over.length > 0 && (
        <p className="text-sm text-gold-ink">{`A comanda aceita até ${comandaMax} ${comandaMax === 1 ? "assistente" : "assistentes"} por serviço: ${over.join(", ")} ${over.length === 1 ? "fica" : "ficam"} só na agenda.`}</p>
      )}
      {!full && (fixed.length > 0 || pool.length > 0) && (
        <div className="flex flex-wrap items-center gap-2">
          {fixed.length > 0 && <span className="text-xs text-muted">{`Fixas da ${firstName(mainName) ?? "profissional"}:`}</span>}
          {fixed.map((p) => (
            <button key={p.id} type="button" aria-label={`Pôr ${p.name} de auxiliar`} onClick={() => add(p.id)}
              className="inline-flex h-9 items-center rounded-full border border-line-strong px-3 text-sm text-ink-2 hover:bg-paper-2">+ {p.name}</button>
          ))}
          {!searching && pool.length > fixed.length && (
            <button type="button" onClick={() => { setSearching(true); setTimeout(() => input.current?.focus(), 0); }}
              className="inline-flex h-9 items-center rounded-full px-2 text-sm font-medium text-gold-ink hover:underline">{fixed.length ? "+ Outra auxiliar" : "+ Auxiliar"}</button>
          )}
        </div>
      )}
      {searching && !full && (
        <div className="flex flex-col gap-1.5">
          <Input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nome da auxiliar" aria-label={`Buscar auxiliar do serviço ${index + 1}`} className="h-11"
            onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); setSearching(false); setQ(""); } if (e.key === "Enter" && hits[0]) { e.preventDefault(); add(hits[0].id); } }} />
          {term && (hits.length ? (
            <ul className="flex flex-col overflow-hidden rounded-[var(--radius-control)] border border-line">
              {hits.map((p) => (
                <li key={p.id}>
                  <button type="button" onClick={() => add(p.id)} className="flex min-h-11 w-full items-center justify-between gap-3 px-3 text-left text-sm hover:bg-paper-2">
                    <span>{p.name}</span>
                    {p.assistantOf === mainId && <span className="text-xs text-muted">fixa</span>}
                  </button>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-muted">Ninguém com esse nome.</p>)}
        </div>
      )}
    </div>
  );
}
