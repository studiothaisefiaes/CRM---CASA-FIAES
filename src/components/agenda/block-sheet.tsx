"use client";
import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { Segmented } from "@/components/ui/segmented";
import { useToast } from "@/components/ui/toast";
import { deleteBlockAction, saveBlockAction } from "@/app/(app)/agenda/actions";
import { BLOCK_REASON_LABEL, BLOCK_REASONS, clientsInsideText, isBlockReason, reasonFromTitle, type BlockReason } from "@/lib/agenda-blocks";
import { AVEC_TAMBEM_MSG, CONSULTA_MSG, type AgendaMode } from "@/lib/agenda-settings";
import { cn } from "@/lib/cn";

/** Bloqueio aberto para editar (o que `listAgendaBlocks` traz, sem o nome da profissional). */
export type EditableBlock = {
  id: string; professionalId: string | null; title: string; notes: string | null; startsOn: string; endsOn: string;
  startTime: string; endTime: string; weekdays: number[] | null; origin: string; reason: string | null;
};

const pad = (n: number) => String(n).padStart(2, "0");
// De 00:00 a 24:00, de 15 em 15 min (lista em 24 h, como no horário da Casa).
const TIMES = Array.from({ length: 24 * 4 + 1 }, (_, i) => `${pad(Math.floor(i / 4))}:${pad((i % 4) * 15)}`);
const timesWith = (v: string) => (TIMES.includes(v) ? TIMES : [...TIMES, v].sort());
const WEEK: [number, string][] = [[1, "Segunda"], [2, "Terça"], [3, "Quarta"], [4, "Quinta"], [5, "Sexta"], [6, "Sábado"], [0, "Domingo"]];
const NOTE = "rounded-[var(--radius-control)] border px-3 py-2 text-sm";

/**
 * Bloquear (ou editar e apagar um bloqueio): quem (uma profissional ou todas), o dia ou o período, das … às … ou o dia inteiro, os dias
 * da semana em que repete e o motivo. O servidor confere tudo e o modo da agenda; salvar por cima de clientes marcadas não mexe nelas e
 * a tela lista quem está dentro.
 */
export function BlockSheet({ open, onClose, pros, mode, day, block = null }: {
  open: boolean; onClose: () => void; pros: { id: string; name: string }[]; mode: AgendaMode; day: string; block?: EditableBlock | null;
}) {
  return (
    <Sheet open={open} onClose={onClose} title={block ? "Editar bloqueio" : "Bloquear horário"}>
      {open && <Form key={block?.id ?? day} pros={pros} mode={mode} day={day} block={block} onClose={onClose} />}
    </Sheet>
  );
}

function initialReason(block: EditableBlock | null): { reason: BlockReason | null; note: string } {
  if (!block) return { reason: null, note: "" };
  if (isBlockReason(block.reason)) return { reason: block.reason, note: block.reason === "outro" ? block.title : block.notes ?? "" };
  const r = reasonFromTitle(block.title);
  return { reason: r.reason, note: r.note ?? block.notes ?? "" };
}

