"use client";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { EmojiButton } from "./emoji-picker";
import { insertAt } from "@/lib/emojis";
import { AnimatePresence, motion } from "motion/react";
import { IconClock, IconClose, IconMic, IconNote, IconPaperclip, IconPlus, IconReply, IconSend, IconStop, IconTrash } from "@/components/icons";
import { Menu } from "@/components/ui/menu";
import { sendMediaAction, sendMessageAction } from "@/app/(app)/funil/actions";
import { addNoteAction, sendQuickReplyAction } from "@/app/(app)/conversa/actions";
import { insertMention, mentionOptions, mentionQuery, mentionsIn, firstOf } from "./mentions";
import { ScheduleMessageDialog } from "./schedule-message-dialog";
import { dueLabel } from "@/lib/next-action";
import { fillVar, missingVars, pendingVars, renderReply, replyTitle, type ReplyVars } from "@/lib/quick-reply";
import { QuickReplyDialog } from "./quick-reply-dialog";
import { LibraryPicker } from "./library-picker";
import { ContactDialog, LocationDialog } from "./composer-tools";
import type { MessageToolsState } from "@/lib/message-tools-state";
import { IconButton } from "@/components/ui/icon-button";
import { useToast } from "@/components/ui/toast";
import { searchReplies } from "@/lib/reply-search";
import { loadSavedDraft, onDraft, reportComposerText, saveDraft } from "./composer-draft";
import { isVersionSkewError } from "@/lib/version-skew";
import { versionFailure } from "@/components/shell/version-state";
import { EASE, T } from "@/lib/motion";
import { useLive } from "@/components/shell/live";
import { NEW_WHILE_TYPING, typingText } from "@/lib/collision";
import { useTeamTyping } from "./use-team-typing";
import { UNCERTAIN_SEND_MESSAGE } from "@/lib/send-status";

type Reply = { id: string; label: string; body: string | null; folder?: string | null; attachment?: { name: string; kind: string } | null; /** Resposta pessoal de quem vê (selo "Minha"). */ mine?: boolean };
export type QuoteTarget = { id: string; text: string };
type Attachment = { file: File; url: string; kind: "image" | "audio" | "file"; recorded?: boolean };

const MAX_BYTES = 16 * 1024 * 1024;
/** Chrome/Firefox gravam webm/ogg; Safari/iOS grava mp4. Só oferece o gravador se o navegador sabe algum destes. */
const RECORD_TYPES = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"];
const pickRecordType = () => (typeof MediaRecorder === "undefined" ? null : RECORD_TYPES.find((t) => MediaRecorder.isTypeSupported(t)) ?? null);
const EXT: Record<string, string> = { "audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a" };
const noSubscribe = () => () => {};
/** Computador (≥ 1024 px)? No servidor e sem matchMedia (testes) vale "não": só muda textos e o que aparece com o campo vazio. */
const WIDE = "(min-width: 1024px)";
const wideSubscribe = (cb: () => void) => { if (typeof window.matchMedia !== "function") return () => {}; const mq = window.matchMedia(WIDE); mq.addEventListener("change", cb); return () => mq.removeEventListener("change", cb); };
const wideNow = () => typeof window.matchMedia === "function" && window.matchMedia(WIDE).matches;
const size = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
const kindOf = (f: File): Attachment["kind"] => (f.type.startsWith("image/") ? "image" : f.type.startsWith("audio/") ? "audio" : "file");

/** "Mandar parabéns" (Hoje) sem a resposta "aniversario" cadastrada. */
const BIRTHDAY_FALLBACK = "Feliz aniversário, {primeiro_nome}! 🎉 Toda a equipe da Casa Fiaes te deseja um dia lindo.";

