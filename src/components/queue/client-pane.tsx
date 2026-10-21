"use client";
import type { ReactNode } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { contactHref } from "@/lib/lead-href";
import { bahiaDay, displayName, returnLine } from "@/lib/client-rhythm";
import { TagsEditor } from "./tags-editor";
import type { DealDetail } from "@/server/queries/deal";
import type { Viewer } from "@/app/(app)/atendimento/actions";
import { IconCalendar, IconClock } from "@/components/icons";
import { askAttendance } from "@/lib/primary-action";
import { useClock, useHours } from "@/components/pipeline/timer";
import { formatBRL } from "@/lib/money";
import { paneSituation } from "@/lib/pane-situation";
import { isChannelOrigin, NOT_IDENTIFIED } from "@/lib/source-kinds";
import { cn } from "@/lib/cn";
import { firstName } from "@/lib/authorship";
import { attemptLine } from "@/lib/attempts";
import { dayWord, dueLabel } from "@/lib/next-action";
import { slaText } from "@/lib/alert-copy";
import { opensText } from "@/lib/why-late";
import { businessSecondsBetween, isOpen } from "@/lib/business-hours";
import { stripSignature } from "@/lib/signature";
import { can } from "@/lib/permissions";
import { SPRING_UI } from "@/lib/motion";
import type { LeadActions } from "./use-lead-actions";
import { HowKnown } from "./how-known";
import { PeopleOnNumber } from "@/components/contacts/people-on-number";
import { PauseSwitch } from "./pause-switch";
import { ClientLinkButton } from "./client-link-button";
import { AttendanceBar } from "./attendance-bar";
import { VisitActions } from "./visit-actions";
import { usePaneStatus } from "./status-menu";
import { birthdayText } from "@/lib/birthday";
import { formatCpf } from "@/lib/cpf";
import { AvatarZoom } from "@/components/ui/avatar-zoom";
import { avatarVersion } from "@/lib/avatar-url";
import { nameFallback } from "@/lib/phone-client";
import { originLabel } from "@/lib/origin-label";

export type SideTab = "agora" | "cliente";
const LABEL = "text-xs font-semibold text-graphite";
const ACT = "inline-flex min-h-10 w-full items-center gap-2 rounded-[10px] border border-line-strong bg-paper px-3 text-sm font-medium text-ink transition-colors hover:border-ink disabled:opacity-60 pointer-coarse:min-h-11";
const LINK = "min-h-8 text-sm font-medium text-gold-ink underline-offset-4 hover:underline pointer-coarse:min-h-11";

const avisosOf = (d: DealDetail) => (d.context.alertNotes ?? d.contact.alertNotes ?? "").split("\n").map((l) => l.trim()).filter(Boolean);

function Avisos({ d }: { d: DealDetail }) {
  const avisos = avisosOf(d);
  if (!avisos.length) return null;
  return (
    <ul aria-label="Avisos fixos" className="flex flex-col gap-1">
      {avisos.map((a) => <li key={a} className="rounded-[var(--radius-control)] border border-alert/40 bg-alert-soft px-2.5 py-1 text-sm font-medium text-alert">{a}</li>)}
    </ul>
  );
}

