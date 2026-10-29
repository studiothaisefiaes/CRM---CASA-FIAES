"use client";
import { DictateButton } from "./dictate-button";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { IconClose } from "@/components/icons";
import { useToast } from "@/components/ui/toast";
import { useLive } from "@/components/shell/live";
import { composerHasText, offerDraft } from "./composer-draft";
import type { QuoteTarget } from "./composer";
import { getAiSuggestionAction, markAiSuggestionAction, prepareAiBookingAction, programarRetomadaAction, requestAiSuggestionAction, type AiBooking, type AiView } from "@/app/(app)/conversa/ai-actions";
import { dueLabel } from "@/lib/next-action";
import { slotLabel, type ProposedSlot } from "@/lib/proposed-slot";
import { EASE, T } from "@/lib/motion";

const TZ = "America/Bahia";
/** "Horários da agenda de hoje às 14:05 — confira antes de enviar" (outro dia: "de 20/10 às 14:05"). */
export function agendaNote(iso: string, now = new Date()): string {
  const at = new Date(iso);
  const day = (d: Date) => d.toLocaleDateString("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit" });
  const hm = at.toLocaleTimeString("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
  return `Horários da agenda ${day(at) === day(now) ? "de hoje" : `de ${day(at)}`} às ${hm} — confira antes de enviar`;
}

/**
 * Sugestão de resposta por IA, logo acima da caixa de mensagem. A IA NUNCA envia: "Usar" só põe o texto na caixa (editável)
 * e quem envia é a atendente. Só no botão (economia, pedido do dono 16/10): abrir a conversa NÃO gera nada. "Sugerir resposta" fica
 * sempre disponível com a IA ligada, mesmo com a Casa por último (a IA escreve a próxima mensagem da Casa), com um tema opcional
 * ("Sobre o quê?") e, se a atendente marcou uma mensagem para responder (`replyTo`), a IA responde a ela. A sugestão gerada fica
 * guardada por pedido (quem pedir o mesmo depois vê a mesma, sem gastar de novo). Some quando chega mensagem nova, no X ou no Usar.
 * Precisa de alguém da equipe (reclamação, desconto, remarcação): mostra o motivo primeiro. Desligada: não aparece nada.
 * Horário proposto (17/10): "Marcar este horário" confere de novo no servidor e abre a folha "Marcar horário" PREENCHIDA (`onBook`);
 * nada é marcado sem a atendente confirmar na folha. Depois de "Usar e editar", o horário fica numa faixa até marcar ou fechar.
 * Material (24/10): a IA indicou o vídeo/foto de uma resposta pronta ("📎 vai junto"); o "Usar" prende o anexo na caixa e o texto vai
 * como legenda. Nada sai sozinho.
 */
