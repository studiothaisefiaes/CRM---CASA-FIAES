"use client";
import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import { createNextActionAction } from "@/app/(app)/funil/actions";
import { dueLabel, nextActionPresets } from "@/lib/next-action";
import { bahiaParts, slotMs } from "@/lib/schedule";
import { ActionSheet, FieldError, SheetLabel } from "./action-sheet";

type Preset = "hoje" | "amanha" | "3dias" | "outra";

/**
 * "+ Próxima ação": o que fazer, quando e quem. Atalhos de data (Hoje 18h, Amanhã 10h, Em 3 dias) preenchem Dia e Hora, que continuam editáveis.
 * O responsável vem com o dono do lead (ou quem está logado, se o lead não tem dono). Cada lead tem UMA próxima ação: salvar troca a anterior,
 * que fica no histórico. Nasce nova a cada abertura (`key` de quem a monta).
 */
export function NextActionSheet({ open, onClose, dealId, name, people, defaultAssigneeId, replacing, onDone }: {
  open: boolean; onClose: () => void; dealId: string; name: string; people: { id: string; name: string }[];
  defaultAssigneeId: string | null; /** Título da próxima ação que esta vai substituir, se houver. */ replacing: string | null; onDone: () => void;
}) {
  const [openedAt] = useState(() => Date.now());
  const presets = nextActionPresets(openedAt);
  const initial = presets[0];
  const [preset, setPreset] = useState<Preset>(initial.key);
  const [slot, setSlot] = useState(() => bahiaParts(initial.at.getTime()));
  const [title, setTitle] = useState("");
  const [assignee, setAssignee] = useState(people.some((p) => p.id === defaultAssigneeId) ? defaultAssigneeId! : "");
  const [error, setError] = useState<{ title?: string; when?: string; form?: string }>({});
  const [pending, start] = useTransition();
  const titleRef = useRef<HTMLInputElement>(null);
  const sending = useRef(false);

  const ms = slotMs(slot.date, slot.time);
  const pretty = Number.isFinite(ms) ? dueLabel(ms, openedAt) : null;
  const pick = (key: Preset) => {
    setPreset(key);
    const p = presets.find((x) => x.key === key);
    if (p) setSlot(bahiaParts(p.at.getTime()));
    setError((e) => ({ ...e, when: undefined, form: undefined }));
  };
  const setField = (patch: Partial<typeof slot>) => { setSlot((s) => ({ ...s, ...patch })); setPreset("outra"); setError((e) => ({ ...e, when: undefined, form: undefined })); };

  const confirm = () => {
    if (pending || sending.current) return;
    const next: typeof error = {};
    if (!title.trim()) next.title = "Escreva o que precisa ser feito.";
    if (!Number.isFinite(ms)) next.when = "Escolha a data e a hora.";
    else if (ms < openedAt - 5 * 60_000) next.when = "Essa data já passou. Escolha uma data futura.";
    setError(next);
    if (Object.keys(next).length) { if (next.title) titleRef.current?.focus(); return; }
    sending.current = true;
    start(async () => {
      const r = await createNextActionAction({ dealId, title: title.trim(), dueAt: new Date(ms).toISOString(), assigneeId: assignee || null });
      if (!r.ok) { sending.current = false; setError({ form: r.error }); return; }
      onDone();
    });
  };

  return (
    <ActionSheet open={open} onClose={onClose} title="Próxima ação" initialFocusRef={titleRef}
      footer={<>
        <Button variant="ghost" size="lg" onClick={onClose} disabled={pending}>Cancelar</Button>
        <Button size="lg" onClick={confirm} loading={pending}>Salvar</Button>
      </>}>
      <div className="flex flex-col gap-5">
        <p className="text-sm text-graphite">Para <b className="font-medium text-ink">{name}</b></p>

        <div>
          <SheetLabel><label htmlFor="acao-titulo">O que fazer</label></SheetLabel>
          <Input id="acao-titulo" ref={titleRef} value={title} maxLength={120} autoComplete="off" enterKeyHint="done" placeholder="Ex.: Mandar os valores da progressiva"
            aria-invalid={error.title ? true : undefined} aria-describedby={error.title ? "acao-titulo-erro" : undefined}
            onChange={(e) => { setTitle(e.target.value); setError((x) => ({ ...x, title: undefined, form: undefined })); }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); confirm(); } }} className="h-12" />
          <div id="acao-titulo-erro"><FieldError>{error.title}</FieldError></div>
        </div>

        <div>
          <SheetLabel id="acao-quando">Quando</SheetLabel>
          <Segmented<Preset> labelledBy="acao-quando" value={preset} onChange={pick}
            options={[...presets.map((p) => ({ value: p.key as Preset, label: p.label })), { value: "outra" as const, label: "Outra data" }]} />
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <SheetLabel><label htmlFor="acao-dia">Dia</label></SheetLabel>
              <Input id="acao-dia" type="date" min={bahiaParts(openedAt).date} value={slot.date} onChange={(e) => setField({ date: e.target.value })} aria-invalid={error.when ? true : undefined} className="h-12" />
            </div>
            <div>
              <SheetLabel><label htmlFor="acao-hora">Hora</label></SheetLabel>
              <Input id="acao-hora" type="time" step={300} value={slot.time} onChange={(e) => setField({ time: e.target.value })} aria-invalid={error.when ? true : undefined} className="h-12" />
            </div>
          </div>
          {pretty && !error.when && <p className="mt-2 font-serif text-xl leading-snug first-letter:uppercase">{pretty}</p>}
          <FieldError>{error.when}</FieldError>
        </div>

        <div>
          <SheetLabel><label htmlFor="acao-quem">Quem faz</label></SheetLabel>
          <Select id="acao-quem" value={assignee} onChange={(e) => setAssignee(e.target.value)} className="h-12">
            <option value="">Sem responsável</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </div>

        {replacing && <p className="text-sm text-muted">Isto substitui a próxima ação atual: “{replacing}”. Ela fica guardada no histórico.</p>}
        <FieldError>{error.form}</FieldError>
      </div>
    </ActionSheet>
  );
}
