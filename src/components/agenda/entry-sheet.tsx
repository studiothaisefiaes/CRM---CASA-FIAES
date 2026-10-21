"use client";
import { useState, type ReactNode } from "react";
import Link from "next/link";
import type { AgendaItem } from "@/server/queries/agenda";
import { durationLabel, STATUS_LABEL, timeRange } from "@/lib/agenda";
import { ACTIVE_STATUSES, CANCEL_REASON_LABEL, canMarkNoShow, checkCancel, nextStep, STEP_LABEL, type CancelReason } from "@/lib/appointment-status";
import { contactHref, leadHref } from "@/lib/lead-href";
import { formatPhoneClient } from "@/lib/phone-client";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { buttonClass } from "@/components/ui/button-styles";
import { Textarea } from "@/components/ui/field";
import { ProAvatar } from "./pro-avatar";
import { PreferenceTag } from "./preference-tag";
import { IconCheck, IconClose } from "@/components/icons";
import { cn } from "@/lib/cn";
import { displayName } from "@/lib/display-name";
import { firstName } from "@/lib/authorship";
import { shownName, type AgendaActions } from "./use-agenda-actions";
import { StatusChip } from "./status-chip";
import { EntryExtras } from "./entry-extras";
import { canBookIn, useAgendaSheets } from "./agenda-sheets";
import { useComanda } from "@/components/caixa/comanda-provider";
import { isMovable } from "@/lib/agenda-day";
import { DayVisitView, useDayVisit } from "./day-visit";
import { EntryMarkers } from "./marker-fields";
import { TagDot } from "@/components/tags/tag-dot";
import { FIRST_VISIT_LABEL } from "@/lib/visit-type";
import { ClientAlertPopup } from "@/components/contacts/client-alert-popup";

const DIA = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric", month: "long", timeZone: "America/Bahia" });
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const UNDOABLE = new Set(["confirmado", "chegou", "em_atendimento", "compareceu", "faltou", "cancelado"]);

/** De onde veio o horário, em palavras da recepção. */
export const originLabel = (i: AgendaItem) => (i.source === "lead" ? "Marcado pelas Conversas" : i.origin === "avec" ? "Veio do Avec" : "Marcado na Casa");

/**
 * Psico r68 #7: com o caixa no CRM, Finalizar NÃO fecha a folha: o botão principal passa a ser "Receber na comanda" (a cliente não vai embora sem pagar).
 * Um horário aberto (6.1): o próximo passo em destaque (Confirmar, Chegou, Iniciar, Finalizar), Faltou depois do início, Remarcar,
 * Cancelar, Desfazer, Observação, e abrir a conversa ou a ficha. Lead sem horário na agenda continua com Compareceu/Faltou.
 */
