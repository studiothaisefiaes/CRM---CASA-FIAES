"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveConsentAction } from "@/app/(app)/contatos/consent-actions";
import type { Consent, ConsentKey } from "@/lib/consent";
import { cn } from "@/lib/cn";

const QUESTIONS: { key: ConsentKey; label: string }[] = [
  { key: "whatsapp", label: "Recebe campanhas por WhatsApp?" },
  { key: "ai", label: "Pode ser atendida com ajuda da IA?" },
  { key: "cpfNota", label: "Quer CPF na nota?" },
];
const OPTIONS: { value: boolean | null; label: string }[] = [{ value: true, label: "Sim" }, { value: false, label: "Não" }, { value: null, label: "Não perguntado" }];

/** "O que ela aceita" na ficha: três perguntas, cada uma Sim, Não ou não perguntado. Sem a permissão, só mostra as respostas. */
export function ConsentBlock({ contactId, value, canEdit }: { contactId: string; value: Consent; canEdit: boolean }) {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const pick = (key: ConsentKey, v: boolean | null) => start(async () => {
    const r = await saveConsentAction(contactId, { [key]: v });
    if (!r.ok) { setErr(r.error); return; }
    setErr(null); router.refresh();
  });
  return (
    <section aria-label="O que ela aceita" data-bloco="consentimento" className="flex flex-col gap-3 rounded-[14px] border border-line bg-paper p-4">
      <h3 className="text-sm font-semibold text-ink">O que ela aceita</h3>
      {QUESTIONS.map((q) => (
        <div key={q.key} role="radiogroup" aria-label={q.label} className="flex flex-col gap-1.5">
          <p className="text-sm text-graphite">{q.label}</p>
          <div className="flex flex-wrap gap-1.5">
            {OPTIONS.map((o) => {
              const on = value[q.key] === o.value;
              return (
                <button key={o.label} type="button" role="radio" aria-checked={on} disabled={!canEdit || pending} onClick={() => { if (!on) pick(q.key, o.value); }}
                  className={cn("min-h-9 rounded-full border px-3 text-sm font-medium transition-colors disabled:cursor-default pointer-coarse:min-h-11",
                    on ? "border-ink bg-ink text-paper" : "border-line-strong bg-paper text-ink hover:border-ink disabled:hover:border-line-strong disabled:opacity-60")}>{o.label}</button>
              );
            })}
          </div>
        </div>
      ))}
      {err && <p role="alert" className="text-sm text-alert">{err}</p>}
    </section>
  );
}
