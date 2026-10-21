"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { acceptSuggestionsAction, setProfessionalServiceAction } from "@/app/(app)/config/actions";
import type { WhoSuggestion } from "@/server/domain/agenda/who-does-what";
import { paletteHex } from "@/lib/palette";
import { cn } from "@/lib/cn";

type Pro = { id: string; name: string; serviceIds: string[]; color: string | null };
type Service = { id: string; label: string };

/**
 * Quem faz o quê: uma linha por serviço e uma coluna por profissional ativa. Marcar grava o vínculo na hora (feito à mão). Em dourado, o
 * que o histórico do Avec sugere (2 vezes ou mais em 12 meses), com quantas vezes; "Aceitar todas as sugestões" grava todas.
 */
export function WhoDoesWhat({ pros, services, suggestions }: { pros: Pro[]; services: Service[]; suggestions: WhoSuggestion[] }) {
  // O que a pessoa acabou de marcar, por cima do que veio do servidor (que chega atualizado depois do revalidate).
  const [overlay, setOverlay] = useState<Map<string, boolean>>(new Map());
  const [pending, start] = useTransition();
  const toast = useToast();
  const base = new Set(pros.flatMap((p) => p.serviceIds.map((s) => `${p.id}|${s}`)));
  const sugg = new Map(suggestions.map((s) => [`${s.professionalId}|${s.serviceId}`, s.count]));
  const isOn = (key: string) => overlay.get(key) ?? base.has(key);

  const toggle = (p: Pro, s: Service, on: boolean) => {
    const key = `${p.id}|${s.id}`;
    setOverlay((m) => new Map(m).set(key, on));
    start(async () => {
      const r = await setProfessionalServiceAction(p.id, s.id, on);
      if (!r.ok) { setOverlay((m) => { const n = new Map(m); n.delete(key); return n; }); toast(r.error, "error"); }
    });
  };

  if (!pros.length) return <p className="rounded-[var(--radius-card)] border border-line bg-paper px-4 py-6 text-sm text-graphite">Nenhuma profissional ativa. Cadastre ou reative na aba Profissionais.</p>;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-[62ch] text-sm text-graphite">Marque quem faz cada serviço: ao procurar horário, só aparecem as profissionais marcadas. Em dourado, o que o histórico do Avec sugere (2 vezes ou mais em 12 meses).</p>
        {suggestions.length > 0 && (
          <Button variant="gold" loading={pending} onClick={() => start(async () => {
            const r = await acceptSuggestionsAction({});
            toast(r.ok ? `${r.data?.added ?? 0} ${r.data?.added === 1 ? "vínculo novo" : "vínculos novos"} do histórico do Avec` : r.error, r.ok ? "ok" : "error");
          })}>Aceitar todas as sugestões ({suggestions.length})</Button>
        )}
      </div>
      <div className="scroll-thin max-h-[70dvh] overflow-auto rounded-[var(--radius-card)] border border-line bg-paper">
        <table className="min-w-max border-collapse text-sm">
          <thead>
            <tr>
              <th scope="col" className="sticky left-0 top-0 z-20 border-b border-r border-line bg-paper px-3 py-2 text-left font-medium text-graphite">Serviço</th>
              {pros.map((p) => (
                <th key={p.id} scope="col" className="sticky top-0 z-10 border-b border-line bg-paper px-2 py-2 text-center font-semibold">
                  <span className="inline-flex items-center gap-1.5">
                    {paletteHex(p.color) && <span aria-hidden className="size-2.5 rounded-full" style={{ background: paletteHex(p.color)! }} />}
                    {p.name}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {services.map((s) => (
              <tr key={s.id} className="border-b border-line/70 last:border-0">
                <th scope="row" className="sticky left-0 z-10 max-w-[14rem] truncate border-r border-line bg-paper px-3 py-1.5 text-left font-medium">{s.label}</th>
                {pros.map((p) => {
                  const key = `${p.id}|${s.id}`, on = isOn(key), count = sugg.get(key);
                  const suggested = !!count && !on;
                  return (
                    <td key={p.id} className={cn("px-2 py-1 text-center", suggested && "bg-gold-soft/70")}>
                      <label className="inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center gap-1 lg:min-h-8 lg:min-w-8">
                        <input type="checkbox" className="size-5 accent-[var(--color-ink)]" checked={on} onChange={(e) => toggle(p, s, e.target.checked)}
                          aria-label={`${p.name} faz ${s.label}${suggested ? ` (sugestão: fez ${count} vezes em 12 meses)` : ""}`} />
                        {suggested && <span aria-hidden className="text-xs font-semibold text-gold-ink tabular">{count}×</span>}
                      </label>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
