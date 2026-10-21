"use client";
import { useCallback, useEffect, useRef, useState, useTransition, type ComponentProps, type ReactNode } from "react";
import { can } from "@/lib/permissions";
import type { DealDetail, SheetDeal } from "@/server/queries/deal";
import type { Viewer } from "@/app/(app)/atendimento/actions";
import { archiveAction, archiveConversationAction, unarchiveConversationAction, claimAction, completeTaskAction, moveDealAction, proposalSentAction, restoreAction, setAttendanceAction, setOriginAction, transferAction, undoMissedAttendanceAction } from "@/app/(app)/funil/actions";
import { useToast } from "@/components/ui/toast";
import { formatBRL } from "@/lib/money";
import { CloseSaleSheet } from "./close-sale-sheet";
import { LoseSheet } from "./lose-sheet";
import { NextActionSheet } from "./next-action-sheet";
import { RetomarDialog } from "./retomar-dialog";
import { RemarcarDialog } from "./remarcar-dialog";
import { OrcamentoDialog } from "./orcamento-dialog";
import { DadosDialog } from "./dados-dialog";
import { PassarDialog } from "./passar-dialog";
import { RegisterCallDialog, dialedRecently } from "@/components/lead/register-call-dialog";
import { isHiddenNumber } from "@/lib/phone-client";
import { composerHasText, offerDraft } from "@/components/lead/composer-draft";
import { renderReply } from "@/lib/quick-reply";
import { dueLabel } from "@/lib/next-action";
import { ScheduleSheet } from "./schedule-sheet";
import { BookingSheet } from "@/components/agenda/booking-sheet";
import { useHours } from "@/components/pipeline/timer";
import { defaultSlot } from "@/lib/schedule";
import { useCloseLead, useOpenLead } from "./open-lead";
import { cancelPendingMessagesAction, cancelResumeAction, doneResumeAction, resolveAction, sendResumeNowAction, setConversationStatusAction, undoResolveAction } from "@/app/(app)/conversa/actions";
import { KeepScheduledDialog, type KeepAction } from "./keep-scheduled-dialog";
import { STATUS_LABEL, type ConversationStatus } from "@/lib/conversation-status";
import { setTeamContactAction } from "@/app/(app)/funil/actions";
import { useMarkContact } from "./contact-kind-menu";
import type { ContactKind } from "@/lib/contact-kind";
import { markAiSuggestionAction, type AiBooking } from "@/app/(app)/conversa/ai-actions";
import type { BookingInitial } from "@/components/agenda/booking-sheet";

/** O aviso diz o que aconteceu: registrou, criou o Remarcar ou manteve a próxima ação que já existia. */
export function attendanceToast(name: string, status: "compareceu" | "faltou", r?: { changed: boolean; remarcar: boolean }): string {
  if (!r?.changed) return "Já estava registrado";
  if (status === "compareceu") return `${name} veio`;
  return r.remarcar ? `${name} faltou · combinado: Remarcar` : `${name} faltou · o combinado que já existia foi mantido`;
}

type SheetKind = "schedule" | "close" | "lose" | "next" | "resume" | "orcamento" | "dados" | "passar" | "ligacao" | "remarcar";
type ResumeOpts = { text?: string; motivo?: string; /** Dia e hora já escolhidos (ex.: "Lembrar de remarcar" daqui a 30 dias). */ at?: number };
/** "Marcar este horário" da sugestão da IA: a folha abre preenchida; ao confirmar, a confirmação vai para a caixa (não é enviada). */
type AiBook = { booking: AiBooking; onBooked: () => void };
const isDetail = (d: SheetDeal | DealDetail | null): d is DealDetail => !!d && "contact" in d;

