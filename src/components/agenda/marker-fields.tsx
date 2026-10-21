"use client";
import { displayName } from "@/lib/display-name";
import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Segmented } from "@/components/ui/segmented";
import { useToast } from "@/components/ui/toast";
import { TagDot } from "@/components/tags/tag-dot";
import { setAppointmentLabelAction, setVisitTypeAction } from "@/app/(app)/agenda/actions";
import type { AgendaItem } from "@/server/queries/agenda";
import type { VisitType } from "@/lib/visit-type";

/** O que a tela oferece: só os ativos, e só com a função ligada e a permissão agenda.marcador (a Agenda monta isso; o servidor confere de novo). */
export type MarkerLabel = { id: string; name: string; color: string | null };
export type MarkerType = { value: VisitType; label: string };

const NONE = { value: "", label: "Nenhum" };

/** Duas linhas de chips, as duas opcionais: Tipo (Indicação, Noiva) e Marcador (os ativos). Sem opções, a linha some. */
export function MarkerFields({ labels, types, labelId, visitType, onLabel, onType, disabled }: {
  labels: MarkerLabel[]; types: MarkerType[]; labelId: string; visitType: string; onLabel: (id: string) => void; onType: (t: VisitType | "") => void; disabled?: boolean;
}) {
  const uid = useId();
  if (!labels.length && !types.length) return null;
  return (
    <div className="flex flex-col gap-4" data-testid="marcador-e-tipo">
      {types.length > 0 && (
        <div aria-disabled={disabled || undefined} className={disabled ? "pointer-events-none opacity-60" : undefined}>
          <p id={`${uid}-tipo`} className="mb-1.5 text-sm font-medium text-graphite">Tipo</p>
          <Segmented labelledBy={`${uid}-tipo`} value={visitType} onChange={(v) => onType(v as VisitType | "")} options={[NONE, ...types.map((t) => ({ value: t.value as string, label: t.label }))]} />
        </div>
      )}
      {labels.length > 0 && (
        <div aria-disabled={disabled || undefined} className={disabled ? "pointer-events-none opacity-60" : undefined}>
          <p id={`${uid}-marcador`} className="mb-1.5 text-sm font-medium text-graphite">Marcador</p>
          <Segmented labelledBy={`${uid}-marcador`} value={labelId} onChange={onLabel} options={[NONE, ...labels.map((l) => ({ value: l.id, label: displayName(l.name) }))]} />
        </div>
      )}
    </div>
  );
}

/** Marcador e tipo no cartão da lista: bolinha da cor do marcador + nome, e o tipo em texto. Nada quando não há. */
export function MarkerTags({ item }: { item: Pick<AgendaItem, "label" | "visitTypeLabel"> }) {
  return (
    <>
      {item.label && (
        <span data-marcador={item.label.id} className="inline-flex shrink-0 items-center gap-1 rounded-[4px] bg-paper-3 px-1 text-xs font-semibold text-graphite">
          <TagDot color={item.label.color} />{displayName(item.label.name)}
        </span>
      )}
      {item.visitTypeLabel && <span data-tipo-horario className="inline-flex shrink-0 items-center rounded-[4px] bg-gold-soft px-1 text-xs font-semibold text-gold-ink">{item.visitTypeLabel}</span>}
    </>
  );
}

/** Na folha do horário: mostra e troca o marcador e o tipo. Salva na hora, uma escolha por vez. */
export function EntryMarkers({ item, labels, types }: { item: AgendaItem; labels: MarkerLabel[]; types: MarkerType[] }) {
  const [labelId, setLabelId] = useState(item.label?.id ?? "");
  const [visitType, setVisitType] = useState<string>(item.visitType ?? "");
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const id = item.appointmentId;
  if (!id) return null;
  const pickLabel = (v: string) => start(async () => {
    const r = await setAppointmentLabelAction(id, v || null);
    if (!r.ok) { toast(r.error, "error"); return; }
    setLabelId(v); toast(v ? "Marcador salvo" : "Marcador tirado"); router.refresh();
  });
  const pickType = (v: VisitType | "") => start(async () => {
    const r = await setVisitTypeAction(id, v || null);
    if (!r.ok) { toast(r.error, "error"); return; }
    setVisitType(v); toast(v ? "Tipo salvo" : "Tipo tirado"); router.refresh();
  });
  return <MarkerFields labels={labels} types={types} labelId={labelId} visitType={visitType} onLabel={pickLabel} onType={pickType} disabled={pending} />;
}
