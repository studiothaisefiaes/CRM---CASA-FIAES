"use client";
import type { ReactNode } from "react";
import type { DealDetail } from "@/server/queries/deal";
import type { Viewer } from "@/app/(app)/atendimento/actions";
import { ContactAvatar } from "@/components/ui/contact-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Menu, type MenuItem } from "@/components/ui/menu";
import { LeadSide } from "@/components/lead/lead-sheet";
import { IconCalendar } from "@/components/icons";
import { formatPhoneClient } from "@/lib/phone-client";
import { PAYMENT_LABEL } from "@/lib/format";
import { formatBRL } from "@/lib/money";
import { isChannelOrigin, NOT_IDENTIFIED } from "@/lib/source-kinds";
import { cn } from "@/lib/cn";
import type { PaneTab } from "./pane-header";
import type { LeadActions } from "./use-lead-actions";
import { StagePath } from "./stage-path";
import { WhyLate } from "./why-late";

const longDate = (iso: string | Date) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", timeZone: "America/Bahia" })} às ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Bahia" })}`;
};
const shortDate = (iso: string | Date) => new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Bahia" });

const H = "text-xs font-semibold uppercase tracking-[0.08em] text-muted";

/** Quem é o dono do lead e como mudar: Assumir (quando não é meu) e, para a gestão, Transferir para… */
function Owner({ d, viewer, actions }: { d: DealDetail; viewer: Viewer | null; actions: LeadActions }) {
  const mine = !!viewer && d.deal.ownerId === viewer.id;
  const gestor = viewer?.role === "gestor";
  const others: MenuItem[] = d.people.filter((p) => p.id !== d.deal.ownerId).map((p) => ({ label: p.name, onSelect: () => actions.transfer(p.id, p.name) }));
  return (
    <div className="flex flex-col gap-2.5 rounded-[var(--radius-card)] border border-line bg-paper px-3.5 py-3">
      <div className="min-w-0">
        <p className="text-xs text-muted">Responsável</p>
        <p data-testid="responsavel" className={cn("truncate text-md font-medium lg:text-base", d.ownerName ? "text-ink" : "text-gold-ink")}>{d.ownerName ?? "Sem dono"}</p>
      </div>
      {viewer && (!mine || gestor) && (
        <div className="flex flex-col gap-2">
          {!mine && <Button variant="secondary" size="sm" className="w-full pointer-coarse:min-h-11" disabled={actions.busy} onClick={actions.claim}>Assumir</Button>}
          {gestor && others.length > 0 && (
            <Menu label="Transferir para…" trigger={<span className="whitespace-nowrap px-1 text-sm font-medium">Transferir para…</span>} items={others} className="w-full"
              triggerClassName="w-full border border-line-strong bg-paper h-8 pointer-coarse:min-h-11 text-ink" />
          )}
        </div>
      )}
    </div>
  );
}

/** O que aconteceu de decisivo: venda fechada, perdido ou o horário marcado. */
function Outcome({ d }: { d: DealDetail }) {
  const k = d.stage.kind;
  const svc = d.services.find((s) => s.id === d.deal.serviceId)?.label;
  if (k === "fechado") {
    return (
      <div className="rounded-[var(--radius-control)] border-l-4 border-ok bg-ok-soft px-3 py-2.5 text-sm text-ok">
        <p className="font-semibold">Venda fechada{d.deal.valueCents != null ? ` · ${formatBRL(d.deal.valueCents)}` : ""}</p>
        <p className="mt-0.5">{[svc, d.deal.paymentMethod ? PAYMENT_LABEL[d.deal.paymentMethod] : null, d.deal.paidAt ? `pago em ${shortDate(d.deal.paidAt)}` : "ainda não pago"].filter(Boolean).join(" · ")}</p>
      </div>
    );
  }
  if (k === "perdido") {
    const reason = d.lostReasons.find((r) => r.id === d.deal.lostReasonId)?.label;
    return (
      <div className="rounded-[var(--radius-control)] border-l-4 border-alert bg-alert-soft px-3 py-2.5 text-sm text-alert">
        <p className="font-semibold">Perdido{reason ? ` · ${reason}` : ""}</p>
        {d.deal.recontactAt && <p className="mt-0.5">Retomar contato em {shortDate(d.deal.recontactAt)}</p>}
      </div>
    );
  }
  if (k === "agendado" && d.deal.scheduledAt) {
    return (
      <p className="flex items-start gap-2 rounded-[var(--radius-control)] bg-gold-soft px-3 py-2.5 text-sm text-gold-ink">
        <IconCalendar size={16} className="mt-0.5 shrink-0" aria-hidden /><span><span className="font-semibold">Agendado</span> para {longDate(d.deal.scheduledAt)}</span>
      </p>
    );
  }
  return null;
}

const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="flex items-baseline justify-between gap-3 py-1.5 text-sm"><dt className="text-muted">{label}</dt><dd className="min-w-0 truncate text-right text-ink">{children}</dd></div>
);

/**
 * O painel do cliente (à direita da conversa; a aba Dados no celular). De cima para baixo: quem é a cliente, em que pé está
 * (etapa, por que está esperando), o que fazer agora (ações primárias), o caminho das etapas e, por último, os dados editáveis.
 */
export function ClientPane({ d, tab, viewer, actions }: { d: DealDetail; tab: PaneTab; viewer: Viewer | null; actions: LeadActions }) {
  const name = d.contact.name?.trim() || formatPhoneClient(d.contact.phoneE164);
  const k = d.stage.kind;
  const open = k !== "fechado" && k !== "perdido";
  const source = d.sourceLabel === NOT_IDENTIFIED || isChannelOrigin(d.sourceLabel) ? NOT_IDENTIFIED : d.sourceLabel;
  const svc = d.services.find((s) => s.id === d.deal.serviceId)?.label;
  const last = d.messages.at(-1);
  // Celular: a aba Histórico mostra só a linha do tempo; no painel largo tudo fica visível.
  const top = tab === "historico" ? "hidden xl:flex" : "flex";

  return (
    <>
      <div className={cn(top, "flex-col gap-4 pb-5")}>
        <div className="flex items-center gap-3.5">
          <ContactAvatar contactId={d.contact.id} hasAvatar={!!d.contact.avatarPath} name={name} size={52} />
          <div className="min-w-0 flex-1">
            <h3 className="truncate font-serif text-xl leading-tight font-light">{name}</h3>
            <p className="truncate text-sm text-graphite">{formatPhoneClient(d.contact.phoneE164)}</p>
          </div>
          {d.contact.isClient && <Badge tone="ok" className="self-start">Cliente</Badge>}
        </div>

        <Owner d={d} viewer={viewer} actions={actions} />

        <section aria-label="Situação" className="flex flex-col gap-2.5">
          <div className="flex items-center gap-2">
            <h4 className={H}>Situação</h4>
            <Badge tone={k === "fechado" ? "ok" : k === "perdido" ? "alert" : "gold"}>{d.stage.name}</Badge>
          </div>
          <Outcome d={d} />
          {open && <WhyLate awaitingSince={d.deal.awaitingReplySince ? new Date(d.deal.awaitingReplySince).toISOString() : null} slaMinutes={d.stage.slaMinutes}
            lastAt={last ? new Date(last.createdAt).toISOString() : null} lastDirection={last?.direction ?? null} />}
        </section>

        <section aria-label="Ações" className="flex flex-col gap-2">
          <h4 className={H}>Ações</h4>
          {open && (
            <>
              {k === "agendado"
                ? <Button size="lg" className="w-full" onClick={() => actions.open("close")}>Fechar venda</Button>
                : <Button size="lg" className="w-full" onClick={() => actions.open("schedule")}>Agendar</Button>}
              <div className="grid grid-cols-2 gap-2">
                {k === "agendado" ? <Button variant="secondary" size="lg" onClick={() => actions.open("schedule")}>Remarcar</Button> : <Button variant="secondary" size="lg" onClick={() => actions.open("close")}>Fechar venda</Button>}
                <Button variant="secondary" size="lg" className="text-alert" onClick={() => actions.open("lose")}>Perdido</Button>
              </div>
            </>
          )}
          {/* Lead com venda fechada não vira "não é cliente". */}
          {k !== "fechado" && (
            <button type="button" disabled={actions.busy} onClick={actions.notClient}
              className="min-h-11 self-start rounded-[var(--radius-control)] text-sm font-medium text-graphite underline-offset-4 hover:text-ink hover:underline disabled:opacity-60 lg:min-h-9">
              Não é cliente
            </button>
          )}
        </section>

        <section aria-label="Etapa">
          <h4 className={cn(H, "mb-1.5")}>Etapa</h4>
          <StagePath stages={d.stages} currentKey={d.stage.key} onPick={actions.moveTo} busy={actions.busy} />
        </section>

        <dl className="divide-y divide-line border-y border-line">
          <Row label="Origem">{source}</Row>
          <Row label="Canal">{d.channelName ?? "—"}</Row>
          <Row label="Serviço">{svc ?? "—"}</Row>
        </dl>
      </div>
      <LeadSide d={d} tab={tab} bp="xl" cols="grid-cols-1" />
    </>
  );
}