export type LeadActions = {
  /** Muda de etapa. Agendado, Fechado e Perdido abrem a folha que pede o que falta; as outras movem direto. */
  moveTo: (stageKey: string) => void;
  open: (sheet: SheetKind) => void;
  claim: () => void;
  transfer: (userId: string, userName: string) => void;
  /** "Não é cliente": arquiva, sai do painel e oferece Desfazer por 8 s. */
  notClient: () => void;
  /** "É da equipe" / "Não é da equipe": número de funcionária vai para a aba Equipe (avisa, mas fica fora do funil e das métricas). */
  toggleTeam: (isTeamNow: boolean) => void;
  /** "Marcar como…" Cliente, Equipe, Fornecedor ou Spam (17/10). Spam sai do painel; Fornecedor fica resolvido. Desfazer por 8 s. */
  setKind: (kind: ContactKind) => void;
  /** Resolver a conversa (o antigo Encerrar): sai da lista, Desfazer por 8 s; volta sozinha se alguém escrever. */
  archiveConversation: () => void;
  /** Status da conversa à mão: Aberto, Aguardando ou Resolvido (Resolvido = `archiveConversation`). */
  setStatus: (to: ConversationStatus) => void;
  unarchiveConversation: () => void;
  /** "Resolvido (não precisa responder)": encerra a espera sem mandar nada, com Desfazer. */
  resolve: () => void;
  /** Conclui a próxima ação (ou outra tarefa) com um toque. */
  completeTask: (taskId: string, title: string) => void;
  /** "Compareceu" / "Faltou" do agendamento. Faltou cria a próxima ação "Remarcar". */
  attendance: (status: "compareceu" | "faltou") => void;
  /** "Enviei orçamento": Orçamento enviado, retomada em 2 dias se ela não responder. */
  proposalSent: () => void;
  /** "Como conheceu?": grava a origem (uma origem cadastrada ou texto livre). Devolve true se salvou. */
  setOrigin: (choice: { sourceId: string } | { origin: string }) => Promise<boolean>;
  /** Retomar…: o diálogo único (lembrete ou mensagem programada). O relógio do campo abre com o texto já preenchido. */
  openResume: (o?: ResumeOpts) => void;
  /** Mandar orçamento: valor → mensagem pronta NO CAMPO (não envia) e a etapa vai para Orçamento, com Desfazer. */
  orcamento: () => void;
  doneResume: () => void;
  cancelResume: () => void;
  sendResumeNow: (outboxId: string) => void;
  /** "Mandar parabéns": a resposta "aniversario" no campo (só preenche). */
  birthday: () => void;
  /** Sugestão da IA com horário: a folha "Marcar horário" abre já com cliente, serviço, profissional, dia e hora. Nada é marcado sem o botão Marcar. */
  bookFromAi: (booking: AiBooking, onBooked: () => void) => void;
  /** A conversa marca pela folha "Marcar horário" (fora do modo consulta e com permissão): só aí a sugestão mostra "Marcar este horário". */
  canBookFromAi: boolean;
  busy: boolean;
  sheets: ReactNode;
};

/**
 * Tudo que se faz com o lead aberto: mudar de etapa, assumir, transferir, agendar, fechar venda, perdido e "não é cliente".
 * O cabeçalho (⋯ no celular) e o painel do cliente usam o mesmo conjunto, então a regra mora num lugar só.
 * `reload` busca o lead de novo (o dono, a etapa e o resto da tela acompanham); a Fila se atualiza pelo tempo real.
 */
