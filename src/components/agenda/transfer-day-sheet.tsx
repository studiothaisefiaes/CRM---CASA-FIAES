"use client";
import { useState, useTransition } from "react";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { previewTransferDayAction, transferDayAction } from "@/app/(app)/agenda/actions";
import type { TransferPreview, TransferRow } from "@/server/domain/agenda/transfer-day";

type Pro = { id: string; name: string };
type Step = "de" | "para" | "lista" | "resultado";

const DAY_LABEL = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const dayLabel = (day: string) => DAY_LABEL.format(new Date(`${day}T12:00:00Z`));
const rowText = (r: TransferRow) => `${r.hm} · ${r.clientName} · ${r.serviceLabel}`;
const passaram = (n: number, to: string) => (n === 1 ? `1 horário passou para a ${to}` : `${n} horários passaram para a ${to}`);
const QUESTION = "text-lg font-medium text-ink";
const OPTION = "flex min-h-12 w-full items-center rounded-[var(--radius-control)] border border-line px-4 text-left text-base font-medium hover:bg-paper-2";
const ROW = "flex items-center gap-3 border-b border-line/80 py-2.5";

/**
 * Passar o dia (Fase C, item 23b): uma pergunta por tela. De quem? → Para quem? → os horários do dia, com caixas: os que cabem livres
 * já marcados, os que a cliente pediu a de antes ("Ela pediu a Ana") desmarcados e os que não cabem só com o motivo → Passar.
 * O que o servidor não conseguir passar volta com o motivo. Nenhuma mensagem sai para a cliente.
 */
export function TransferDaySheet({ open, onClose, day, pros }: { open: boolean; onClose: () => void; day: string; pros: Pro[] }) {
  return (
    <Sheet open={open} onClose={onClose} title="Passar o dia">
      {open && <Steps onClose={onClose} day={day} pros={pros} />}
    </Sheet>
  );
}