/** A frase da situação (calculada, coerente com o status): "Esperando a Casa · Responda em 6 min", "Esperando a cliente", "Conversa resolvida". */
function Situacao({ d, actions }: { d: DealDetail; actions: LeadActions }) {
  const hours = useHours();
  const { status, late } = usePaneStatus(d);
  const since = d.deal.awaitingReplySince ? new Date(d.deal.awaitingReplySince).getTime() : null;
  const sub = useClock((now) => {
    if (status !== "aberto" || since == null) return null;
    if (!isOpen(now, hours) && !late) return opensText(now, hours);
    return slaText(businessSecondsBetween(since, now, hours), d.stage.slaMinutes);
  }, since ?? 0);
  const tentativa = useClock((now) => (d.attempt ? attemptLine(d.attempt.n, d.attempt.lostAt ? dayWord(Date.parse(d.attempt.lostAt), now) : null) : null));
  const resumo = useClock((now) => paneSituation(d.context, { isClient: d.contact.isClient }, now));
  const k = d.stage.kind;
  if (k === "perdido") {
    const label = d.lostReasons.find((r) => r.id === d.deal.lostReasonId)?.label;
    const reason = d.deal.lostReasonDetail ? `${label ?? "Outro"}: ${d.deal.lostReasonDetail}` : label;
    return <p className="rounded-[var(--radius-control)] border-l-4 border-alert bg-alert-soft px-3 py-2 text-sm font-semibold text-alert">Perdido{reason ? ` · ${reason}` : ""}</p>;
  }
  const head = d.contact.kind === "equipe" ? "Contato da Casa" : d.contact.kind === "fornecedor" ? "Fornecedor" : d.contact.kind === "spam" ? "Spam" : status === "resolvido" ? "Conversa resolvida" : status === "aberto" ? "Esperando a Casa" : "Esperando a cliente";
  return (
    <section aria-label="Situação" className="flex flex-col gap-0.5">
      <p data-testid="situacao-conversa" className="text-[15px] font-semibold leading-snug text-ink" suppressHydrationWarning>
        {head}{sub ? <span className={cn("font-medium", late ? "text-alert" : "text-graphite")}> · {sub}</span> : null}
      </p>
      {d.aiResumo && d.contact.kind === "cliente" && (
        <p data-testid="resumo-ia" className="mt-1 rounded-[var(--radius-control)] bg-paper-2 px-2.5 py-1.5 text-sm leading-snug text-graphite">
          <span className="font-semibold text-ink">Resumo da IA:</span> {d.aiResumo.text}
        </p>
      )}
      {status === "resolvido" && (
        <p className="text-sm text-graphite">Volta sozinha se ela escrever. <button type="button" disabled={actions.busy} onClick={actions.unarchiveConversation} className={LINK}>Reabrir</button></p>
      )}
      {tentativa && status !== "resolvido" && <p data-testid="tentativa" className="text-sm font-medium text-gold-ink" suppressHydrationWarning>{tentativa}</p>}
      {resumo && <p className="text-sm leading-snug text-graphite" suppressHydrationWarning>{resumo}</p>}
    </section>
  );
}