/** "Agendar horário" fora do modo consulta (6B): o Marcar da Agenda já com a cliente, a conversa e o próximo horário do expediente (calculado ao abrir). */
function ConversationBooking({ open, onClose, d, name, viewer, onDone, prefill }: { open: boolean; onClose: () => void; d: SheetDeal; name: string; viewer: Viewer | null; onDone: ComponentProps<typeof BookingSheet>["onDone"];
  /** Da sugestão da IA: dia, hora, profissional e serviço já escolhidos (a atendente confere e confirma). */
  prefill?: Pick<BookingInitial, "day" | "time" | "professionalId" | "serviceId"> | null }) {
  const hours = useHours();
  const [slot] = useState(() => (prefill ? { date: prefill.day, time: prefill.time } : { date: defaultSlot(Date.now(), hours, null).date, time: "" })); // hora vazia: ninguém pediu esta hora (psico r68 #14)
  return (
    <BookingSheet open={open} onClose={onClose} agendaMode={d.agendaMode}
      services={d.services.map((s) => ({ id: s.id, label: s.label, durationMin: s.durationMin }))} professionals={d.professionals}
      canFitIn={can(viewer?.perms, "agenda.encaixar")} canEditConfig={can(viewer?.perms, "config.diaadia")}
      initial={{ day: slot.date, time: slot.time, serviceId: prefill?.serviceId ?? d.deal.serviceId, professionalId: prefill?.professionalId ?? d.deal.professionalId, client: { contactId: d.deal.contactId, name }, dealId: d.deal.id }}
      onDone={onDone} />
  );
}