export function AiSuggestion({ dealId, replyTo = null, onBook }: { dealId: string; replyTo?: QuoteTarget | null;
  /** Abre a folha "Marcar horário" preenchida; `onBooked` quando a atendente confirmou a marcação. Ausente: sem o botão (sem permissão/modo consulta). */
  onBook?: (b: AiBooking, onBooked: () => void) => void }) {
  const [v, setV] = useState<AiView>({ state: "nada" });
  const s = v.state === "pronta" ? v.suggestion : null;
  const [replace, setReplace] = useState(false);
  const [pending, start] = useTransition();
  const toast = useToast();
  const seq = useRef(0);
  // O tema vale para a conversa em que foi escrito (trocar de conversa limpa).
  const [temaOf, setTemaOf] = useState({ dealId, text: "" });
  const tema = temaOf.dealId === dealId ? temaOf.text : "";
  const setTema = (text: string) => setTemaOf({ dealId, text });
  // O horário da sugestão que a atendente usou ("Usar e editar"): fica numa faixa para marcar depois de enviar.
  const [kept, setKept] = useState<{ dealId: string; id: string; horario: ProposedSlot } | null>(null);
  const keptHere = kept?.dealId === dealId ? kept : null;
  const [booking, setBooking] = useState(false);
  // Cancelou sem nova data (Cati 17/10): a retomada proposta. Fica numa faixa depois do "Usar e editar"; `feitas`: já programadas aqui.
  const [keptRet, setKeptRet] = useState<{ dealId: string; id: string; at: string } | null>(null);
  const keptRetHere = keptRet?.dealId === dealId ? keptRet : null;
  const [feitas, setFeitas] = useState<Record<string, string>>({});
  const [programando, setProgramando] = useState(false);
  const programar = async (id: string) => {
    if (programando) return;
    setProgramando(true);
    const r = await programarRetomadaAction({ id, dealId }).catch(() => null).finally(() => setProgramando(false));
    if (!r) { toast("Não deu para programar agora. Tente de novo.", "error"); return; }
    if (!r.ok) { toast(r.error, "error"); return; }
    setFeitas((f) => ({ ...f, [id]: r.data.dueAt }));
    toast(`Retomada marcada para ${dueLabel(new Date(r.data.dueAt).getTime(), Date.now())}. É um lembrete: nada é enviado.`);
  };
  const book = async (id: string, keep: boolean) => {
    if (!onBook) return;
    setBooking(true);
    const r = await prepareAiBookingAction({ id, dealId }).finally(() => setBooking(false));
    if (!r.ok) { toast(r.error, "error"); return; }
    if (r.data.livre === false) toast("Esse horário não está mais livre. Escolha outro na folha.", "error");
    onBook(r.data, () => { if (keep) setKept(null); });
  };

  const load = useCallback((open = false) => {
    const mine = ++seq.current;
    void getAiSuggestionAction(dealId, open).then((r) => { if (mine === seq.current && r.ok) { setV(r.data); setReplace(false); } }, () => {});
  }, [dealId]);
  // Abrir só busca a guardada (não gera).
  useEffect(() => { load(false); }, [load]);
  // Mensagem nova, resposta da Casa ou sugestão nova: confere de novo (rajada vira uma busca só).
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useLive([`deal:${dealId}`], () => { clearTimeout(timer.current); timer.current = setTimeout(() => load(false), 300); });
  useEffect(() => () => clearTimeout(timer.current), []);
  // "Escrevendo": o tempo real traz o texto; se o aviso se perder, confere de novo.
  useEffect(() => {
    if (v.state !== "escrevendo") return;
    const t = setTimeout(() => load(false), 10_000);
    return () => clearTimeout(t);
  }, [v, load]);

  // O texto se edita no próprio cartão (20/10, a Cati não achava como editar); "Usar e editar" leva o que está escrito aqui para a caixa.
  const [edit, setEdit] = useState<{ id: string; text: string } | null>(null);
  const shown = s ? (edit?.id === s.id ? edit.text : s.sugestao) : "";
  const mark = (what: "usada" | "fechada") => { if (s) void markAiSuggestionAction({ id: s.id, dealId, what }); };
  const fill = () => {
    if (!s) return;
    // A IA indicou o vídeo/foto de uma resposta pronta: o anexo vai preso na caixa e o texto sai como legenda, só no Enviar da atendente.
    const m = s.material;
    if (m) offerDraft(dealId, shown.trim() || s.sugestao, { replyFile: { replyId: m.replyId, name: m.name, kind: m.kind } });
    else offerDraft(dealId, shown.trim() || s.sugestao);
    if (s.horario && onBook) setKept({ dealId, id: s.id, horario: s.horario });
    if (s.retomarEm && !feitas[s.id]) setKeptRet({ dealId, id: s.id, at: s.retomarEm });
    // O botão volta na hora (17/10): "Sugerir resposta" vale a qualquer momento, inclusive logo depois de usar ou fechar.
    mark("usada"); setV({ state: "pode_pedir", again: true }); setReplace(false);
    toast("Sugestão na caixa de mensagem. Confira e aperte Enviar.");
  };
  const use = () => { if (composerHasText(dealId)) setReplace(true); else fill(); };
  const close = () => { mark("fechada"); setV({ state: "pode_pedir", again: true }); setReplace(false); };
  // Rebater (29/10, pedido do dono): "não gostei, faça de tal jeito". A IA refaz com o que a atendente disse e anota o que errou;
  // a lição só passa a valer para todas as conversas depois que a gestão aprovar (Configurações › Conversas › Sugestão por IA).
  const [rebater, setRebater] = useState<{ id: string; text: string } | null>(null);
  const rebaterAqui = s && rebater?.id === s.id ? rebater : null;
  // `falado`: o texto que acabou de vir do "Falar" (o estado do campo ainda não mudou nesta volta).
  const ask = (kind: "primeira" | "outra", falado?: string, critica?: string) => start(async () => {
    const r = await requestAiSuggestionAction(dealId, kind, { tema: (falado ?? tema).trim() || null, quotedId: replyTo?.id ?? null, ...(critica?.trim() ? { critica: critica.trim() } : {}) });
    if (!r.ok) { toast(r.error, "error"); return; }
    seq.current++; setV(r.data); setReplace(false); setRebater(null);
    if (critica?.trim()) toast("Refeita com o que você disse. O que a IA errou vai para a gestão aprovar.");
  });
  const refazer = (falado?: string) => {
    const c = (falado ?? rebaterAqui?.text ?? "").trim();
    if (c.length < 3) { toast("Diga o que não ficou bom (ex.: mais curta, sem oferecer horário).", "error"); return; }
    ask("outra", undefined, c);
  };

  const hint = v.state === "escrevendo" || v.state === "pode_pedir";
  return (
    <AnimatePresence initial={false}>
      {hint && (
        <motion.div key="ia-espera" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: T.base, ease: EASE }} className="shrink-0 px-3 pt-2">
          {v.state === "escrevendo" || pending
            ? <p role="status" className="flex min-h-8 items-center gap-2 text-sm text-muted"><span aria-hidden className="size-1.5 rounded-full bg-gold-ink motion-safe:animate-pulse" />A IA está escrevendo uma sugestão…</p>
            : (
              <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); ask("primeira"); }}>
                <Button type="submit" size="sm" variant="ghost" className="shrink-0">Sugerir resposta</Button>
                <input aria-label="Sobre o quê? (opcional)" placeholder="Sobre o quê? (opcional — escreva ou toque em Falar)" value={tema} maxLength={1000} onChange={(e) => setTema(e.target.value)}
                  className="h-8 min-w-0 flex-1 rounded-[var(--radius-control)] border border-line bg-paper px-2.5 text-sm text-ink placeholder:text-muted focus:border-ink focus:outline-none" />
                {/* Falou: o texto entra no campo e a IA já monta a mensagem a partir dele (a sugestão aparece para conferir; nada é enviado). */}
                <DictateButton value={tema} onChange={setTema} onTranscribed={(t) => ask("primeira", t)} className="h-8" />
                {replyTo && <span className="hidden shrink-0 text-xs text-muted sm:inline">à mensagem marcada</span>}
              </form>
            )}
        </motion.div>
      )}
      {!s && keptHere && (
        <motion.section key={`h${keptHere.id}`} aria-label="Horário proposto pela IA" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: T.base, ease: EASE }}
          className="shrink-0 px-3 pt-2">
          <div className="flex items-start gap-1 rounded-[var(--radius-control)] border border-line bg-paper-2/70 px-3 py-1.5">
            <ProposedRow horario={keptHere.horario} busy={booking} onBook={() => void book(keptHere.id, true)} bare />
            <IconButton label="Fechar o horário proposto" onClick={() => setKept(null)} className="-mr-1"><IconClose size={15} /></IconButton>
          </div>
        </motion.section>
      )}
      {!s && keptRetHere && (
        <motion.section key={`r${keptRetHere.id}`} aria-label="Retomada proposta pela IA" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: T.base, ease: EASE }}
          className="shrink-0 px-3 pt-2">
          <div className="flex items-start gap-1 rounded-[var(--radius-control)] border border-line bg-paper-2/70 px-3 py-1.5">
            <RetomadaRow at={keptRetHere.at} feita={feitas[keptRetHere.id] ?? null} busy={programando} onProgramar={() => void programar(keptRetHere.id)} bare />
            <IconButton label="Fechar a retomada proposta" onClick={() => setKeptRet(null)} className="-mr-1"><IconClose size={15} /></IconButton>
          </div>
        </motion.section>
      )}
      {s && (
        <motion.section key={s.id} aria-label="Sugestão da IA" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: T.base, ease: EASE }}
          className="shrink-0 px-3 pt-2">
          <div className="rounded-[var(--radius-control)] border border-line bg-paper-2/70 px-3 py-2">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-muted">Sugestão da IA</p>
                {s.resumo && <p className="mt-0.5 text-sm text-graphite"><span className="font-medium text-ink">Quer:</span> {s.resumo.replace(/^quer\s+/i, "")}</p>}
              </div>
              <IconButton label="Fechar a sugestão" onClick={close} className="-mr-1 -mt-0.5"><IconClose size={15} /></IconButton>
            </div>
            {s.precisaHumano && (
              <p role="note" className="mt-1.5 rounded-[var(--radius-control)] bg-gold-soft px-2.5 py-1.5 text-sm text-gold-ink">
                <span className="font-semibold">Pede alguém da equipe:</span> {s.motivo || "confira antes de responder."}
              </p>
            )}
            <textarea data-testid="sugestao-ia" aria-label="Texto da sugestão (pode editar aqui)" value={shown} rows={Math.min(7, Math.max(2, Math.ceil(shown.length / 70)))} maxLength={4000}
              onChange={(e) => setEdit({ id: s.id, text: e.target.value })}
              className={`mt-1.5 max-h-40 w-full resize-y rounded-[var(--radius-control)] border border-transparent bg-transparent px-1 py-0.5 text-sm hover:border-line focus:border-ink focus:bg-paper focus:outline-none ${s.precisaHumano ? "text-graphite" : "text-ink"}`} />
            {s.material && <p data-testid="material-ia" className="mt-1 truncate text-sm text-graphite">📎 vai junto: {s.material.name}</p>}
            {s.agendaAt && <p className="mt-1 text-xs text-muted">{agendaNote(s.agendaAt)}</p>}
            {s.horario && <ProposedRow horario={s.horario} busy={booking} onBook={onBook ? () => void book(s.id, false) : undefined} />}
            {(s.retomarEm || feitas[s.id]) && <RetomadaRow at={s.retomarEm ?? feitas[s.id]} feita={feitas[s.id] ?? null} busy={programando} onProgramar={() => void programar(s.id)} />}
            {replace ? (
              <div role="group" aria-label="Trocar o texto da mensagem" className="mt-2 flex flex-wrap items-center gap-2">
                <p className="text-sm text-ink">Trocar o que você estava escrevendo?</p>
                <Button size="sm" variant="ghost" onClick={() => setReplace(false)}>Manter o meu</Button>
                <Button size="sm" onClick={fill}>Trocar</Button>
              </div>
            ) : (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Button size="sm" variant={s.precisaHumano ? "secondary" : "primary"} onClick={use} disabled={pending}>Usar e editar</Button>
                <Button size="sm" variant="ghost" onClick={() => ask("outra")} loading={pending && !rebaterAqui}>{pending && !rebaterAqui ? "Escrevendo outra…" : "Outra"}</Button>
                <Button size="sm" variant="ghost" aria-expanded={!!rebaterAqui} onClick={() => setRebater(rebaterAqui ? null : { id: s.id, text: "" })} disabled={pending}>Rebater</Button>
                <span className="ml-auto text-xs text-muted">O texto vai para a caixa de mensagem: edite e envie.</span>
              </div>
            )}
            {rebaterAqui && !replace && (
              <form className="mt-2 flex flex-col gap-1.5" onSubmit={(e) => { e.preventDefault(); refazer(); }}>
                <label htmlFor="rebater-ia" className="text-xs font-semibold text-graphite">O que não ficou bom? A IA refaz assim.</label>
                <div className="flex items-center gap-2">
                  <input id="rebater-ia" autoFocus value={rebaterAqui.text} maxLength={1000} placeholder="Ex.: mais curta, sem oferecer horário, ela já é cliente"
                    onChange={(e) => setRebater({ id: s.id, text: e.target.value })}
                    className="h-8 min-w-0 flex-1 rounded-[var(--radius-control)] border border-line bg-paper px-2.5 text-sm text-ink placeholder:text-muted focus:border-ink focus:outline-none" />
                  <DictateButton value={rebaterAqui.text} onChange={(t) => setRebater({ id: s.id, text: t })} onTranscribed={(t) => refazer(t)} className="h-8" />
                  <Button type="submit" size="sm" variant="secondary" loading={pending}>{pending ? "Refazendo…" : "Refazer"}</Button>
                </div>
              </form>
            )}
          </div>
        </motion.section>
      )}
    </AnimatePresence>
  );
}