/** O cartão único do próximo passo: a retomada ativa; senão o próximo horário; senão nada marcado. */
function ProximoPasso({ d, actions }: { d: DealDetail; actions: LeadActions }) {
  const r = d.nextAction;
  const msg = r ? d.scheduled.find((s) => s.taskId === r.id) ?? null : null;
  const a = d.context.nextAppointment;
  const visit = d.context.nextVisit ?? [];
  const fallback = !a && (d.stage.kind === "agendado" || d.stage.kind === "na_casa") && d.deal.scheduledAt ? new Date(d.deal.scheduledAt).toISOString() : null;
  const label = useClock((now) => (r ? dueLabel(new Date(r.dueAt).getTime(), now) : a ? dueLabel(Date.parse(a.startsAt), now) : fallback ? dueLabel(Date.parse(fallback), now) : null));
  const showAttendance = useClock((now) => askAttendance({ stageKind: d.stage.kind, scheduledAt: d.deal.scheduledAt, attendance: d.deal.attendance }, now));
  const futureVisit = useClock((now) => !!d.deal.scheduledAt && new Date(d.deal.scheduledAt).getTime() > now);
  const card = "flex flex-col gap-1.5 rounded-[14px] bg-paper-2 px-3 py-2.5";
  let body: ReactNode;
  if (r) {
    body = (
      <div className={card} data-testid="cartao-retomada">
        <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink" suppressHydrationWarning><IconClock size={14} aria-hidden />{msg ? "Mensagem sai" : "Retomar"} {label}</p>
        <p className="text-sm text-graphite">{r.title}{msg ? ". Sai sozinha." : ". Vira lembrete para você."}{r.assigneeName ? ` Com ${firstName(r.assigneeName)}.` : ""}</p>
        <div className="flex gap-2">
          <button type="button" disabled={actions.busy} onClick={actions.doneResume} className="min-h-9 flex-1 rounded-[10px] border border-line-strong bg-paper text-sm font-medium hover:border-ink pointer-coarse:min-h-11">Feito</button>
          <button type="button" disabled={actions.busy} onClick={() => actions.openResume({ motivo: r.title, text: msg ? stripSignature(msg.text) : "" })} className="min-h-9 flex-1 rounded-[10px] border border-line-strong bg-paper text-sm font-medium hover:border-ink pointer-coarse:min-h-11">Trocar</button>
        </div>
      </div>
    );
  } else if (label) {
    const pro = a?.professionalName ? displayName(a.professionalName) : null;
    const svc = a?.serviceLabel ?? d.services.find((s) => s.id === d.deal.serviceId)?.label ?? null;
    body = (
      <div className={card} data-testid="cartao-horario">
        <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink" suppressHydrationWarning><IconCalendar size={14} aria-hidden />{label}</p>
        {visit.length > 1 ? (
          <ul aria-label="Serviços da visita" className="flex flex-col gap-0.5 text-sm text-graphite">
            {visit.map((v, i) => (
              <li key={i}>{v.serviceLabel}{v.professionalName ? ` · ${v.assistant ? "assistente " : "com "}${displayName(v.professionalName)}` : ""}</li>
            ))}
          </ul>
        ) : (svc || pro) && <p className="text-sm text-graphite">{[svc, pro ? `com ${pro}${a?.requested ? " · Pediu ela" : ""}` : null].filter(Boolean).join(" · ")}</p>}
        {d.stage.kind === "na_casa" && <p className="text-sm font-semibold text-gold-ink">Na Casa agora</p>}
        {a?.id && <VisitActions appointmentId={a.id} onCancelled={() => actions.open("remarcar")} />}
        {/* Remarcar fica só em "O que fazer" (um caminho só; aqui ele não cabia ao lado do link e saía do painel). */}
        {!showAttendance && d.stage.kind !== "na_casa" && futureVisit && (
          <div className="flex flex-wrap gap-2 [&>*]:min-w-0 [&>*]:flex-1">
            <ClientLinkButton dealId={d.deal.id} />
          </div>
        )}
      </div>
    );
  } else {
    body = <p className="text-sm text-graphite">Nada marcado. Agende um horário ou marque quando retomar.</p>;
  }
  return (
    <section aria-label="Próximo passo" className="flex flex-col gap-1.5">
      <h4 className={LABEL}>Próximo passo</h4>
      {body}
      {showAttendance && <AttendanceBar attendance={d.deal.attendance} busy={actions.busy} onPick={actions.attendance} name={d.contact.name?.trim() || undefined} />}
    </section>
  );
}

function Agora({ d, viewer, actions }: { d: DealDetail; viewer: Viewer | null; actions: LeadActions }) {
  const k = d.stage.kind;
  const open = k !== "fechado" && k !== "perdido" && !d.deal.closedAt;
  const notIdentified = d.sourceLabel === NOT_IDENTIFIED || isChannelOrigin(d.sourceLabel);
  const voltar = useClock((now) => (d.context.retorno ? returnLine(d.context.retorno, bahiaDay(now)) : null));
  const aniversario = useClock((now) => {
    const t = new Date(now - 3 * 3_600_000);
    return !!d.contact.birthDay && d.contact.birthDay === t.getUTCDate() && d.contact.birthMonth === t.getUTCMonth() + 1;
  });
  return (
    <div className="flex flex-col gap-3.5">
      <Avisos d={d} />
      <Situacao d={d} actions={actions} />
      {aniversario && (
        <p className="flex flex-wrap items-center gap-x-2 rounded-[var(--radius-control)] bg-gold-soft/70 px-3 py-1.5 text-sm text-gold-ink">
          Faz aniversário hoje<button type="button" onClick={actions.birthday} className={LINK}>Mandar parabéns</button>
        </p>
      )}
      {open && d.contact.kind === "cliente" && <ProximoPasso d={d} actions={actions} />}
      {open && (
        <section aria-label="O que fazer" className="flex flex-col gap-1.5">
          <h4 className={LABEL}>O que fazer</h4>
          <button type="button" disabled={actions.busy} onClick={() => actions.open("schedule")} className={ACT}><IconCalendar size={15} aria-hidden />{k === "agendado" ? "Remarcar horário" : "Agendar horário"}</button>
          <button type="button" disabled={actions.busy} onClick={() => actions.openResume()} className={ACT}><IconClock size={15} aria-hidden />Retomar…</button>
          <button type="button" disabled={actions.busy} onClick={actions.orcamento} className={ACT}><span aria-hidden className="w-[15px] text-center text-sm font-bold">R$</span>Mandar orçamento</button>
        </section>
      )}
      {d.pauseSwitch && can(viewer?.perms, "atendimento.pausar") && <PauseSwitch contactId={d.contact.id} pausedUntil={d.pause} />}
      {voltar && <p className="text-sm text-graphite" suppressHydrationWarning><span className={LABEL}>Hora de voltar · </span>{voltar}</p>}
      {open && notIdentified && d.contact.kind === "cliente" && <HowKnown d={d} actions={actions} compact />}
    </div>
  );
}