function Form({ pros, mode, day, block, onClose }: { pros: { id: string; name: string }[]; mode: AgendaMode; day: string; block: EditableBlock | null; onClose: () => void }) {
  const id = useId();
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [pro, setPro] = useState(block?.professionalId ?? "");
  const [from, setFrom] = useState(block?.startsOn ?? day);
  const [to, setTo] = useState(block?.endsOn ?? day);
  const [allDay, setAllDay] = useState(block ? block.startTime === "00:00" && block.endTime === "24:00" : false);
  const [startTime, setStartTime] = useState(block?.startTime ?? "12:00");
  const [endTime, setEndTime] = useState(block?.endTime ?? "13:00");
  const [weekdays, setWeekdays] = useState<number[]>(block?.weekdays ?? []);
  const [{ reason, note }, setReason] = useState(() => initialReason(block));
  const [error, setError] = useState<string | null>(null);
  const [inside, setInside] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const locked = mode === "consulta";

  const save = () => {
    if (!reason) { setError("Escolha o motivo do bloqueio."); return; }
    setError(null);
    start(async () => {
      const r = await saveBlockAction(block?.id ?? null, {
        professionalId: pro || null, startsOn: from, endsOn: to < from ? from : to, startTime: allDay ? "00:00" : startTime, endTime: allDay ? "24:00" : endTime,
        weekdays: weekdays.length ? [...weekdays].sort((a, b) => a - b) : null, reason, note,
      });
      if (!r.ok) { setError(r.error); return; }
      router.refresh();
      const list = r.data?.clientsInside ?? [];
      if (list.length) { setInside(clientsInsideText(list)); return; }
      toast(block ? "Bloqueio salvo" : "Horário bloqueado");
      onClose();
    });
  };
  const remove = () => start(async () => {
    const r = await deleteBlockAction(block!.id);
    if (!r.ok) { setError(r.error); setConfirmDelete(false); return; }
    router.refresh();
    toast(block!.origin === "avec" && mode === "dupla" ? "Bloqueio apagado aqui. Apague também no Avec." : "Bloqueio apagado");
    onClose();
  });

  if (inside) return (
    <div className="flex flex-col gap-4">
      <p role="status" className={cn(NOTE, "border-gold/40 bg-gold-soft/60 text-gold-ink")}>{`Bloqueio salvo. ${inside}. O bloqueio não mexe nelas: remarque com cada uma.`}</p>
      <div className="flex justify-end"><Button onClick={onClose}>Fechar</Button></div>
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      {locked && <p role="note" className={cn(NOTE, "border-line-strong bg-paper-2 text-graphite")}>{CONSULTA_MSG}</p>}
      {mode === "dupla" && <p role="note" className={cn(NOTE, "border-gold/40 bg-gold-soft/60 text-gold-ink")}>{AVEC_TAMBEM_MSG}</p>}
      {block?.origin === "avec" && <p role="note" className={cn(NOTE, "border-line-strong bg-paper-2 text-graphite")}>Este bloqueio veio do Avec. Enquanto o Avec estiver ligado, apague também lá.</p>}
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-quem`} className="text-sm font-medium text-graphite">Quem</label>
        <Select id={`${id}-quem`} value={pro} onChange={(e) => setPro(e.target.value)}>
          <option value="">Todas as profissionais</option>
          {pros.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-de`} className="text-sm font-medium text-graphite">De</label>
          <Input id={`${id}-de`} type="date" value={from} onChange={(e) => { setFrom(e.target.value); if (to < e.target.value) setTo(e.target.value); }} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-ate`} className="text-sm font-medium text-graphite">Até</label>
          <Input id={`${id}-ate`} type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <span className="flex min-h-11 items-center gap-2 text-sm text-graphite"><Switch checked={allDay} label="Dia inteiro" onChange={setAllDay} />Dia inteiro</span>
        {!allDay && (
          <>
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${id}-das`} className="text-sm font-medium text-graphite">Das</label>
              <Select id={`${id}-das`} value={startTime} onChange={(e) => setStartTime(e.target.value)} className="w-28">{timesWith(startTime).map((t) => <option key={t}>{t}</option>)}</Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${id}-as`} className="text-sm font-medium text-graphite">Às</label>
              <Select id={`${id}-as`} value={endTime} onChange={(e) => setEndTime(e.target.value)} className="w-28">{timesWith(endTime).map((t) => <option key={t}>{t}</option>)}</Select>
            </div>
          </>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <p className="text-sm font-medium text-graphite">Repete em</p>
        <div className="flex flex-wrap gap-1.5">
          {WEEK.map(([d, label]) => {
            const on = weekdays.includes(d);
            return (
              <button key={d} type="button" aria-pressed={on} aria-label={label} onClick={() => setWeekdays((w) => (on ? w.filter((x) => x !== d) : [...w, d]))}
                className={cn("min-h-11 rounded-full border px-3 text-sm transition-colors lg:min-h-8", on ? "border-ink bg-ink text-paper" : "border-line-strong text-graphite hover:bg-paper-2")}>
                {label.slice(0, 3)}
              </button>
            );
          })}
        </div>
        <p className="text-sm text-muted">{weekdays.length ? "Só nesses dias da semana, dentro do período." : "Sem dia marcado: todos os dias do período."}</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <p id={`${id}-motivo`} className="text-sm font-medium text-graphite">Motivo</p>
        <Segmented labelledBy={`${id}-motivo`} value={reason} onChange={(v) => setReason((r) => ({ ...r, reason: v }))}
          options={BLOCK_REASONS.map((r) => ({ value: r, label: BLOCK_REASON_LABEL[r] }))} />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-texto`} className="text-sm font-medium text-graphite">{reason === "outro" ? "Qual o motivo?" : "Observação (opcional)"}</label>
        <Textarea id={`${id}-texto`} value={note} maxLength={200} rows={2} className="min-h-0" onChange={(e) => setReason((r) => ({ ...r, note: e.target.value }))} />
      </div>
      {error && <p role="alert" className="text-sm text-alert">{error}</p>}
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line pt-4">
        {block && (confirmDelete ? (
          <>
            <span className="mr-auto text-sm text-graphite">Apagar este bloqueio?</span>
            <Button variant="ghost" disabled={pending} onClick={() => setConfirmDelete(false)}>Voltar</Button>
            <Button variant="danger" loading={pending} onClick={remove}>Sim, apagar</Button>
          </>
        ) : <Button variant="ghost" className="mr-auto text-alert" disabled={locked || pending} onClick={() => setConfirmDelete(true)}>Apagar bloqueio</Button>)}
        {!confirmDelete && <Button loading={pending} disabled={locked} onClick={save}>Salvar bloqueio</Button>}
      </div>
    </div>
  );
}