export function EntrySheet({ item, onClose, actions, nowMs, visitCount = 1, onMove }: { item: AgendaItem | null; onClose: () => void; actions: AgendaActions; nowMs: number; visitCount?: number;
  /** Nova Agenda: "Mover…" (outra profissional ou hora no mesmo dia), a alternativa ao arrastar. */ onMove?: (i: AgendaItem) => void }) {
  const { catalog, reschedule, cancel } = useAgendaSheets();
  const comanda = useComanda();
  const [notesFor, setNotesFor] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [undoAsk, setUndoAsk] = useState<string | null>(null);
  const i = item;
  const now = new Date(nowMs);
  const isAppt = !!i && i.source === "agendamento" && !!i.appointmentId;
  const db = i?.dbStatus ?? null;
  const step = isAppt && db && !i!.noTime ? nextStep({ status: db, startsAt: new Date(i!.scheduledAt) }, now) : null;
  const canMark = !!catalog?.canMark;
  // Lote 2: a folha leva à conversa (quando há) e à ficha da cliente (quando há), lado a lado.
  const links = i ? [
    ...(i.dealId ? [{ href: leadHref(i.dealId), label: "Abrir conversa" }] : []),
    ...(i.contactId ? [{ href: contactHref(i.contactId), label: "Abrir ficha da cliente" }] : []),
  ] : [];
  const editingNotes = !!i && notesFor === i.key;

  return (
    <>
    <Sheet open={!!i} onClose={onClose} title={i ? shownName(i) : ""}
      footer={i && (
        <div className="flex w-full flex-wrap items-center justify-end gap-2">
          {links.length > 0 && (
            <span className="mr-auto flex flex-wrap gap-x-4">
              {links.map((l) => <Link key={l.href} href={l.href} className={buttonClass({ variant: "link", className: "text-sm" })}>{l.label}</Link>)}
            </span>
          )}
          {!isAppt && i.status === "conferir" && (["compareceu", "faltou"] as const).map((s) => (
            <Button key={s} variant="secondary" disabled={actions.pending} onClick={() => actions.mark(i, s, onClose)}>
              {s === "compareceu" ? <IconCheck size={14} aria-hidden /> : <IconClose size={14} aria-hidden />}{s === "compareceu" ? "Veio" : "Faltou"}
            </Button>
          ))}
          {isAppt && db && (
            <>
              {canMark && checkCancel(db).ok && <Button variant="secondary" onClick={() => { cancel(i, visitCount); onClose(); }}>Cancelar horário</Button>}
              {canBookIn(catalog) && (db === "agendado" || db === "confirmado" || db === "solicitado") && <Button variant="secondary" onClick={() => { reschedule(i); onClose(); }}>Remarcar</Button>}
              {onMove && canBookIn(catalog) && isMovable(i) && <Button variant="secondary" aria-label={`Mover ${shownName(i)} para outra pessoa ou hora`} onClick={() => onMove(i)}>Mover…</Button>}
              {canMarkNoShow({ status: db, startsAt: new Date(i.scheduledAt) }, now) && (
                <Button variant="secondary" disabled={actions.pending} onClick={() => actions.mark(i, "faltou", onClose)}>Faltou</Button>
              )}
            </>
          )}
        </div>
      )}>
      {i && (
        <div className="flex flex-col gap-5">
          <div>
            <p className="text-sm text-graphite">{cap(DIA.format(new Date(i.scheduledAt)))}</p>
            <p className={cn("mt-0.5 text-2xl font-semibold tabular", i.status === "cancelado" && "text-muted line-through")}>{i.noTime ? "Sem hora" : timeRange(i.scheduledAt, i.durationMin)}</p>
            {!i.noTime && <p className="mt-1 text-sm text-muted">{durationLabel(i.durationMin)}{i.durationEstimated ? " · duração estimada (o serviço não tem duração cadastrada)" : ""}</p>}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <StatusChip status={i.status} />
              {i.firstVisit && <Tag>{FIRST_VISIT_LABEL}</Tag>}
              {i.label && <Tag><span className="inline-flex items-center gap-1.5"><TagDot color={i.label.color} />{displayName(i.label.name)}</span></Tag>}
              {i.visitTypeLabel && <Tag>{i.visitTypeLabel}</Tag>}
              {i.series && <Tag>{`Repete: ${i.series.index} de ${i.series.total}`}</Tag>}
              {i.fitIn && <Tag tone="alert">Encaixe</Tag>}
              {i.outsideHours && <Tag tone="alert">Fora do horário</Tag>}
              {i.anyPro && <Tag>Qualquer uma</Tag>}
              {i.confirmedVia === "link" && <Tag tone="ok">Confirmou pelo link</Tag>}
              {i.paid && <Tag tone="ok">R$ pago</Tag>}
            </div>
          </div>
          {isAppt && db && (
            <div data-testid="acao-principal" className="flex flex-col gap-2">
              {step && (step !== "agendado" || canBookIn(catalog)) && <Button size="lg" disabled={actions.pending} onClick={() => actions.mark(i, step, step === "compareceu" && !(catalog?.canCaixa && comanda) ? onClose : undefined)}>{STEP_LABEL[step]}</Button>}
              {step === "compareceu" && (db === "agendado" || db === "confirmado") && <Button size="lg" variant="secondary" disabled={actions.pending} onClick={() => actions.mark(i, "chegou")}>Chegou</Button>}
              {catalog?.canCaixa && comanda && i.appointmentId && !i.paid && ["agendado", "confirmado", "chegou", "em_atendimento", "compareceu"].includes(db) && (
                <Button size="lg" variant={step ? "secondary" : "primary"} onClick={() => { if (i.openComandaId) comanda.openById(i.openComandaId); else comanda.openForAppointment(i.appointmentId!); onClose(); }}>
                  {db === "compareceu" ? "Receber na comanda" : i.openComandaId ? "Ver comanda" : "Abrir comanda"}
                </Button>
              )}
            </div>
          )}
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2.5 text-sm">
            <Row k="Serviço" v={i.service || "Não informado"} muted={!i.service} />
            <Row k="Profissional" muted={!i.professionalName} v={i.professionalName
              ? <span className="inline-flex items-center gap-2"><ProAvatar name={i.professionalName} color={i.professionalColor} photoUrl={i.professionalPhotoUrl ?? null} size={24} />{i.professionalName}<PreferenceTag value={i.preference} /></span>
              : "Não informada"} />
            {!!i.assistants?.length && <Row k={i.assistants.length === 1 ? "Auxiliar" : "Auxiliares"} v={i.assistants.map((a) => a.name).join(", ")} />}
            {i.phone &&<Row k="Telefone" v={formatPhoneClient(i.phone)} />}
            {i.source === "lead" && <Row k="Conversa com" v={firstName(i.ownerName) ?? "Ninguém (sem dono)"} muted={!i.ownerName} />}
            {i.bookedBy && <Row k="Marcado por" v={i.bookedBy} />}
            <Row k="Origem" v={originLabel(i)} />
            {i.cancelReason && <Row k="Motivo" v={CANCEL_REASON_LABEL[i.cancelReason as CancelReason] ?? i.cancelReason} />}
            {i.notes && !editingNotes && <Row k="Observação" v={i.notes} />}
          </dl>
          {isAppt && ((catalog?.labels?.length ?? 0) > 0 || (catalog?.visitTypes?.length ?? 0) > 0) && (
            <details className="rounded-[var(--radius-card)] border border-line px-3 py-1">
              <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium text-gold-ink">Mais detalhes</summary>
              <div className="pb-3"><EntryMarkers key={`${i.appointmentId}:${i.label?.id}:${i.visitType}`} item={i} labels={catalog?.labels ?? []} types={catalog?.visitTypes ?? []} /></div>
            </details>
          )}
          {isAppt && i.appointmentId && <EntryDayVisit key={`${i.appointmentId}:${i.dbStatus}`} appointmentId={i.appointmentId} nowMs={nowMs} />}
          {i.appointmentId && <EntryExtras appointmentId={i.appointmentId} />}
          {isAppt && canMark && (editingNotes ? (
            <div className="flex flex-col gap-2">
              <label htmlFor="obs-horario" className="text-sm font-medium text-graphite">Observação deste horário</label>
              <Textarea id="obs-horario" value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} />
              <div className="flex gap-2">
                <Button size="sm" disabled={actions.pending} onClick={() => actions.saveNotes(i, notes, () => setNotesFor(null))}>Salvar observação</Button>
                <Button size="sm" variant="ghost" onClick={() => setNotesFor(null)}>Voltar</Button>
              </div>
            </div>
          ) : (
            <button type="button" className="self-start text-sm font-medium text-gold-ink hover:underline" onClick={() => { setNotes(i.notes ?? ""); setNotesFor(i.key); }}>
              {i.notes ? "Editar observação" : "Observação"}
            </button>
          ))}
          {isAppt && db && canMark && UNDOABLE.has(db) && (undoAsk === i.key
            ? <span className="flex items-center gap-3 text-xs text-graphite">Desfazer “{STATUS_LABEL[i.status]}”?
                <button type="button" disabled={actions.pending} className="min-h-11 font-semibold text-alert underline" onClick={() => { setUndoAsk(null); actions.undo(i, onClose); }}>Sim, desfazer</button>
                <button type="button" className="min-h-11 underline" onClick={() => setUndoAsk(null)}>Não</button></span>
            : <button type="button" disabled={actions.pending} className="min-h-11 self-start text-xs text-muted underline-offset-2 hover:underline" onClick={() => setUndoAsk(i.key)}>Desfazer “{STATUS_LABEL[i.status]}”</button>)}
          {isAppt && !i.contactId && <p className="rounded-[var(--radius-control)] bg-paper-2 px-3 py-2.5 text-sm text-graphite">Essa cliente ainda não tem ficha no CRM (o Avec não mandou o telefone).</p>}
          {isAppt && ACTIVE_STATUSES.includes(db ?? "") && catalog?.agendaMode === "dupla" && <p className="text-xs text-muted">Enquanto o Avec estiver ligado, mude também lá.</p>}
        </div>
      )}
    </Sheet>
    {/* Item 20: o aviso da cliente salta ao abrir o horário (uma vez por visita). Fora da Sheet, para não herdar o movimento dela. */}
    {i?.contactId && catalog?.clientAlert?.on && (
      <ClientAlertPopup key={i.key} contactId={i.contactId} scope={i.visitId ?? i.appointmentId ?? i.key} alertNotes={i.alertNotes ?? null} imageUse={i.imageUse ?? null} noImageText={catalog.clientAlert.text} />
    )}
    </>
  );
}

function Tag({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "ok" | "alert" }) {
  return <span className={cn("inline-flex h-6 items-center rounded-full px-2 text-xs font-semibold", tone === "ok" ? "bg-ok-soft text-ok" : tone === "alert" ? "bg-alert-soft text-alert" : "bg-paper-3 text-graphite")}>{children}</span>;
}

function Row({ k, v, muted = false }: { k: string; v: ReactNode; muted?: boolean }) {
  return (
    <>
      <dt className="text-muted">{k}</dt>
      <dd className={cn("min-w-0 break-words", muted ? "text-muted" : "text-ink")}>{v}</dd>
    </>
  );
}

/** 17/10 (item 5): a folha do horário mostra a visita inteira da cliente no dia (4 profissionais ao mesmo tempo, sem abrir um por um). */
function EntryDayVisit({ appointmentId, nowMs }: { appointmentId: string; nowMs: number }) {
  const { data, reload } = useDayVisit(appointmentId);
  if (!data?.visit || data.visit.services.length < 2) return null;
  return <div className="rounded-[var(--radius-card)] border border-line p-3"><DayVisitView data={data} nowMs={nowMs} onChanged={reload} embedded /></div>;
}