export function useLeadActions({ d, name, viewer, reload }: { d: SheetDeal | null; name: string; viewer: Viewer | null; reload: () => Promise<unknown> }): LeadActions {
  const toast = useToast();
  const openLead = useOpenLead();
  const closeLead = useCloseLead();
  const [pending, start] = useTransition();
  // `n` renova a folha a cada abertura (campos do zero); `open` false deixa a animação de saída acontecer antes de sair da tela.
  const [sheet, setSheet] = useState<{ kind: SheetKind; n: number; open: boolean; resume?: ResumeOpts; ai?: AiBook } | null>(null);

  const open = useCallback((kind: SheetKind) => setSheet((s) => ({ kind, n: (s?.n ?? 0) + 1, open: true })), []);
  const openResume = useCallback((o?: ResumeOpts) => setSheet((s) => ({ kind: "resume", n: (s?.n ?? 0) + 1, open: true, resume: o ?? {} })), []);
  const close = useCallback(() => setSheet((s) => (s ? { ...s, open: false } : s)), []);
  const bookFromAi = useCallback((booking: AiBooking, onBooked: () => void) => setSheet((s) => ({ kind: "schedule", n: (s?.n ?? 0) + 1, open: true, ai: { booking, onBooked } })), []);
  const canBookFromAi = !!d && d.agendaMode !== "consulta" && can(viewer?.perms, "agenda.marcar");
  // P5: Resolver ou Perdido com mensagem programada pendente pergunta antes "Manter a mensagem de …?".
  const programadas = isDetail(d) ? d.scheduled : [];
  const [ask, setAskState] = useState<{ action: KeepAction; nowMs: number } | null>(null);
  const setAsk = useCallback((action: KeepAction | null) => setAskState(action ? { action, nowMs: Date.now() } : null), []);
  /** Perdido com "Cancelar": a programada só é cancelada quando a folha do Perdido for salva (fechar a folha não mexe em nada). */
  const loseCancels = useRef(false);
  const done = useCallback((message: string, tone: "ok" | "info" = "ok") => { close(); toast(message, tone); void reload(); }, [close, toast, reload]);
  // "Ligar agora" no celular: voltando para a conversa (mesmo com a página recarregada), o registro da ligação abre de novo.
  const dealKey = d?.deal.id;
  useEffect(() => {
    if (!dealKey || !dialedRecently(dealKey)) return;
    const t = setTimeout(() => open("ligacao"), 0); // depois da pintura: a conversa aparece e o registro abre por cima
    return () => clearTimeout(t);
  }, [dealKey, open]);

  const moveTo = useCallback((key: string) => {
    if (!d) return;
    const to = d.stages.find((s) => s.key === key);
    if (!to) return;
    if (to.kind === "agendado") { open("schedule"); return; }
    if (to.id === d.deal.stageId) return;
    if (to.kind === "fechado") { open("close"); return; }
    if (to.kind === "perdido") {
      loseCancels.current = false;
      if (programadas.length) setAsk("perdido"); else open("lose");
      return;
    }
    start(async () => {
      const r = await moveDealAction(d.deal.id, key);
      toast(r.ok ? `${name} foi para ${to.name}` : r.error, r.ok ? "ok" : "error");
      void reload();
    });
  }, [d, name, open, reload, toast, programadas.length, setAsk]);

  const claim = useCallback(() => {
    if (!d) return;
    start(async () => {
      const r = await claimAction(d.deal.id);
      toast(r.ok ? "Agora a conversa é sua" : r.error, r.ok ? "ok" : "error");
      if (r.ok) await reload();
    });
  }, [d, reload, toast]);

  const transfer = useCallback((userId: string, userName: string) => {
    if (!d) return;
    start(async () => {
      const r = await transferAction(d.deal.id, userId);
      toast(r.ok ? `Agora com ${userName.split(" ")[0]}` : r.error, r.ok ? "ok" : "error");
      if (r.ok) await reload();
    });
  }, [d, reload, toast]);

  const completeTask = useCallback((taskId: string, title: string) => {
    start(async () => {
      const r = await completeTaskAction(taskId);
      toast(r.ok ? `Concluída: ${title}` : r.error, r.ok ? "ok" : "error");
      if (r.ok) await reload();
    });
  }, [reload, toast]);

  const attendance = useCallback((status: "compareceu" | "faltou") => {
    if (!d) return;
    start(async () => {
      const r = await setAttendanceAction(d.deal.id, status);
      if (!r.ok) { toast(r.error, "error"); return; }
      const id = d.deal.id;
      // Faltou tem Desfazer (QA r58, M-2): a conversa volta como estava (etapa, combinados).
      const undo = status === "faltou" && r.data?.changed ? { label: "Desfazer", onClick: () => start(async () => {
        const u = await undoMissedAttendanceAction(id);
        toast(u.ok ? "Desfeito: a falta saiu" : u.error, u.ok ? "ok" : "error");
        if (u.ok) await reload();
      }) } : undefined;
      toast(attendanceToast(name, status, r.data), !r.data?.changed ? "info" : "ok", undo);
      await reload();
    });
  }, [d, name, reload, toast]);

  const proposalSent = useCallback(() => {
    if (!d) return;
    start(async () => {
      const r = await proposalSentAction(d.deal.id);
      toast(r.ok ? `Orçamento enviado · retomar ${dueLabel(new Date(r.data!.dueAt).getTime(), Date.now())} se ela não responder` : r.error, r.ok ? "ok" : "error");
      if (r.ok) await reload();
    });
  }, [d, reload, toast]);

  const setOrigin = useCallback(async (choice: { sourceId: string } | { origin: string }) => {
    if (!d) return false;
    const r = await setOriginAction({ dealId: d.deal.id, ...choice });
    toast(r.ok ? "Origem salva" : r.error, r.ok ? "ok" : "error");
    if (r.ok) await reload();
    return r.ok;
  }, [d, reload, toast]);

  const runArchive = useCallback((cancelMsgs: boolean) => {
    if (!d) return;
    const id = d.deal.id;
    start(async () => {
      if (cancelMsgs) {
        const c = await cancelPendingMessagesAction(id);
        if (!c.ok) { toast(c.error, "error"); return; }
      }
      const r = await archiveConversationAction(id);
      if (!r.ok) { toast(r.error, "error"); return; }
      setAsk(null);
      closeLead();
      toast(`Conversa com ${name} resolvida${cancelMsgs ? " e a mensagem programada cancelada" : ""}. Volta sozinha se ela escrever.`, "ok", {
        label: "Desfazer",
        onClick: () => { void unarchiveConversationAction(id).then((u) => { if (!u.ok) { toast(u.error, "error"); return; } toast("Conversa reaberta"); openLead(id); }); },
      });
    });
  }, [d, name, closeLead, openLead, toast, setAsk]);
  const archiveConversation = useCallback(() => {
    if (programadas.length) { setAsk("resolver"); return; }
    runArchive(false);
  }, [programadas.length, runArchive, setAsk]);
  /** A resposta da pergunta: Resolver segue na hora; Perdido abre a folha do motivo (a programada só cai quando ela for salva). */
  const answerKeep = useCallback((cancelMsgs: boolean) => {
    if (ask?.action === "resolver") { runArchive(cancelMsgs); return; }
    loseCancels.current = cancelMsgs;
    setAsk(null);
    open("lose");
  }, [ask, runArchive, open, setAsk]);

  const resolve = useCallback(() => {
    if (!d) return;
    const id = d.deal.id;
    start(async () => {
      const r = await resolveAction(id);
      if (!r.ok) { toast(r.error, "error"); return; }
      await reload();
      if (!r.data?.resolved) { toast("Ela não estava esperando resposta", "info"); return; }
      toast("Resolvida: saiu do prazo e dos avisos. Volta se ela escrever.", "ok", {
        label: "Desfazer",
        onClick: () => { void undoResolveAction(id).then(async (u) => { if (!u.ok) { toast(u.error, "error"); return; } await reload(); toast("Voltou a esperar resposta"); }); },
      });
    });
  }, [d, reload, toast]);

  const unarchiveConversation = useCallback(() => {
    if (!d) return;
    const id = d.deal.id;
    start(async () => {
      const r = await unarchiveConversationAction(id);
      toast(r.ok ? "Conversa reaberta" : r.error, r.ok ? "ok" : "error");
      if (r.ok) await reload();
    });
  }, [d, reload, toast]);

  const setStatus = useCallback((to: ConversationStatus) => {
    if (!d) return;
    if (to === "resolvido") { archiveConversation(); return; }
    const id = d.deal.id;
    start(async () => {
      const r = await setConversationStatusAction(id, to);
      if (!r.ok) { toast(r.error, "error"); return; }
      await reload();
      if (!r.data?.changed) return;
      const before = r.data.before;
      toast(`Status: ${STATUS_LABEL[to]}`, "ok", {
        label: "Desfazer",
        onClick: () => { void setConversationStatusAction(id, before).then(async (u) => { if (!u.ok) { toast(u.error, "error"); return; } await reload(); }); },
      });
    });
  }, [d, archiveConversation, reload, toast]);

  const toggleTeam = useCallback((isTeamNow: boolean) => {
    if (!d) return;
    const contactId = d.deal.contactId, on = !isTeamNow;
    start(async () => {
      const r = await setTeamContactAction(contactId, on);
      if (!r.ok) { toast(r.error, "error"); return; }
      toast(on ? `${name} marcada como da Casa: a conversa fica na lista da Equipe` : `${name} voltou a ser cliente`, "ok", {
        label: "Desfazer", onClick: () => { void setTeamContactAction(contactId, !on).then((u) => { if (!u.ok) toast(u.error, "error"); else void reload(); }); },
      });
      await reload();
    });
  }, [d, name, reload, toast]);

  // Spam guarda o lead: a conversa sai da tela. O Desfazer devolve e abre de novo (como o antigo "Não é cliente").
  const dealIdNow = d?.deal.id ?? null;
  const marker = useMarkContact((k, undone) => {
    if (k === "spam") { closeLead(); return; }
    if (undone && dealIdNow) openLead(dealIdNow);
    void reload();
  });
  const setKind = useCallback((kind: ContactKind) => {
    if (!isDetail(d)) return;
    marker.mark(d.contact.id, name, kind);
  }, [d, name, marker]);

  const notClient = useCallback(() => {
    if (!d) return;
    const id = d.deal.id;
    start(async () => {
      const r = await archiveAction([id]);
      if (!r.ok) { toast(r.error, "error"); return; }
      if (!r.data?.archived) { toast("Essa conversa é de outra pessoa", "error"); return; }
      closeLead();
      toast(`${name} saiu da lista (não é cliente)`, "ok", {
        label: "Desfazer",
        onClick: () => {
          void restoreAction([id]).then((u) => {
            if (!u.ok) { toast(u.error, "error"); return; }
            if (u.data?.restored === 0 && !u.data.conflicts.length) { toast("Essa conversa já tinha voltado", "info"); return; }
            if (u.data?.conflicts.length) { toast("Essa cliente já tem outro atendimento aberto. Não dá para desfazer.", "error"); return; }
            toast(`${name} voltou para a lista`);
            openLead(id);
          });
        },
      });
    });
  }, [d, name, closeLead, openLead, toast]);

  /** Salva a origem sem aviso próprio (o diálogo de dados avisa uma vez só). */
  const setOriginQuiet = useCallback(async (choice: { sourceId: string } | { origin: string }) => {
    if (!d) return false;
    const r = await setOriginAction({ dealId: d.deal.id, ...choice });
    return r.ok;
  }, [d]);

  const orcamento = useCallback(() => open("orcamento"), [open]);

  /** O texto vai para o campo (quem envia é a atendente) e a etapa vai para Orçamento, com Desfazer. Já com horário, só o texto. */
  const sendOrcamento = useCallback((text: string) => {
    if (!d) return;
    const id = d.deal.id, before = d.stage.key, kind = d.stage.kind;
    offerDraft(id, text);
    if (kind === "proposta" || kind === "agendado" || kind === "na_casa" || kind === "atendido" || kind === "perdido" || kind === "fechado") {
      toast("A mensagem está no campo: confira e envie.", "ok");
      return;
    }
    start(async () => {
      const r = await proposalSentAction(id);
      if (!r.ok) { toast(r.error, "error"); return; }
      toast("Mensagem no campo: confira e envie. Etapa → Orçamento.", "ok", {
        label: "Desfazer", onClick: () => { void moveDealAction(id, before).then((u) => { if (!u.ok) toast(u.error, "error"); else void reload(); }); },
      });
      await reload();
    });
  }, [d, reload, toast]);

  const doneResume = useCallback(() => {
    if (!d) return;
    start(async () => { const r = await doneResumeAction(d.deal.id); toast(r.ok ? "Retomada feita" : r.error, r.ok ? "ok" : "error"); if (r.ok) await reload(); });
  }, [d, reload, toast]);
  const cancelResume = useCallback(() => {
    if (!d) return;
    start(async () => { const r = await cancelResumeAction(d.deal.id); toast(r.ok ? "Retomada cancelada" : r.error, r.ok ? "ok" : "error"); if (r.ok) await reload(); });
  }, [d, reload, toast]);
  const sendResumeNow = useCallback((outboxId: string) => {
    start(async () => { const r = await sendResumeNowAction(outboxId); toast(r.ok ? "Mensagem enviada" : r.error, r.ok ? "ok" : "error"); if (r.ok) await reload(); });
  }, [reload, toast]);
  const birthday = useCallback(() => {
    if (!isDetail(d)) return;
    const reply = d.quickReplies.find((q) => q.label.toLowerCase() === "aniversario")?.body ?? "Feliz aniversário, {primeiro_nome}! 🎉 Toda a equipe da Casa Fiaes te deseja um dia lindo.";
    offerDraft(d.deal.id, renderReply(reply, d.replyVars).text);
    toast("Parabéns no campo: confira e envie.", "ok");
  }, [d, toast]);

  const keepDialog = ask && (
    <KeepScheduledDialog open action={ask.action} items={programadas} nowMs={ask.nowMs} pending={pending}
      onKeep={() => answerKeep(false)} onCancelMessage={() => answerKeep(true)} onClose={() => setAsk(null)} />
  );
  const sheets = d && (sheet || keepDialog) ? (
    <>
      {keepDialog}
      {sheet && <>
      {sheet.kind === "schedule" && (d.agendaMode !== "consulta" && can(viewer?.perms, "agenda.marcar") ? (
        // Lote 6B: fora do modo consulta, a conversa marca na agenda (a etapa vai para Agendado pelo funil do 1C).
        <ConversationBooking key={`b${sheet.n}`} open={sheet.open} onClose={close} d={d} name={name} viewer={viewer}
          prefill={sheet.ai ? { day: sheet.ai.booking.slot.day, time: sheet.ai.booking.slot.time, professionalId: sheet.ai.booking.slot.professionalId, serviceId: sheet.ai.booking.slot.serviceId } : null}
          onDone={(r) => {
            const ai = sheet.ai;
            if (!ai) {
              // Psico r68 #15: marcou pela conversa, o texto de confirmação já vem na caixa (só se ela não estava escrevendo); a atendente confere e envia.
              if (r.confirm && !composerHasText(d.deal.id)) { offerDraft(d.deal.id, r.confirm); done(`${r.message} · a confirmação está na caixa de mensagem: confira e envie`); return; }
              done(r.message); return;
            }
            // Marcado pela sugestão: a confirmação vai para a caixa (a atendente confere e envia) e a sugestão sai da tela.
            offerDraft(d.deal.id, ai.booking.confirm);
            void markAiSuggestionAction({ id: ai.booking.suggestionId, dealId: d.deal.id, what: "usada" });
            ai.onBooked();
            done(`${r.message} · a confirmação está na caixa de mensagem: confira e envie`);
          }} />
      ) : (
        <ScheduleSheet key={`s${sheet.n}`} open={sheet.open} onClose={close} dealId={d.deal.id} name={name} scheduledAt={d.deal.scheduledAt ? new Date(d.deal.scheduledAt).toISOString() : null}
          reschedule={d.stage.kind === "agendado"} services={d.services.map((s) => ({ id: s.id, label: s.label }))} professionals={d.professionals}
          initial={{ serviceId: d.deal.serviceId, professionalId: d.deal.professionalId }}
          onDone={(_, warning) => done(warning ?? (d.stage.kind === "agendado" ? "Horário remarcado" : "Horário marcado"), warning ? "info" : "ok")} />
      ))}
      {sheet.kind === "close" && (
        <CloseSaleSheet key={`c${sheet.n}`} open={sheet.open} onClose={close} dealId={d.deal.id} name={name} services={d.services.map((s) => ({ id: s.id, label: s.label }))}
          initial={{ serviceId: d.deal.serviceId, valueCents: d.deal.valueCents, paymentMethod: d.deal.paymentMethod }} canManage={can(viewer?.perms, "config.diaadia")}
          onDone={(r) => done(r.alreadyClosed ? "Essa venda já estava fechada" : `Venda fechada · ${formatBRL(r.valueCents)}`, r.alreadyClosed ? "info" : "ok")} />
      )}
      {sheet.kind === "lose" && (
        <LoseSheet key={`l${sheet.n}`} open={sheet.open} onClose={close} dealId={d.deal.id} name={name} reasons={d.lostReasons.map((l) => ({ id: l.id, label: l.label }))}
          onDone={() => {
            if (!loseCancels.current) { done("Marcada como perdido"); return; }
            loseCancels.current = false;
            void cancelPendingMessagesAction(d.deal.id).then((c) => done(c.ok ? "Marcada como perdido · mensagem programada cancelada" : `Marcada como perdido, mas a mensagem programada não foi cancelada: ${c.error}`, c.ok ? "ok" : "info"));
          }} />
      )}
      {sheet.kind === "next" && (
        <NextActionSheet key={`n${sheet.n}`} open={sheet.open} onClose={close} dealId={d.deal.id} name={name} people={d.people}
          defaultAssigneeId={d.deal.ownerId ?? viewer?.id ?? null} replacing={d.nextAction?.title ?? null} onDone={() => done("Combinado salvo")} />
      )}
      {sheet.kind === "resume" && (
        <RetomarDialog key={`r${sheet.n}`} open={sheet.open} onClose={close} dealIds={[d.deal.id]} name={name} initialText={sheet.resume?.text ?? ""} initialMotivo={sheet.resume?.motivo ?? ""} initialAt={sheet.resume?.at}
          prontas={isDetail(d) ? d.quickReplies : []}
          onDone={(r) => { if (r.texto && sheet.resume?.text) offerDraft(d.deal.id, ""); done(r.texto ? `Mensagem programada · ${dueLabel(Date.parse(r.dueAt), Date.now())}` : `Lembrete salvo · ${dueLabel(Date.parse(r.dueAt), Date.now())}`); }} />
      )}
      {sheet.kind === "remarcar" && (
        <RemarcarDialog key={`rm${sheet.n}`} open={sheet.open} onClose={close} name={name} onPick={(o) => openResume(o)} />
      )}
      {sheet.kind === "orcamento" && (
        <OrcamentoDialog key={`o${sheet.n}`} open={sheet.open} onClose={close} name={name} services={d.services.map((s) => ({ id: s.id, label: s.label }))} initialServiceId={d.deal.serviceId}
          onConfirm={(r) => { close(); sendOrcamento(r.text); }} />
      )}
      {sheet.kind === "dados" && isDetail(d) && (
        <DadosDialog key={`d${sheet.n}`} open={sheet.open} onClose={close} d={d} setOrigin={setOriginQuiet} onSaved={(n) => done(n ? "Dados salvos" : "Nada mudou", n ? "ok" : "info")} />
      )}
      {sheet.kind === "ligacao" && (
        <RegisterCallDialog key={`g${sheet.n}`} open={sheet.open} onClose={close} dealId={d.deal.id} name={name}
          phone={isDetail(d) && d.contact.phoneE164 && !isHiddenNumber(d.contact.phoneE164) ? d.contact.phoneE164 : null}
          onSaved={(r) => { if (r.answered) { toast("Ligação registrada", "ok"); void reload(); } else done("Ligação registrada · não atendida"); }}
          onBook={() => open("schedule")} />
      )}
      {sheet.kind === "passar" && (
        <PassarDialog key={`p${sheet.n}`} open={sheet.open} onClose={close} dealId={d.deal.id} people={d.people} teams={can(viewer?.perms, "atendimento.setor") ? d.teams : []} ownerId={d.deal.ownerId} viewerId={viewer?.id ?? null}
          onDone={(r) => done(r.team ? `Passada para o setor ${r.name}` : r.id === viewer?.id ? "Agora com você" : `Agora com ${r.name.split(" ")[0]}. Ela recebeu o aviso.`)} />
      )}
      </>}
    </>
  ) : null;

  return { moveTo, open, claim, transfer, notClient, toggleTeam, setKind, archiveConversation, setStatus, unarchiveConversation, resolve, completeTask, attendance, proposalSent, setOrigin,
    openResume, orcamento, doneResume, cancelResume, sendResumeNow, birthday, bookFromAi, canBookFromAi, busy: pending, sheets };
}

/** Sem lead carregado ainda (tela de abertura): nada acontece. */
export const NO_ACTIONS: LeadActions = { moveTo: () => {}, open: () => {}, claim: () => {}, transfer: () => {}, notClient: () => {}, toggleTeam: () => {}, setKind: () => {}, archiveConversation: () => {}, setStatus: () => {}, unarchiveConversation: () => {}, resolve: () => {}, completeTask: () => {}, attendance: () => {}, proposalSent: () => {}, setOrigin: async () => false,
  openResume: () => {}, orcamento: () => {}, doneResume: () => {}, cancelResume: () => {}, sendResumeNow: () => {}, birthday: () => {}, bookFromAi: () => {}, canBookFromAi: false, busy: false, sheets: null };
