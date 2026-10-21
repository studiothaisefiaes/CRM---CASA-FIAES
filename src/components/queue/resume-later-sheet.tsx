"use client";
import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import { waitForClientAction } from "@/app/(app)/funil/actions";
import { dueLabel, resumePresets, type ResumePreset } from "@/lib/next-action";
import { bahiaParts, slotMs } from "@/lib/schedule";
import { cn } from "@/lib/cn";
import { useHours } from "@/components/pipeline/timer";
import { ActionSheet, FieldError, SheetLabel } from "./action-sheet";

type When = "auto" | ResumePreset["key"] | "outra";
export type WaitMode = "aguardar" | "nova-data" | "lembrete";

/** Motivos que mais aparecem; tocar preenche o lembrete (dá para escrever outro). */
const REASONS = ["Vai dar retorno para agendar", "Vai ver a agenda e avisar", "Pediu para chamar depois", "Vai pensar no valor"];

/**
 * "Marcar como aguardando cliente" (antes "Retomar depois"). `aguardar`: vai para Aguardando cliente; "Automático" segue as
 * tentativas D+1, D+3, D+7 (cada uma vira um combinado com aviso; nada é enviado à cliente). `nova-data`: já aguardando, muda a data.
 * `lembrete`: tem horário (Agendado/Atendida), a etapa não muda. Nasce nova a cada abertura (`key`).
 */
