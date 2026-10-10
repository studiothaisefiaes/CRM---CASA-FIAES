"use client";
import { useCallback, useState, useTransition, type ReactNode } from "react";
import type { DealDetail } from "@/server/queries/deal";
import type { Viewer } from "@/app/(app)/atendimento/actions";
import { archiveAction, claimAction, moveDealAction, restoreAction, transferAction } from "@/app/(app)/funil/actions";
import { useToast } from "@/components/ui/toast";
import { formatBRL } from "@/lib/money";
import { CloseSaleSheet } from "./close-sale-sheet";
import { LoseSheet } from "./lose-sheet";
import { ScheduleSheet } from "./schedule-sheet";
import { useCloseLead, useOpenLead } from "./open-lead";

type SheetKind = "schedule" | "close" | "lose";

export type LeadActions = {
  /** Muda de etapa. Agendado, Fechado e Perdido abrem a folha que pede o que falta; as outras movem direto. */
  moveTo: (stageKey: string) => void;
  open: (sheet: SheetKind) => void;
  claim: () => void;
  transfer: (userId: string, userName: string) => void;
  /** "Não é cliente": arquiva, sai do painel e oferece Desfazer por 8 s. */
  notClient: () => void;
  busy: boolean;
  sheets: ReactNode;
};

/**
 * Tudo que se faz com o lead aberto: mudar de etapa, assumir, transferir, agendar, fechar venda, perdido e "não é cliente".
 * O cabeçalho (⋯ no celular) e o painel do cliente usam o mesmo conjunto, então a regra mora num lugar só.
 * `reload` busca o lead de novo (o dono, a etapa e o resto da tela acompanham); a Fila se atualiza pelo tempo real.
 */
export function useLeadActions({ d, name, viewer, reload }: { d: DealDetail | null; name: string; viewer: Viewer | null; reload: () => Promise<unknown> }): LeadActions {
  const toast = useToast();
  const openLead = useOpenLead();
  const closeLead = useCloseLead();
  const [pending, start] = useTransition();
  // `n` renova a folha a cada abertura (campos do zero); `open` false deixa a animação de saída acontecer antes de sair da tela.
  const [sheet, setSheet] = useState<{ kind: SheetKind; n: number; open: boolean } | null>(null);

  const open = useCallback((kind: SheetKind) => setSheet((s) => ({ kind, n: (s?.n ?? 0) + 1, open: true })), []);
  const close = useCallback(() => setSheet((s) => (s ? { ...s, open: false } : s)), []);
  const done = useCallback((message: string, tone: "ok" | "info" = "ok") => { close(); toast(message, tone); void reload(); }, [close, toast, reload]);

  const moveTo = useCallback((key: string) => {
    if (!d) return;
    const to = d.stages.find((s) => s.key === key);
    if (!to) return;
    if (to.kind === "agendado") { open("schedule"); return; }
    if (to.id === d.deal.stageId) return;
    if (to.kind === "fechado") { open("close"); return; }
    if (to.kind === "perdido") { open("lose"); return; }
    start(async () => {
      const r = await moveDealAction(d.deal.id, key);
      toast(r.ok ? `${name} foi para ${to.name}` : r.error, r.ok ? "ok" : "error");
      void reload();
    });
  }, [d, name, open, reload, toast]);

  const claim = useCallback(() => {
    if (!d) return;
    start(async () => {
      const r = await claimAction(d.deal.id);
      toast(r.ok ? "Agora o lead é seu" : r.error, r.ok ? "ok" : "error");
      if (r.ok) await reload();
    });
  }, [d, reload, toast]);

  const transfer = useCallback((userId: string, userName: string) => {
    if (!d) return;
    start(async () => {
      const r = await transferAction(d.deal.id, userId);
      toast(r.ok ? `O lead agora é de ${userName.split(" ")[0]}` : r.error, r.ok ? "ok" : "error");
      if (r.ok) await reload();
    });
  }, [d, reload, toast]);

  const notClient = useCallback(() => {
    if (!d) return;
    const id = d.deal.id;
    start(async () => {
      const r = await archiveAction([id]);
      if (!r.ok) { toast(r.error, "error"); return; }
      closeLead();
      toast(`${name} saiu da fila`, "ok", {
        label: "Desfazer",
        onClick: () => {
          void restoreAction([id]).then((u) => {
            if (!u.ok) { toast(u.error, "error"); return; }
            if (u.data?.conflicts.length) { toast("Essa cliente já tem outro atendimento aberto. Não dá para desfazer.", "error"); return; }
            toast(`${name} voltou para a fila`);
            openLead(id);
          });
        },
      });
    });
  }, [d, name, closeLead, openLead, toast]);

  const sheets = d && sheet ? (
    <>
      {sheet.kind === "schedule" && (
        <ScheduleSheet key={`s${sheet.n}`} open={sheet.open} onClose={close} dealId={d.deal.id} name={name} scheduledAt={d.deal.scheduledAt ? new Date(d.deal.scheduledAt).toISOString() : null}
          reschedule={d.stage.kind === "agendado"} onDone={() => done(d.stage.kind === "agendado" ? "Avaliação remarcada" : "Avaliação agendada")} />
      )}
      {sheet.kind === "close" && (
        <CloseSaleSheet key={`c${sheet.n}`} open={sheet.open} onClose={close} dealId={d.deal.id} name={name} services={d.services.map((s) => ({ id: s.id, label: s.label }))}
          initial={{ serviceId: d.deal.serviceId, valueCents: d.deal.valueCents, paymentMethod: d.deal.paymentMethod }} canManage={viewer?.role === "gestor"}
          onDone={(r) => done(r.alreadyClosed ? "Essa venda já estava fechada" : `Venda fechada · ${formatBRL(r.valueCents)}`, r.alreadyClosed ? "info" : "ok")} />
      )}
      {sheet.kind === "lose" && (
        <LoseSheet key={`l${sheet.n}`} open={sheet.open} onClose={close} dealId={d.deal.id} name={name} reasons={d.lostReasons.map((l) => ({ id: l.id, label: l.label }))}
          onDone={() => done("Lead marcado como perdido")} />
      )}
    </>
  ) : null;

  return { moveTo, open, claim, transfer, notClient, busy: pending, sheets };
}

/** Sem lead carregado ainda (tela de abertura): nada acontece. */
export const NO_ACTIONS: LeadActions = { moveTo: () => {}, open: () => {}, claim: () => {}, transfer: () => {}, notClient: () => {}, busy: false, sheets: null };