function Linha({ k, v, onAdd }: { k: string; v: ReactNode | null; onAdd: () => void }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 text-sm">
      <dt className="shrink-0 text-muted">{k}</dt>
      <dd className="min-w-0 truncate text-right text-ink">{v ?? <button type="button" onClick={onAdd} className={LINK}>Adicionar</button>}</dd>
    </div>
  );
}

function Cliente({ d, viewer, actions }: { d: DealDetail; viewer: Viewer | null; actions: LeadActions }) {
  const c = d.context;
  const origem = d.sourceLabel === NOT_IDENTIFIED || isChannelOrigin(d.sourceLabel) ? null : originLabel(d.sourceLabel);
  const desde = new Date(c.knownSince ?? c.firstContactAt).toLocaleDateString("pt-BR", { month: "short", year: "numeric", timeZone: "America/Bahia" }).replace(". de ", "/").replace(" de ", "/").replace(".", "");
  const stats: [string, string][] = [
    ["Visitas", String(c.visits)], ...(c.totalCents != null ? [["Total gasto", c.totalCents > 0 ? formatBRL(c.totalCents) : "R$ 0"] as [string, string]] : []),
    ["Preferida", c.preferredProfessional ? displayName(c.preferredProfessional) ?? c.preferredProfessional : "Ainda não tem"], ["Cliente desde", c.isFirstContact ? "Hoje" : desde],
  ];
  const pkg = c.activePackage;
  const notas = [...d.notes].reverse().slice(0, 3);
  const ct = d.contact;
  const add = () => actions.open("dados");
  const canEdit = can(viewer?.perms, "contatos.ver");
  const nome = displayName(ct.name) || nameFallback(ct.phoneE164);
  return (
    <div className="flex flex-col gap-3.5">
      <Avisos d={d} />
      {/* A foto do WhatsApp grande, ao lado dos números (não empurra a aba para baixo); tocar amplia (17/10). */}
      <div className="flex min-w-0 items-start gap-3">
        <AvatarZoom contactId={ct.id} hasAvatar={!!ct.avatarPath} version={avatarVersion(ct.avatarCheckedAt)} name={nome} size={88} />
        <dl className="grid min-w-0 flex-1 grid-cols-2 gap-2">
          {stats.map(([k, v]) => <div key={k} className="min-w-0 rounded-[12px] bg-paper-2 px-2.5 py-1.5"><dt className="truncate text-xs text-muted">{k}</dt><dd title={v} className="truncate text-sm font-semibold text-ink">{v}</dd></div>)}
        </dl>
      </div>
      {pkg && (
        <div className="flex flex-col gap-1">
          <p className="flex justify-between gap-2 text-sm"><span className="truncate font-medium">{pkg.packageName}</span><span className="shrink-0 text-graphite">{pkg.usedSessions} de {pkg.totalSessions}</span></p>
          <span role="img" aria-label={`${pkg.usedSessions} de ${pkg.totalSessions} sessões`} className="h-1.5 overflow-hidden rounded-full bg-paper-3"><span className="block h-full rounded-full bg-gold" style={{ width: `${Math.min(100, Math.round((pkg.usedSessions / Math.max(1, pkg.totalSessions)) * 100))}%` }} /></span>
        </div>
      )}
      <section aria-label="Dados da cliente" className="flex flex-col">
        <div className="flex items-center justify-between">
          <h4 className={LABEL}>Dados da cliente</h4>
          {canEdit && <button type="button" onClick={add} className={LINK}>Editar dados</button>}
        </div>
        <dl className="divide-y divide-line/70">
          {ct.nickname && <Linha k="Como gosta de ser chamada" v={ct.nickname} onAdd={add} />}
          <Linha k="Aniversário" v={birthdayText(ct) || null} onAdd={add} />
          <Linha k="E-mail" v={ct.email} onAdd={add} />
          <Linha k="Instagram" v={ct.instagram ? `@${ct.instagram}` : null} onAdd={add} />
          {ct.phoneAlt && <Linha k="Outro telefone" v={ct.phoneAlt} onAdd={add} />}
          <Linha k="Como conheceu" v={origem} onAdd={add} />
          <Linha k="Tipo de cabelo" v={ct.hairType} onAdd={add} />
          <Linha k="Alergias e cuidados" v={ct.alertNotes ? ct.alertNotes.split("\n")[0] : null} onAdd={add} />
          {canEdit && <Linha k="CPF" v={ct.cpf ? <span className="tabular">{formatCpf(ct.cpf)}</span> : null} onAdd={add} />}
        </dl>
      </section>
      {d.phonePeople && <PeopleOnNumber key={d.contact.id} contactId={d.contact.id} people={d.phonePeople.people} variant="painel" />}
      <section aria-label="Etiquetas" className="flex flex-col gap-1.5">
        <h4 className={LABEL}>Etiquetas</h4>
        <TagsEditor key={d.deal.id} dealId={d.deal.id} tags={d.tags} options={d.tagOptions} />
      </section>
      {notas.length > 0 && (
        <section aria-label="Últimas notas" className="flex flex-col gap-1">
          <h4 className={LABEL}>Últimas notas</h4>
          {notas.map((n) => <p key={n.id} className="line-clamp-2 rounded-[10px] bg-gold-soft/50 px-2.5 py-1.5 text-sm text-ink">{n.body}</p>)}
        </section>
      )}
      <Link href={contactHref(d.contact.id)} className="inline-flex min-h-10 items-center text-sm font-semibold text-gold-ink underline-offset-4 hover:underline">Abrir ficha ›</Link>
    </div>
  );
}

