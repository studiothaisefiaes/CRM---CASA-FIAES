"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveFichaAnswerAction } from "@/app/(app)/contatos/actions";
import { AnswerInput } from "./answer-input";
import { blankAnswer, sameAnswer, type StepQuestion } from "@/lib/ficha-view";
import type { AnswerValue } from "@/lib/fichas";

/** Um Campo da ficha no "Editar dados": salva sozinho ao sair do campo (ou ao escolher), como os outros campos dali. */
export function CampoField({ contactId, q }: { contactId: string; q: StepQuestion }) {
  const router = useRouter();
  const [value, setValue] = useState<AnswerValue | null>(q.value);
  const saved = useRef<AnswerValue | null>(q.value);
  const [state, setState] = useState<"idle" | "saved">("idle");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const commit = (v: AnswerValue | null) => {
    if (sameAnswer(v, saved.current)) { setErr(null); return; }
    start(async () => {
      const r = await saveFichaAnswerAction({ contactId, questionId: q.id, value: blankAnswer(v) ? null : v });
      if (!r.ok) { setErr(r.error); return; }
      saved.current = v; setErr(null); setState("saved"); setTimeout(() => setState("idle"), 1600);
      router.refresh();
    });
  };
  return (
    <div className="flex flex-col gap-1" data-campo-ficha={q.id}>
      <AnswerInput q={q} value={value} onChange={setValue} onCommit={commit} disabled={pending} compact />
      {state === "saved" && <span role="status" className="text-xs font-medium text-ok">salvo</span>}
      {err && <p role="alert" className="text-sm text-alert">{err}</p>}
    </div>
  );
}