export function Composer({ dealId, firstName, quickReplies, onOptimistic, onSent, slaSeconds, replyTo, onClearReply, autoFocus, team, onNoteSaved, onScheduled, vars, canShareReplies = false, libraryEnabled = false, tools, onRepliesChanged, prefillReply, signature = null, onProgram, me = null }: {
  dealId: string; firstName: string; quickReplies: Reply[]; onOptimistic: (text: string | null) => void; onSent?: () => void; slaSeconds?: number | null;
  /** A assinatura de quem escreve ("JOAQUIM"): o campo avisa como a mensagem sai. */
  signature?: string | null;
  replyTo?: QuoteTarget | null; onClearReply?: () => void;
  /** Abre com o cursor no campo ("Iniciar conversa" da ficha do contato). */
  autoFocus?: boolean;
  /** Equipe para o @ das notas internas (a lista "Transferir para…" do lead). */
  team?: { id: string; name: string }[];
  /** Depois de salvar uma nota: recarrega a conversa. */
  onNoteSaved?: () => void;
  /** Depois de agendar: recarrega a conversa (a agendada aparece acima do campo). */
  onScheduled?: () => void;
  /** Valores das variáveis desta conversa (getDealDetail.replyVars). */
  vars?: ReplyVars;
  /** Quem vê pode criar respostas universais (gestão). */
  canShareReplies?: boolean;
  /** Biblioteca ligada e permissão de enviar: o clipe oferece “Da biblioteca”. */
  libraryEnabled?: boolean;
  /** “Como chegar” e “Mandar contato” (permissão E função ligada). */
  tools?: Pick<MessageToolsState, "localizacao" | "contato">;
  /** Depois de criar ou editar uma resposta pronta pela conversa: recarrega a lista do "/". */
  onRepliesChanged?: () => void;
  /** Abre com esta resposta pronta já no campo ("Mandar parabéns" do Hoje): só PREENCHE, quem envia é a atendente. */
  prefillReply?: "aniversario" | null;
  /** "Programar mensagem" (o relógio): abre o Retomar com o texto do campo. Sem isto, o diálogo antigo de agendar envio. */
  onProgram?: (text: string) => void;
  /** Quem vê (id): o "Fulana está escrevendo…" nunca mostra a própria pessoa. */
  me?: string | null;
}) {
  const prefillText = prefillReply === "aniversario"
    ? renderReply(quickReplies.find((q) => q.label.toLowerCase() === "aniversario")?.body ?? BIRTHDAY_FALLBACK, vars ?? { primeiroNome: firstName, dataHorario: null, profissional: null }).text
    : "";
  const [text, setText] = useState(() => prefillText || loadSavedDraft(dealId));
  // A conversa ainda carregando (respostas e nome chegam depois): troca o parabéns padrão pelo cadastrado enquanto ninguém mexeu no campo.
  const lastPrefill = useRef(prefillText);
  useEffect(() => {
    if (!prefillText || prefillText === lastPrefill.current) return;
    setText((cur) => (cur === lastPrefill.current ? prefillText : cur));
    lastPrefill.current = prefillText;
  }, [prefillText]);
  const [pending, start] = useTransition();
  const [sel, setSel] = useState(0);
  const [mode, setMode] = useState<"mensagem" | "nota">("mensagem");
  const noteMode = mode === "nota";
  const [scheduling, setScheduling] = useState(false);
  const [library, setLibrary] = useState(false);
  const [toolDialog, setToolDialog] = useState<"local" | "contato" | null>(null);
  const toolItems = [
    ...(tools?.localizacao ? [{ label: "Como chegar", onSelect: () => setToolDialog("local") }] : []),
    ...(tools?.contato ? [{ label: "Mandar contato", onSelect: () => setToolDialog("contato") }] : []),
  ];
  const [replyDialog, setReplyDialog] = useState<{ editing: Reply | null } | null>(null);
  const [replyFile, setReplyFile] = useState<{ replyId: string; name: string; kind?: string } | null>(null);
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [recording, setRecording] = useState<{ seconds: number } | null>(null);
  const wide = useSyncExternalStore(wideSubscribe, wideNow, () => false);
  const canRecord = useSyncExternalStore(noSubscribe, () => !!navigator.mediaDevices?.getUserMedia && !!pickRecordType(), () => false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const recorder = useRef<{ rec: MediaRecorder; stream: MediaStream; chunks: Blob[]; cancelled: boolean; timer: ReturnType<typeof setInterval> } | null>(null);
  const justFilled = useRef(false);
  const toast = useToast();
  // Colisão (pesquisa 20/10): quem mais está escrevendo aqui, e mensagem nova da cliente chegando enquanto esta pessoa escrevia.
  const typing = useTeamTyping(dealId, me);
  const draftRef = useRef({ text, mode });
  useEffect(() => { draftRef.current = { text, mode }; });
  const [newWhileTyping, setNewWhileTyping] = useState(false);
  const [confirmNew, setConfirmNew] = useState(false);
  useLive([`deal:${dealId}`], (e) => {
    if (e.type === "mensagem_recebida" && draftRef.current.mode === "mensagem" && draftRef.current.text.trim()) setNewWhileTyping(true);
  });
  const slash = !noteMode && text.startsWith("/") && !text.includes("\n") ? text.slice(1).toLowerCase() : null;
  // Busca do "/" (20/10): sem acento, hífen = espaço ("curso mf" acha "/curso-mf"), todas as palavras valem; o atalho e a pasta vêm antes do texto.
  // Até 30, com rolagem (antes eram 6 e as outras "sumiam").
  const matches = useMemo(() => slash === null ? [] : searchReplies(quickReplies, slash), [slash, quickReplies]);
  const mq = noteMode ? mentionQuery(text) : null;
  const people = useMemo(() => (mq === null ? [] : mentionOptions(team ?? [], mq)), [mq, team]);
  const pickPerson = (p: { name: string }) => { setText(insertMention(text, p.name)); setSel(0); requestAnimationFrame(() => ref.current?.focus()); };

  // Liberta o microfone e as URLs de prévia ao sair da conversa.
  useEffect(() => () => { const r = recorder.current; if (r) { r.cancelled = true; clearInterval(r.timer); if (r.rec.state !== "inactive") r.rec.stop(); r.stream.getTracks().forEach((t) => t.stop()); } }, []);
  useEffect(() => () => { if (attachment) URL.revokeObjectURL(attachment.url); }, [attachment]);
  useEffect(() => { if (replyTo) ref.current?.focus(); }, [replyTo?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (autoFocus) ref.current?.focus({ preventScroll: true }); }, [autoFocus, dealId]);
  // Lote 7B: texto pronto do painel da cliente ("Enviar link de confirmação"). Só preenche o campo; quem envia é a atendente.
  // Sugestão da IA que indicou o vídeo/foto de uma resposta pronta (24/10): o anexo vem preso ao texto e só sai no Enviar (sendQuickReply).
  // Texto oferecido SEM anexo (outra sugestão, o link de confirmação) troca o texto inteiro: o anexo da resposta pronta sai junto, senão o
  // vídeo iria com um texto que não é dele. O arquivo que a atendente escolheu no clipe continua.
  useEffect(() => onDraft(dealId, (t, extra) => {
    setText(t); setSel(0); justFilled.current = true;
    setReplyFile(extra?.replyFile ?? null);
    if (extra?.replyFile) setAttachment(null);
    setTimeout(() => { justFilled.current = false; }, 450);
    requestAnimationFrame(() => ref.current?.focus());
  }), [dealId]);
  useEffect(() => { reportComposerText(dealId, text); }, [dealId, text]);
  // O que está sendo escrito fica guardado (só mensagem, não nota) e volta se a tela recarregar.
  useEffect(() => { if (mode === "mensagem") saveDraft(dealId, text); }, [dealId, text, mode]);
  // Teclado do celular: quando a área visível encolhe (iOS não redimensiona a página), o campo em foco volta para a vista e o Enviar não fica coberto.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const keep = () => { if (document.activeElement === ref.current) ref.current?.scrollIntoView({ block: "nearest" }); };
    vv.addEventListener("resize", keep);
    return () => vv.removeEventListener("resize", keep);
  }, []);

  const v: ReplyVars = useMemo(() => vars ?? { primeiroNome: firstName || null, dataHorario: null, profissional: null }, [vars, firstName]);
  const render = (b: string | null) => renderReply(b, v).text;
  const fill = (q: Reply) => {
    const r = renderReply(q.body, v);
    setText(r.text); setReplyFile(q.attachment ? { replyId: q.id, name: q.attachment.name, kind: q.attachment.kind } : null); setAttachment(null);
    setSel(0); justFilled.current = true; setTimeout(() => { justFilled.current = false; }, 450);
    if (r.missing.length) toast(`Falta preencher: ${r.missing.join(" e ")}. Preencha acima do campo antes de enviar.`, "info");
    requestAnimationFrame(() => ref.current?.focus());
  };

  const attach = (file: File | undefined, recorded = false) => {
    setReplyFile(null);
    if (!file) return;
    if (file.size > MAX_BYTES) { toast("O arquivo passa de 16 MB. Escolha um menor.", "error"); return; }
    if (!file.size) { toast("O arquivo está vazio.", "error"); return; }
    setAttachment({ file, url: URL.createObjectURL(file), kind: kindOf(file), recorded });
  };

  const startRecording = async () => {
    const type = pickRecordType(); if (!type || recorder.current) return;
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream, { mimeType: type });
      const chunks: Blob[] = [];
      const live = stream;
      let seconds = 0;
      rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      // O timer e o registro do gravador só existem depois que o start() deu certo: se ele lançar, nada fica preso.
      rec.onstop = () => {
        const r = recorder.current; recorder.current = null;
        clearInterval(r?.timer); live.getTracks().forEach((t) => t.stop()); setRecording(null);
        if (!r || r.cancelled || !chunks.length) return;
        const base = type.split(";")[0];
        attach(new File(chunks, `gravacao.${EXT[base] ?? "webm"}`, { type: base }), true);
      };
      rec.start();
      const timer = setInterval(() => { seconds += 1; setRecording({ seconds }); if (seconds >= 15 * 60) rec.stop(); }, 1000);
      recorder.current = { rec, stream: live, chunks, cancelled: false, timer };
      setRecording({ seconds: 0 });
    } catch (e) {
      stream?.getTracks().forEach((t) => t.stop());
      const name = e instanceof DOMException || e instanceof Error ? e.name : "";
      toast(name === "NotAllowedError" ? "Libere o microfone nas permissões do navegador." : name === "NotFoundError" ? "Nenhum microfone encontrado." : "Não deu para gravar neste navegador.", "error");
    }
  };
  const stopRecording = () => recorder.current?.rec.stop();
  const cancelRecording = () => { const r = recorder.current; if (!r) return; r.cancelled = true; r.rec.stop(); };

  const isAudio = attachment?.kind === "audio";
  const canSend = !!(text.trim() || (!noteMode && (attachment || replyFile))) && !recording;
  const send = (force = false) => {
    if (noteMode) {
      const body = text.trim();
      if (!body || pending) return;
      start(async () => {
        const r = await addNoteAction({ dealId, body, mentions: mentionsIn(body, team ?? []) }).catch(versionFailure);
        if (!r.ok) { toast(r.error, "error"); return; }
        setText(""); toast("Nota salva (a cliente não vê)", "ok"); onNoteSaved?.();
      });
      return;
    }
    if (!canSend || pending) return;
    // Evita mandar sem revisar logo após preencher uma resposta pronta.
    if (justFilled.current) return;
    const missing = missingVars(text);
    if (missing.length) { toast(`Falta preencher: ${missing.join(" e ")}. Preencha acima do campo antes de enviar.`, "error"); return; }
    // A cliente escreveu enquanto esta pessoa digitava: pergunta antes (a resposta pode não servir mais).
    if (newWhileTyping && !force) { setConfirmNew(true); return; }
    setNewWhileTyping(false); setConfirmNew(false);
    const att = attachment;
    // Áudio vai sem legenda (o WhatsApp não aceita); o texto digitado fica no campo.
    const body = att?.kind === "audio" ? "" : text.trim(); const quote = replyTo ?? null;
    const done = (r: { ok: true; data?: { waitedSeconds: number | null } } | { ok: false; error: string }, restore: () => void) => {
      // Envio incerto (pode ter saído): o texto não volta para o campo, senão a atendente reenvia e a cliente recebe duas vezes.
      if (!r.ok) { if (r.error !== UNCERTAIN_SEND_MESSAGE) restore(); toast(r.error, "error"); return; }
      const w = r.data?.waitedSeconds;
      if (w != null) toast(`Respondido em ${w < 60 ? `${w} s` : `${Math.floor(w / 60)} min`}${slaSeconds && w <= slaSeconds ? " ✓ dentro da meta" : ""}`, "ok");
      onSent?.();
    };
    // Arquivo (resposta pronta com anexo, foto, PDF, áudio): o balão "enviando…" aparece na hora, como no texto, até a conversa recarregar.
    if (replyFile && !att) {
      const rf = replyFile;
      setReplyFile(null); setText(""); onClearReply?.();
      onOptimistic(body ? `📎 ${body}` : "📎 Arquivo");
      start(async () => {
        const r = await semTravar(sendQuickReplyAction({ dealId, replyId: rf.replyId, text: body }));
        onOptimistic(null);
        done(r, () => { setReplyFile(rf); setText(body); });
      });
      return;
    }
    if (att) {
      setAttachment(null); if (att.kind !== "audio") setText(""); onClearReply?.();
      onOptimistic(att.kind === "audio" ? "🎤 Áudio" : `📎 ${body || att.file.name}`);
      start(async () => {
        const form = new FormData();
        form.set("dealId", dealId); form.set("file", att.file); form.set("caption", body);
        if (quote) form.set("quoteMessageId", quote.id);
        const r = await semTravar(sendMediaAction(form));
        onOptimistic(null);
        done(r, () => { setAttachment({ ...att, url: URL.createObjectURL(att.file) }); if (att.kind !== "audio") setText(body); });
      });
      return;
    }
    onOptimistic(body); setText(""); onClearReply?.();
    start(async () => {
      const r = await semTravar(sendMessageAction(dealId, body, quote?.id ?? null));
      onOptimistic(null);
      done(r, () => setText(body));
    });
  };

  const openReplies = () => { if (slash === null) setText((t) => (t.trim() ? `/${t}` : "/")); setSel(0); requestAnimationFrame(() => ref.current?.focus()); };
  return (
    <div className="sticky bottom-0 z-[1] shrink-0 border-t border-line bg-paper px-3 pt-3 pb-[max(0.375rem,env(safe-area-inset-bottom))] lg:pb-3">
      <AnimatePresence>
        {slash !== null && (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }} transition={{ duration: T.fast, ease: EASE }}
            className="absolute left-3 right-3 bottom-full mb-2 bg-paper border border-line rounded-[var(--radius-card)] shadow-[var(--shadow-pop)] overflow-hidden">
            <ul role="listbox" aria-label="Respostas prontas" className="max-h-[min(50vh,420px)] overflow-y-auto overscroll-contain">
              {matches.map((q, i) => (
                <li key={q.id} role="option" aria-selected={i === sel} className={`flex items-stretch ${i === sel ? "bg-paper-2" : ""}`}>
                  <button type="button" onMouseMove={() => { if (sel !== i) setSel(i); }} onClick={() => fill(q)} className="min-w-0 flex-1 text-left px-3.5 py-2.5">
                    <span className="text-xs font-semibold text-gold-ink">{q.folder ? `${q.folder} · ` : ""}{replyTitle(q.label)} <span className="font-normal text-muted">/{q.label}</span>{q.attachment ? ` · 📎 ${q.attachment.name}` : ""}</span>
                    {q.mine && <span className="ml-2 rounded-full bg-gold-soft px-2 py-0.5 text-xs font-semibold text-gold-ink">Minha</span>}
                    {/* Altura fixa: o item não cresce ao passar o mouse (antes crescia, a lista pulava e o clique caía em outra resposta). */}
                    <span className="block text-sm text-graphite line-clamp-2 whitespace-pre-wrap">{render(q.body)}</span>
                  </button>
                  {q.mine && (
                    <button type="button" onClick={() => setReplyDialog({ editing: q })} aria-label={`Editar resposta ${q.label}`} className="shrink-0 px-3 text-sm font-medium text-gold-ink">Editar</button>
                  )}
                </li>
              ))}
            </ul>
            {matches.length === 0 && <p className="px-3.5 py-2.5 text-sm text-muted">Nenhuma resposta com “{slash}”.</p>}
            <button type="button" onClick={() => setReplyDialog({ editing: null })} className="w-full border-t border-line px-3.5 py-2.5 text-left text-sm font-medium text-gold-ink hover:bg-paper-2">
              Nova resposta pronta
            </button>
          </motion.div>
        )}
      </AnimatePresence>
      {people.length > 0 && (
        <ul className="absolute left-3 right-3 bottom-full mb-2 bg-paper border border-line rounded-[var(--radius-card)] shadow-[var(--shadow-pop)] overflow-hidden" role="listbox" aria-label="Chamar alguém da equipe">
          {people.map((p, i) => (
            <li key={p.id} role="option" aria-selected={i === sel}>
              <button type="button" onMouseEnter={() => setSel(i)} onClick={() => pickPerson(p)} className={`w-full text-left px-3.5 py-2.5 ${i === sel ? "bg-paper-2" : ""}`}>
                <span className="text-sm font-semibold text-ink">@{firstOf(p.name)}</span> <span className="text-sm text-graphite">{p.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {typing.names.length > 0 && <p role="status" className="mb-1.5 flex items-center gap-1.5 px-1 text-xs text-graphite"><span aria-hidden className="size-1.5 rounded-full bg-gold-ink motion-safe:animate-pulse" />{typingText(typing.names)}</p>}
      {confirmNew && !noteMode && (
        <div role="alertdialog" aria-label="Mensagem nova da cliente" className="mb-2 flex flex-wrap items-center gap-2 rounded-[var(--radius-control)] border border-alert/40 bg-alert-soft px-3 py-2">
          <p className="min-w-0 flex-1 text-sm font-medium text-ink">{NEW_WHILE_TYPING}</p>
          <button type="button" onClick={() => { setConfirmNew(false); setNewWhileTyping(false); requestAnimationFrame(() => ref.current?.focus()); }}
            className="min-h-9 rounded-[var(--radius-control)] border border-line-strong bg-paper px-3 text-sm font-medium text-ink pointer-coarse:min-h-11">Ler antes</button>
          <button type="button" onClick={() => send(true)}
            className="min-h-9 rounded-[var(--radius-control)] bg-ink px-3 text-sm font-semibold text-paper pointer-coarse:min-h-11">Enviar mesmo assim</button>
        </div>
      )}
      {!noteMode && slash === null && <PendingVarFields text={text} onFill={(key, value) => { setText(fillVar(text, key, value)); requestAnimationFrame(() => ref.current?.focus()); }} />}
      <AnimatePresence initial={false}>
        {replyTo && (
          <motion.div key="reply" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }} transition={{ duration: T.fast, ease: EASE }}
            className="mb-2 flex items-center gap-2 rounded-[var(--radius-control)] bg-paper-2 border-l-2 border-gold/70 pl-3 pr-1 py-1">
            <IconReply size={15} className="shrink-0 text-gold-ink" />
            <p className="min-w-0 flex-1 text-sm text-graphite truncate"><span className="font-semibold text-ink">Respondendo a: </span>{replyTo.text}</p>
            <IconButton label="Cancelar resposta" onClick={onClearReply}><IconClose size={16} /></IconButton>
          </motion.div>
        )}
        {attachment && (
          <motion.div key="attachment" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }} transition={{ duration: T.fast, ease: EASE }}
            className="mb-2 flex items-center gap-3 rounded-[var(--radius-control)] border border-line bg-paper-2 p-2" role="group" aria-label="Arquivo para enviar">
            {attachment.kind === "image"
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={attachment.url} alt="Prévia da foto" className="size-16 shrink-0 rounded-[8px] object-cover bg-paper" />
              : attachment.kind === "audio"
                ? <audio controls src={attachment.url} aria-label="Prévia do áudio" className="h-10 min-w-0 flex-1" />
                : <span className="size-16 shrink-0 grid place-items-center rounded-[8px] bg-paper text-xs font-semibold text-gold-ink">{attachment.file.name.split(".").pop()?.slice(0, 4).toUpperCase() ?? "ARQ"}</span>}
            {attachment.kind !== "audio" && (
              <p className="min-w-0 flex-1 text-sm"><span className="block truncate font-medium">{attachment.file.name}</span><span className="text-muted">{size(attachment.file.size)} · escreva uma legenda se quiser</span></p>
            )}
            <IconButton label="Remover arquivo" size="lg" onClick={() => setAttachment(null)}><IconTrash size={16} /></IconButton>
          </motion.div>
        )}
        {replyFile && !attachment && (
          <motion.div key="reply-file" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }} transition={{ duration: T.fast, ease: EASE }}
            className="mb-2 flex items-center gap-3 rounded-[var(--radius-control)] border border-line bg-paper-2 p-2" role="group" aria-label="Arquivo da resposta pronta">
            <span className="size-10 shrink-0 grid place-items-center rounded-[8px] bg-paper text-xs font-semibold text-gold-ink">{replyFile.name.split(".").pop()?.slice(0, 4).toUpperCase() ?? "ARQ"}</span>
            <p className="min-w-0 flex-1 text-sm"><span className="block truncate font-medium">{replyFile.name}</span><span className="text-muted">{replyFile.kind === "image" || replyFile.kind === "video" ? "o texto vai como legenda, embaixo" : "vai junto, depois do texto"}</span></p>
            <IconButton label="Não enviar o arquivo" size="lg" onClick={() => setReplyFile(null)}><IconTrash size={16} /></IconButton>
          </motion.div>
        )}
      </AnimatePresence>

      {recording ? (
        <div className="flex items-center gap-2">
          <span role="status" className="sr-only">Gravando áudio</span>
          <IconButton label="Descartar gravação" size="lg" onClick={cancelRecording}><IconTrash size={18} /></IconButton>
          <p className="flex-1 flex items-center gap-2 h-11 px-3.5 rounded-[var(--radius-control)] bg-paper-2 text-base">
            <span className="size-2.5 rounded-full bg-alert" aria-hidden />Gravando <span aria-hidden className="tabular-nums text-graphite">{clock(recording.seconds)}</span>
          </p>
          <motion.button type="button" onClick={stopRecording} whileTap={{ scale: 0.92 }} aria-label="Parar e revisar áudio"
            className="size-11 shrink-0 grid place-items-center rounded-[var(--radius-control)] bg-ink text-paper"><IconStop size={18} /></motion.button>
        </div>
      ) : (
        <div className="flex items-end gap-1.5">
          <input ref={fileInput} type="file" hidden accept="image/*,application/pdf,audio/*,video/mp4" aria-label="Escolher arquivo" data-testid="anexo"
            onChange={(e) => { attach(e.target.files?.[0]); e.target.value = ""; }} />
          {!noteMode && (
            <>
              {/* Celular: anexar, respostas prontas e nota moram no [+]; o relógio continua à vista (a Casa não achava como programar). */}
              {!wide ? (
                <Menu label="Anexar e mais" up align="left" trigger={<IconPlus size={20} />} triggerClassName="size-11"
                  items={[
                    { label: "Foto ou arquivo", onSelect: () => fileInput.current?.click() },
                    ...(libraryEnabled ? [{ label: "Da biblioteca", onSelect: () => setLibrary(true) }] : []),
                    ...toolItems,
                    { label: "Respostas prontas", onSelect: openReplies },
                    { label: "Nota para a equipe", onSelect: () => { setMode("nota"); setAttachment(null); setSel(0); requestAnimationFrame(() => ref.current?.focus()); } },
                  ]} />
              ) : (
                <>
                  {libraryEnabled || toolItems.length
                    ? <Menu label="Anexar foto, PDF ou áudio" up align="left" trigger={<IconPaperclip size={20} />} triggerClassName="h-11 min-w-11"
                        items={[{ label: "Do aparelho", onSelect: () => fileInput.current?.click() }, ...(libraryEnabled ? [{ label: "Da biblioteca", onSelect: () => setLibrary(true) }] : []), ...toolItems]} />
                    : <IconButton label="Anexar foto, PDF ou áudio" size="lg" onClick={() => fileInput.current?.click()} className="h-11"><IconPaperclip size={20} /></IconButton>}
                  <button type="button" aria-label="Respostas prontas" title="Respostas prontas (ou digite / no campo)" disabled={isAudio} onClick={openReplies}
                    className="h-11 min-w-11 shrink-0 rounded-[var(--radius-control)] bg-paper-2 px-2.5 text-sm font-semibold text-ink-2 hover:bg-paper-3/60 disabled:opacity-40">
                    /<span className="hidden sm:inline"> Prontas</span>
                  </button>
                </>
              )}
              <span className="hidden sm:contents">
                <EmojiButton disabled={isAudio} onPick={(emoji) => {
                  const el = ref.current;
                  const r = insertAt(text, emoji, el?.selectionStart ?? text.length, el?.selectionEnd ?? text.length);
                  setText(r.text);
                  requestAnimationFrame(() => { if (!el) return; el.setSelectionRange(r.caret, r.caret); el.style.height = "auto"; el.style.height = Math.min(el.scrollHeight, 160) + "px"; });
                }} />
              </span>
            </>
          )}
          <textarea ref={ref} value={text} rows={1} disabled={isAudio} placeholder={noteMode ? "Nota interna: só a equipe vê. Use @ para chamar alguém." : isAudio ? "Áudio vai sem legenda" : attachment ? "Legenda (opcional)…" : signature && wide ? `Mensagem (sai assinada como ${signature})` : "Mensagem…"} aria-label={noteMode ? "Nota interna" : isAudio ? "Legenda (indisponível para áudio)" : attachment ? "Legenda" : "Mensagem"}
            onChange={(e) => { setText(e.target.value); setSel(0); if (!noteMode) typing.ping(e.target.value); if (!e.target.value.trim()) { setNewWhileTyping(false); setConfirmNew(false); } e.target.style.height = "auto"; e.target.style.height = Math.min(e.target.scrollHeight, 160) + "px"; }}
            onKeyDown={(e) => {
              if (people.length) {
                if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => (s + 1) % people.length); return; }
                if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => (s - 1 + people.length) % people.length); return; }
                if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pickPerson(people[sel] ?? people[0]); return; }
              }
              if (matches.length) {
                if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => (s + 1) % matches.length); return; }
                if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => (s - 1 + matches.length) % matches.length); return; }
                if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); fill(matches[sel]); return; }
                if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); e.nativeEvent.stopImmediatePropagation(); setText(""); return; }
              }
              if (e.key === "Escape" && !text.trim() && (replyTo || attachment)) {
                e.stopPropagation(); e.nativeEvent.stopImmediatePropagation();
                if (replyTo) onClearReply?.(); else setAttachment(null);
                return;
              }
              if (e.key === "Escape" && text.trim()) { e.stopPropagation(); e.nativeEvent.stopImmediatePropagation(); (e.target as HTMLTextAreaElement).blur(); return; }
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
            }}
            className={`min-w-0 flex-1 resize-none ${noteMode ? "bg-gold-soft/60" : "bg-paper-2"} rounded-[var(--radius-control)] px-3.5 py-2.5 text-[16px] lg:text-base leading-relaxed outline-none focus:bg-paper focus:shadow-[0_0_0_1px_var(--color-ink),0_0_0_4px_rgb(184_134_63/0.2)] transition-shadow max-h-40 disabled:opacity-50 disabled:cursor-not-allowed`} />
          {(wide || noteMode) && (
            <button type="button" aria-label={noteMode ? "Voltar para mensagem" : "Nota para a equipe (a cliente não vê)"} title={noteMode ? "Voltar para mensagem" : "Nota para a equipe (a cliente não vê)"} aria-pressed={noteMode}
              onClick={() => { setMode(noteMode ? "mensagem" : "nota"); setAttachment(null); setSel(0); requestAnimationFrame(() => ref.current?.focus()); }}
              className={`h-11 min-w-11 shrink-0 inline-flex items-center justify-center gap-1 rounded-[var(--radius-control)] px-2.5 text-sm font-semibold text-gold-ink transition-colors ${noteMode ? "bg-gold-soft ring-1 ring-gold" : "bg-gold-soft/60 hover:bg-gold-soft"}`}>
              <IconNote size={16} className="sm:hidden" aria-hidden /><span className="hidden sm:inline">{noteMode ? "Mensagem" : "Nota"}</span>
            </button>
          )}
          {/* "Programar mensagem": sempre à vista e ativo; abre o Retomar com o texto do campo (sem texto, vira lembrete). */}
          {!noteMode && (
            <IconButton label="Programar mensagem" size="lg" className="h-11 disabled:opacity-35" disabled={!!attachment} onClick={() => {
              const missing = text.trim() ? missingVars(text) : [];
              if (missing.length) { toast(`Falta preencher: ${missing.join(" e ")}. Preencha acima do campo antes de programar.`, "error"); return; }
              if (onProgram) onProgram(text.trim());
              else if (text.trim()) setScheduling(true);
            }}><IconClock size={20} /></IconButton>
          )}
          {canSend || !canRecord || noteMode ? (
            <motion.button type="button" onClick={() => send()} disabled={!canSend || pending} whileTap={{ scale: 0.92 }} aria-label={noteMode ? "Salvar nota" : "Enviar"}
              className="h-11 min-w-11 shrink-0 inline-flex items-center justify-center gap-1.5 rounded-[var(--radius-control)] bg-ink px-0 text-paper disabled:opacity-35 transition-opacity lg:px-4">
              {pending ? <span className="size-4 rounded-full border-2 border-paper border-r-transparent animate-spin" /> : <><IconSend size={18} className="lg:hidden" /><span className="hidden text-sm font-semibold lg:inline">{noteMode ? "Salvar" : "Enviar"}</span></>}
            </motion.button>
          ) : (
            <motion.button type="button" onClick={startRecording} whileTap={{ scale: 0.92 }} aria-label="Gravar áudio" title="Gravar áudio"
              className="size-11 shrink-0 grid place-items-center rounded-[var(--radius-control)] bg-ink text-paper"><IconMic size={18} /></motion.button>
          )}
        </div>
      )}
      {noteMode && <p className="text-xs text-muted mt-1.5 px-1 hidden sm:block">Nota interna: a cliente não vê · <b className="text-graphite">@</b> chama alguém da equipe · Enter salva</p>}
      {scheduling && (
        <ScheduleMessageDialog open onClose={() => setScheduling(false)} dealId={dealId} text={text.trim()}
          onDone={(at) => { setText(""); toast(`Agendada para ${dueLabel(Date.parse(at), Date.now())}`, "ok"); onScheduled?.(); }} />
      )}
      {tools?.localizacao && <LocationDialog dealId={dealId} open={toolDialog === "local"} onClose={() => setToolDialog(null)} onSent={() => { onSent?.(); }} />}
      {tools?.contato && <ContactDialog dealId={dealId} open={toolDialog === "contato"} onClose={() => setToolDialog(null)} onSent={() => { onSent?.(); }} />}
      {libraryEnabled && <LibraryPicker dealId={dealId} open={library} onClose={() => setLibrary(false)} onSent={() => { onSent?.(); }} />}
      {replyDialog && (
        <QuickReplyDialog onClose={() => setReplyDialog(null)} vars={v} canShare={canShareReplies} editing={replyDialog.editing}
          onSaved={() => { toast(replyDialog.editing ? "Resposta salva" : "Resposta criada. Digite / para usar.", "ok"); setText("/"); onRepliesChanged?.(); }} />
      )}
    </div>
  );
}

