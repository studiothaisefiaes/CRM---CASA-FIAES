"use client";
import { useState } from "react";
import type { AgendaItem } from "@/server/queries/agenda";
import { durationLabel, minuteOfDay } from "@/lib/agenda";
import { hm, placeOptions, type PlaceCtx } from "@/lib/agenda-day";
import type { AgendaMode } from "@/lib/agenda-settings";
import { Dialog } from "@/components/ui/dialog";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/cn";
import { ProAvatar } from "../pro-avatar";
import { shownName } from "../use-agenda-actions";
import type { DayPro } from "./day-grid";

export type MoveRequest = { item: AgendaItem; to: string; t: number; avisar: boolean };
const first = (s: string | null | undefined) => (s ?? "").trim().split(/\s+/)[0] ?? "";

/**
 * "Passar Mirela para a Heloísa às 14:00?" (ou "Mudar … para as 14:00?" na mesma pessoa). "Avisar a cliente" vem DESLIGADO; ligado, só
 * preenche a mensagem na conversa (nunca envia sozinho). No modo dupla, o lembrete de mudar também no Avec.
 */
export function MoveConfirm({ req, pending, pros, mode, onChange, onCancel, onConfirm }: {
  req: MoveRequest | null; pending: boolean; pros: DayPro[]; mode: AgendaMode;
  onChange: (r: MoveRequest) => void; onCancel: () => void; onConfirm: (r: MoveRequest) => void;
}) {
  const i = req?.item;
  const name = i ? first(shownName(i)) : "";
  const same = !!req && req.item.professionalId === req.to;
  const toName = req ? first(pros.find((p) => p.id === req.to)?.name) : "";
  const fromName = first(i?.professionalName);
  const title = !req ? "" : same ? `Mudar ${name} para as ${hm(req.t)}?` : `Passar ${name} para a ${toName} às ${hm(req.t)}?`;
  return (
    <Dialog open={!!req} onClose={onCancel} title={title} width={440}
      description={i && <span className="tabular">{i.service || "Serviço não informado"}, {durationLabel(i.durationMin)}. Estava às {hm(minuteOfDay(i.scheduledAt))}{fromName ? ` com a ${fromName}` : ""}.</span>}
      footer={req && (
        <>
          <Button variant="secondary" onClick={onCancel}>Cancelar</Button>
          <Button loading={pending} onClick={() => onConfirm(req)}>{same ? "Mudar" : "Passar"}</Button>
        </>
      )}>
      {req && i && (
        <div className="flex flex-col gap-3">
          {!same && i.preference === "escolhida" && fromName && <p role="note" className="rounded-[var(--radius-control)] bg-gold-soft px-3 py-2 text-sm text-gold-ink">Ela pediu a {fromName}. Confirme a troca com ela.</p>}
          {mode === "dupla" && <p role="note" className="rounded-[var(--radius-control)] bg-gold-soft px-3 py-2 text-sm text-gold-ink">{i.origin === "avec" ? "Este horário veio do Avec. " : ""}Enquanto o Avec estiver ligado, mude também lá.</p>}
          <div className="flex items-center justify-between gap-3 rounded-[var(--radius-control)] px-1 py-1">
            <span className="flex flex-col">
              <span className="text-base font-medium">Avisar a cliente</span>
              <span className="text-xs text-muted">{req.avisar ? "A mensagem fica pronta na conversa; quem envia é você." : "Nenhuma mensagem é preparada nem enviada."}</span>
            </span>
            <Switch checked={req.avisar} onChange={(v) => onChange({ ...req, avisar: v })} label="Avisar a cliente" />
          </div>
        </div>
      )}
    </Dialog>
  );
}

/** "Mover…" (no painel do horário): a alternativa ao arrastar, para teclado e celular. Escolhe a pessoa, depois a hora. */
export function MovePicker({ item, onClose, pros, ctx, onPick }: { item: AgendaItem | null; onClose: () => void; pros: DayPro[]; ctx: PlaceCtx; onPick: (to: string, t: number) => void }) {
  const [alvo, setAlvo] = useState<{ key: string; pro: string } | null>(null);
  const from = item?.professionalId ?? null;
  const to = alvo && alvo.key === item?.key ? alvo.pro : from ?? pros.find((p) => !p.off)?.id ?? null;
  const options = item && to ? placeOptions(item, to, ctx, { start: 0, end: 1440 }, 32) : [];
  const toName = first(pros.find((p) => p.id === to)?.name);
  return (
    <Sheet open={!!item} onClose={onClose} title={item ? `Mover ${shownName(item)}` : ""}>
      {item && (
        <div className="flex flex-col gap-5">
          <p className="text-sm text-graphite">Escolha a pessoa e depois a hora. É o mesmo que arrastar o horário na grade.</p>
          <div role="group" aria-label="Para quem" className="flex flex-wrap gap-2">
            {pros.filter((p) => !p.off || p.id === from).map((p) => (
              <button key={p.id} type="button" aria-pressed={p.id === to} onClick={() => setAlvo({ key: item.key, pro: p.id })}
                className={cn("inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-control)] border px-3 text-base", p.id === to ? "border-gold bg-gold-soft font-semibold text-gold-ink" : "border-line-strong bg-paper hover:bg-paper-2")}>
                <ProAvatar name={p.name} color={p.color} photoUrl={p.photoUrl} size={24} soft />{first(p.name)}{p.id === from ? ", agora" : ""}
              </button>
            ))}
          </div>
          <p className="text-sm text-graphite">{options.length ? `Horas em que a ${toName} está livre por ${durationLabel(item.durationMin)}.` : `Neste dia não tem espaço de ${durationLabel(item.durationMin)} com a ${toName}.`}</p>
          <div role="group" aria-label="Hora" className="flex flex-wrap gap-2">
            {to && options.map((t) => (
              <button key={t} type="button" onClick={() => onPick(to, t)} className="inline-flex min-h-11 items-center rounded-[var(--radius-control)] border border-line-strong bg-paper px-3.5 text-base tabular hover:bg-paper-2">{hm(t)}</button>
            ))}
          </div>
        </div>
      )}
    </Sheet>
  );
}