/** "Horário proposto: ter 20/10 às 15h · Thaise Fiaes · Avaliação" e o botão que abre a folha preenchida (nunca marca sozinho). */
function ProposedRow({ horario, busy, onBook, bare = false }: { horario: ProposedSlot; busy: boolean; onBook?: () => void; bare?: boolean }) {
  return (
    <div data-testid="horario-proposto" className={`flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1.5 ${bare ? "" : "mt-2 rounded-[var(--radius-control)] border border-line bg-paper px-2.5 py-1.5"}`}>
      <p className="min-w-0 text-sm text-ink"><span className="font-medium">Horário proposto:</span> <span className="tabular-nums">{slotLabel(horario)}</span></p>
      {onBook && <Button size="sm" variant="secondary" onClick={onBook} loading={busy}>Marcar este horário</Button>}
    </div>
  );
}

/**
 * "Ela cancelou sem nova data. Retomar em qua 04/11 10:00" e o botão que cria o lembrete pelo mesmo caminho do "Retomar…" (Cati 17/10).
 * Nada é criado sem o toque; depois do toque, a linha só confirma.
 */
function RetomadaRow({ at, feita, busy, onProgramar, bare = false }: { at: string; feita: string | null; busy: boolean; onProgramar: () => void; bare?: boolean }) {
  // "agora" de quando a linha apareceu (render puro); a data é dias à frente, o rótulo não muda no meio do uso.
  const [agora] = useState(() => Date.now());
  const quando = dueLabel(new Date(feita ?? at).getTime(), agora);
  return (
    <div data-testid="retomada-proposta" className={`flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1.5 ${bare ? "" : "mt-2 rounded-[var(--radius-control)] border border-line bg-paper px-2.5 py-1.5"}`}>
      {feita
        ? <p role="status" className="min-w-0 text-sm text-ink"><span className="font-medium">Retomada marcada:</span> <span className="tabular-nums">{quando}</span>. Nada é enviado.</p>
        : <>
          <p className="min-w-0 text-sm text-ink"><span className="font-medium">Cancelou sem nova data.</span> Retomar <span className="tabular-nums">{quando}</span>?</p>
          <Button size="sm" variant="secondary" onClick={onProgramar} loading={busy}>Programar retomada</Button>
        </>}
    </div>
  );
}
