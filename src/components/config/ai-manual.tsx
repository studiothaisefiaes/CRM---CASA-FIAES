"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { SaveButton } from "@/components/ui/save-button";
import { useToast } from "@/components/ui/toast";
import { saveAiManualAction } from "@/app/(app)/config/ia/actions";
import { AI_MANUAL_MAX, MANUAL_SECTIONS, MISSING, approxTokens, countMissing, manualLength, type ManualKey, type ManualSections } from "@/lib/ai-manual";

const when = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Bahia", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

/**
 * "O que a IA sabe sobre a Casa": o Manual da Casa em seções de skill (src/lib/ai-manual.ts). A IA lê tudo isto antes de cada sugestão;
 * "Serviços e preços" vem da aba Serviços. O que a Casa ainda não respondeu fica como [a Casa precisa preencher] e a IA diz que vai confirmar.
 */
export function AiManualForm({ initial, updatedAt }: { initial: ManualSections; updatedAt: string | null }) {
  const [v, setV] = useState<ManualSections>(initial);
  const [saved, setSaved] = useState<ManualSections>(initial);
  const [at, setAt] = useState(updatedAt);
  const [pending, start] = useTransition();
  const toast = useToast();
  const len = manualLength(v), over = len > AI_MANUAL_MAX, missing = countMissing(v);
  const dirty = (Object.keys(v) as ManualKey[]).some((k) => v[k] !== saved[k]);
  const save = () => start(async () => {
    const r = await saveAiManualAction(v);
    if (!r.ok) { toast(r.error, "error"); return; }
    setV(r.data!.secoes); setSaved(r.data!.secoes); setAt(r.data!.updatedAt);
    toast("Manual salvo. A próxima sugestão já usa o texto novo.", "ok");
  });
  return (
    <section aria-labelledby="ia-manual" className="flex min-w-0 flex-col gap-5 rounded-[var(--radius-card)] border border-line bg-paper p-5">
      <div className="flex flex-col gap-1">
        <h2 id="ia-manual" className="text-lg font-semibold">O que a IA sabe sobre a Casa</h2>
        <p className="text-sm text-graphite">A IA lê este manual antes de cada sugestão, como uma skill: escreve do jeito da Casa e não inventa o que não está aqui. Os serviços e preços vêm da aba <Link href="/servicos" className="font-medium text-ink underline underline-offset-4">Serviços</Link>.</p>
        <p className="text-sm text-graphite" aria-live="polite">
          <span className={over ? "font-medium text-alert" : "font-medium text-ink"}>≈ {approxTokens(Object.values(v).join("")).toLocaleString("pt-BR")} tokens</span>
          {" "}· {len.toLocaleString("pt-BR")} de {AI_MANUAL_MAX.toLocaleString("pt-BR")} caracteres
          {missing > 0 && <> · <span className="text-gold-ink">{missing === 1 ? "1 item" : `${missing} itens`} para a Casa preencher</span></>}
          {at && <> · salvo em {when(at)}</>}
        </p>
      </div>
      {MANUAL_SECTIONS.map((s) => {
        const n = (v[s.key].split(MISSING).length - 1);
        const id = `manual-${s.key}`;
        return (
          <div key={s.key} className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <label htmlFor={id} className="text-base font-medium text-ink">{s.title}</label>
              {n > 0 && <span className="text-sm text-gold-ink">{n === 1 ? "1 para preencher" : `${n} para preencher`}</span>}
            </div>
            <p className="text-sm text-muted">{s.hint}</p>
            <textarea id={id} value={v[s.key]} onChange={(e) => setV((x) => ({ ...x, [s.key]: e.target.value }))}
              rows={Math.min(14, Math.max(4, v[s.key].split("\n").length + 1))}
              className="w-full rounded-[var(--radius-control)] border border-control bg-paper px-3 py-2.5 text-md leading-relaxed text-ink transition-[border-color,box-shadow] duration-150 hover:border-graphite focus:border-ink focus:shadow-[0_0_0_3px_rgb(184_134_63/0.22)] focus:outline-none md:text-base" />
          </div>
        );
      })}
      <div className="flex flex-wrap items-center gap-3">
        <SaveButton onClick={save} loading={pending} dirty={dirty} disabled={over}>Salvar o manual</SaveButton>
        {over && <p role="alert" className="text-sm text-alert">Passou do limite: encurte alguma seção.</p>}
        {!over && dirty && <p className="text-sm text-muted">Alterações não salvas.</p>}
      </div>
    </section>
  );
}