export function ResumeLaterSheet({ open, onClose, dealId, name, people, defaultAssigneeId, mode, onDone }: {
  open: boolean; onClose: () => void; dealId: string; name: string; people: { id: string; name: string }[];
  defaultAssigneeId: string | null; mode: WaitMode; onDone: (dueMs: number) => void;
}) {
  const hours = useHours();
  const [openedAt] = useState(() => Date.now());
  const presets = resumePresets(openedAt, hours);
  const first = name.split(/\s+/)[0] || name;
  const canAuto = mode === "aguardar";
  const [when, setWhen] = useState<When>(canAuto ? "auto" : "3dias");
  const [slot, setSlot] = useState(() => bahiaParts(presets[1].at.getTime()));
  const [title, setTitle] = useState(canAuto ? "" : `Retomar contato com ${first}`);
  const [assignee, setAssignee] = useState(people.some((p) => p.id === defaultAssigneeId) ? defaultAssigneeId! : "");
  const [error, setError] = useState<{ title?: string; when?: string; form?: string }>({});
  const [pending, start] = useTransition();
  const titleRef = useRef<HTMLInputElement>(null);
  const sending = useRef(false);

  const auto = when === "auto";
  const ms = auto ? NaN : slotMs(slot.date, slot.time);
  const pretty = !auto && Number.isFinite(ms) ? dueLabel(ms, openedAt) : null;
  const pick = (key: When) => {
    setWhen(key);
    const p = presets.find((x) => x.key === key);
    if (p) setSlot(bahiaParts(p.at.getTime()));
    if (key !== "auto" && !title) setTitle(`Retomar contato com ${first}`);
    setError((e) => ({ ...e, when: undefined, form: undefined }));
  };
  const setField = (patch: Partial<typeof slot>) => { setSlot((s) => ({ ...s, ...patch })); setWhen("outra"); setError((e) => ({ ...e, when: undefined, form: undefined })); };

  const confirm = () => {
    if (pending || sending.current) return;
    const next: typeof error = {};
    if (!auto) {
      if (!title.trim()) next.title = "Escreva o motivo do lembrete.";
      if (!Number.isFinite(ms)) next.when = "Escolha o dia e a hora.";
      else if (ms < openedAt - 5 * 60_000) next.when = "Essa data já passou. Escolha uma data futura.";
    }
    setError(next);
    if (Object.keys(next).length) { if (next.title) titleRef.current?.focus(); return; }
    sending.current = true;
    start(async () => {
      const r = await waitForClientAction({ dealId, title: auto ? undefined : title.trim(), dueAt: auto ? null : new Date(ms).toISOString(), assigneeId: assignee || null });
      if (!r.ok) { sending.current = false; setError({ form: r.error }); return; }
      onDone(new Date(r.data!.dueAt).getTime());
    });
  };

  const intro = mode === "aguardar"
    ? <>{first} não precisa de resposta agora. A conversa vai para <b className="font-medium text-ink">Aguardando cliente</b> e sai de Atrasados.
        {" "}No <b className="font-medium text-ink">Automático</b>, a Casa retoma até 3 vezes (amanhã, em 3 dias e em 7 dias): cada tentativa aparece em Combinados no dia, com aviso. Nada é enviado sozinho para a cliente.</>
    : mode === "nova-data" ? <>{first} já está aguardando. Escolha quando retomar a tentativa atual.</>
    : <>{first} tem horário marcado: a etapa não muda. Fica só o lembrete para o dia escolhido.</>;

  return (
    <ActionSheet open={open} onClose={onClose} title={mode === "aguardar" ? "Aguardando cliente" : "Retomar depois"} initialFocusRef={titleRef}
      footer={<>
        <Button variant="ghost" size="lg" onClick={onClose} disabled={pending}>Cancelar</Button>
        <Button size="lg" onClick={confirm} loading={pending}>{mode === "aguardar" ? "Marcar como aguardando" : "Salvar lembrete"}</Button>
      </>}>
      <div className="flex flex-col gap-5">
        <p className="text-sm text-graphite">{intro}</p>
        <div>
          <SheetLabel id="retomar-quando">Retomar</SheetLabel>
          <Segmented<When> labelledBy="retomar-quando" value={when} onChange={pick}
            options={[...(canAuto ? [{ value: "auto" as const, label: "Automático" }] : []), ...presets.map((p) => ({ value: p.key as When, label: p.label })), { value: "outra" as const, label: "Outra data" }]} />
          {!auto && (
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <SheetLabel><label htmlFor="retomar-dia">Dia</label></SheetLabel>
                <Input id="retomar-dia" type="date" min={bahiaParts(openedAt).date} value={slot.date} onChange={(e) => setField({ date: e.target.value })} aria-invalid={error.when ? true : undefined} className="h-12" />
              </div>
              <div>
                <SheetLabel><label htmlFor="retomar-hora">Hora</label></SheetLabel>
                <Input id="retomar-hora" type="time" step={300} value={slot.time} onChange={(e) => setField({ time: e.target.value })} aria-invalid={error.when ? true : undefined} className="h-12" />
              </div>
            </div>
          )}
          {pretty && !error.when && <p className="mt-2 font-display text-xl leading-snug first-letter:uppercase">{pretty}</p>}
          <FieldError>{error.when}</FieldError>
        </div>
        {!auto && (
          <div>
            <SheetLabel><label htmlFor="retomar-motivo">Lembrete</label></SheetLabel>
            <Input id="retomar-motivo" ref={titleRef} value={title} maxLength={120} autoComplete="off" enterKeyHint="done"
              aria-invalid={error.title ? true : undefined} aria-describedby={error.title ? "retomar-motivo-erro" : undefined}
              onChange={(e) => { setTitle(e.target.value); setError((x) => ({ ...x, title: undefined, form: undefined })); }}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); confirm(); } }} className="h-12" />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {REASONS.map((r) => (
                <button key={r} type="button" onClick={() => { setTitle(r); setError((x) => ({ ...x, title: undefined })); }}
                  className={cn("min-h-9 rounded-full border px-3 text-sm transition-colors pointer-coarse:min-h-11",
                    title === r ? "border-ink bg-ink text-paper" : "border-line-strong text-graphite hover:bg-paper-2")}>{r}</button>
              ))}
            </div>
            <div id="retomar-motivo-erro"><FieldError>{error.title}</FieldError></div>
          </div>
        )}
        <div>
          <SheetLabel><label htmlFor="retomar-quem">Quem retoma</label></SheetLabel>
          <Select id="retomar-quem" value={assignee} onChange={(e) => setAssignee(e.target.value)} className="h-12">
            <option value="">Sem responsável</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </div>
        <FieldError>{error.form}</FieldError>
      </div>
    </ActionSheet>
  );
}