/** Variável sem dado nesta conversa ({data_horario} sem horário marcado…): vira um campo para preencher. Enquanto houver, o envio fica bloqueado. */
function PendingVarFields({ text, onFill }: { text: string; onFill: (key: string, value: string) => void }) {
  const pending = useMemo(() => pendingVars(text), [text]);
  const [values, setValues] = useState<Record<string, string>>({});
  if (!pending.length) return null;
  const apply = (key: string) => { const v = values[key] ?? ""; if (!v.trim()) return; onFill(key, v); setValues((x) => ({ ...x, [key]: "" })); };
  return (
    <div className="mb-2 rounded-[var(--radius-control)] border border-gold/50 bg-gold-soft/40 p-2" role="group" aria-label="Falta preencher">
      <p className="px-1 text-xs font-semibold text-gold-ink">Falta preencher antes de enviar</p>
      {pending.map((p) => (
        <div key={p.key} className="mt-1.5 flex items-center gap-2">
          <input value={values[p.key] ?? ""} onChange={(e) => setValues((x) => ({ ...x, [p.key]: e.target.value }))} aria-label={`Preencher ${p.label}`} placeholder={p.label}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); apply(p.key); } }}
            className="h-10 min-w-0 flex-1 rounded-[var(--radius-control)] border border-control bg-paper px-3 text-[16px] lg:text-sm" />
          <button type="button" onClick={() => apply(p.key)} className="h-10 shrink-0 rounded-[var(--radius-control)] bg-ink px-3 text-sm font-medium text-paper">Preencher</button>
        </div>
      ))}
    </div>
  );
}

/**
 * Envio que não responde em 20 s (20/10: a Cati enviou bem na troca de versão do servidor e o botão ficou cinza, preso no "enviando"):
 * o botão volta, o texto volta para o campo e aparece o aviso. Se a mensagem tiver saído mesmo assim, ela aparece na conversa.
 */
export const SEND_TIMEOUT_MS = 20_000;
function semTravar<T extends { ok: boolean }>(p: Promise<T>): Promise<T | { ok: false; error: string }> {
  return Promise.race([
    // Versão nova do CRM no meio do envio (20/10): o aviso "Atualizar" aparece e o texto volta para o campo (e fica guardado).
    p.catch((e: unknown) => (isVersionSkewError(e) ? versionFailure(e) : { ok: false as const, error: "Não deu para enviar: a conexão caiu. Tente de novo." })),
    new Promise<{ ok: false; error: string }>((res) => setTimeout(() => res({ ok: false, error: "Não deu para enviar: o servidor não respondeu. Confira a conversa e, se não saiu, tente de novo." }), SEND_TIMEOUT_MS)),
  ]);
}