function Steps({ onClose, day, pros }: { onClose: () => void; day: string; pros: Pro[] }) {
  const toast = useToast();
  const [step, setStep] = useState<Step>("de");
  const [from, setFrom] = useState<Pro | null>(null);
  const [to, setTo] = useState<Pro | null>(null);
  const [list, setList] = useState<TransferPreview | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<{ moved: number; skipped: { row: TransferRow | null; reason: string }[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const pickTo = (p: Pro) => start(async () => {
    setTo(p); setError(null); setList(null);
    const r = await previewTransferDayAction({ fromProfessionalId: from!.id, toProfessionalId: p.id, day });
    if (!r.ok || !r.data) { setError(r.ok ? "Não deu certo. Tente de novo." : r.error); return; }
    setList(r.data);
    setChecked(new Set(r.data.movable.map((x) => x.appointmentId))); // "Ela pediu a Ana" começa desmarcado
    setStep("lista");
  });
  const toggle = (id: string) => setChecked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const asked = new Set(list?.askedForHer.map((x) => x.appointmentId) ?? []);
  const ids = [...(list?.movable ?? []), ...(list?.askedForHer ?? [])].filter((x) => checked.has(x.appointmentId)).sort((a, b) => a.hm.localeCompare(b.hm)).map((x) => x.appointmentId);

  const submit = () => start(async () => {
    setError(null);
    const r = await transferDayAction({ fromProfessionalId: from!.id, toProfessionalId: to!.id, day, appointmentIds: ids, confirmAskedForHer: ids.some((id) => asked.has(id)) });
    if (!r.ok || !r.data) { setError(r.ok ? "Não deu certo. Tente de novo." : r.error); return; }
    if (r.data.moved) toast(passaram(r.data.moved, to!.name));
    if (!r.data.skipped.length) { onClose(); return; }
    const all = [...list!.movable, ...list!.askedForHer];
    setResult({ moved: r.data.moved, skipped: r.data.skipped.map((s) => ({ row: all.find((x) => x.appointmentId === s.appointmentId) ?? null, reason: s.reason })) });
    setStep("resultado");
  });
  const back = () => { setError(null); setStep(step === "lista" ? "para" : "de"); };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-graphite first-letter:uppercase">{dayLabel(day)}</p>
      {step === "de" && (
        <fieldset className="flex flex-col gap-2">
          <legend className={`${QUESTION} mb-2`}>De quem?</legend>
          {pros.map((p) => <button key={p.id} type="button" className={OPTION} onClick={() => { setFrom(p); setTo(null); setStep("para"); }}>{p.name}</button>)}
        </fieldset>
      )}
      {step === "para" && from && (
        <>
          <fieldset className="flex flex-col gap-2" disabled={pending}>
            <legend className={`${QUESTION} mb-2`}>Para quem?</legend>
            {pros.filter((p) => p.id !== from.id).map((p) => <button key={p.id} type="button" className={OPTION} aria-busy={pending && to?.id === p.id ? true : undefined} onClick={() => pickTo(p)}>{p.name}</button>)}
          </fieldset>
          <div><Button variant="ghost" onClick={back} disabled={pending}>Voltar</Button></div>
        </>
      )}
      {step === "lista" && from && to && list && (
        <>
          <h3 className={QUESTION}>{`Quais horários da ${from.name} passar para a ${to.name}?`}</h3>
          {list.movable.length + list.askedForHer.length + list.blocked.length === 0 ? (
            <p className="text-sm text-graphite">{`A ${from.name} não tem horários para passar nesse dia.`}</p>
          ) : (
            <>
              {list.movable.length + list.askedForHer.length > 0 && (
                <ul>
                  {[...list.movable, ...list.askedForHer].sort((a, b) => a.hm.localeCompare(b.hm)).map((r) => {
                    const pediu = asked.has(r.appointmentId);
                    return (
                      <li key={r.appointmentId} className={ROW}>
                        <label className="flex min-h-11 flex-1 cursor-pointer items-center gap-3">
                          <input type="checkbox" className="size-5 shrink-0 accent-[var(--color-ink)]" checked={checked.has(r.appointmentId)} onChange={() => toggle(r.appointmentId)}
                            aria-label={`${rowText(r)}${pediu ? `, ela pediu a ${from.name}` : ""}`} />
                          <span className="min-w-0 flex-1 tabular">{rowText(r)}</span>
                          {pediu && (
                            <span className="inline-flex shrink-0 items-center gap-0.5 rounded-[4px] bg-gold-soft px-1 text-xs font-semibold text-gold-ink">
                              <span aria-hidden>♥</span><span>{`Ela pediu a ${from.name}`}</span>
                            </span>
                          )}
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
              {list.blocked.length > 0 && (
                <section aria-label="Não dá para passar">
                  <h4 className="text-sm font-semibold text-graphite">Não dá para passar</h4>
                  <ul>
                    {list.blocked.map((r) => (
                      <li key={r.appointmentId} className={`${ROW} flex-col items-start gap-0.5`}>
                        <span className="tabular text-ink-2">{rowText(r)}</span>
                        <span className="text-sm text-graphite">{r.reason}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button variant="ghost" onClick={back} disabled={pending}>Voltar</Button>
            {list.movable.length + list.askedForHer.length > 0 && (
              <Button loading={pending} disabled={!ids.length} onClick={submit}>{ids.length === 1 ? "Passar 1 horário" : `Passar ${ids.length} horários`}</Button>
            )}
          </div>
        </>
      )}
      {step === "resultado" && from && to && result && (
        <>
          <h3 className={QUESTION}>{result.moved ? `${passaram(result.moved, to.name)}. Estes ficaram com a ${from.name}:` : `Nenhum horário passou. Ficaram com a ${from.name}:`}</h3>
          <ul>
            {result.skipped.map((s, k) => (
              <li key={s.row?.appointmentId ?? k} className={`${ROW} flex-col items-start gap-0.5`}>
                {s.row && <span className="tabular text-ink-2">{rowText(s.row)}</span>}
                <span className="text-sm text-graphite">{s.reason}</span>
              </li>
            ))}
          </ul>
          <div className="flex justify-end"><Button onClick={onClose}>Fechar</Button></div>
        </>
      )}
      {error && <p role="alert" className="text-sm text-alert">{error}</p>}
    </div>
  );
}