/**
 * O painel da cliente (nova organização, 16/10): duas abas, nenhuma passa da altura da tela (1366x768).
 * Agora: a situação numa frase, o cartão único do próximo passo, O que fazer (Agendar horário, Retomar…, Mandar orçamento), Hora de voltar
 * e "Como conheceu?" enquanto vazio. Cliente: avisos, números, pacote, Dados da cliente com "Editar dados", etiquetas e as últimas notas.
 */
export function ClientPane({ d, viewer, actions, tab, onTab }: { d: DealDetail; viewer: Viewer | null; actions: LeadActions; tab: SideTab; onTab: (t: SideTab) => void }) {
  return (
    <div className="flex flex-col gap-3">
      <div role="tablist" aria-label="Painel da cliente" className="grid grid-cols-2 rounded-[12px] bg-paper-2 p-1">
        {(["agora", "cliente"] as const).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => onTab(t)}
            className={cn("relative min-h-9 rounded-[9px] text-sm font-medium transition-colors pointer-coarse:min-h-11", tab === t ? "text-ink" : "text-graphite hover:text-ink")}>
            {tab === t && <motion.span layoutId={`aba-cliente-${d.deal.id}`} transition={SPRING_UI} className="absolute inset-0 rounded-[9px] bg-paper shadow-[var(--shadow-card)]" />}
            <span className="relative">{t === "agora" ? "Agora" : "Cliente"}</span>
          </button>
        ))}
      </div>
      <div role="tabpanel" aria-label={tab === "agora" ? "Agora" : "Cliente"}>
        {tab === "agora" ? <Agora d={d} viewer={viewer} actions={actions} /> : <Cliente d={d} viewer={viewer} actions={actions} />}
      </div>
    </div>
  );
}
