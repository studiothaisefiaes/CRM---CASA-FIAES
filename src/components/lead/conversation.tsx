"use client";
import { createContext, Fragment, memo, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { IconForward, IconMic, IconMore, IconPhone, IconReply } from "@/components/icons";
import { IconButton } from "@/components/ui/icon-button";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/field";
import { callLabel, type CallInfo } from "@/lib/calls";
import { T, EASE, SPRING_UI } from "@/lib/motion";
import { firstName, outVia, speakerOf } from "@/lib/authorship";
import { Menu } from "@/components/ui/menu";
import { stripSignature } from "@/lib/signature";
import { REACTION_CHOICES } from "@/lib/message-tools-state";
import { TRANSCRIPT_MAX_SECONDS, formatDuration, type TranscriptStatus } from "@/lib/audio";

export type Msg = { id: string; externalId?: string | null; direction: "in" | "out"; kind: string; body: string | null; status: string; createdAt: string; sender: string | null; fromPhone: boolean;
  /** Por onde saiu a mensagem da Casa ("celular" | "crm"); ausente nas antigas, que usam `fromPhone`. */ sentVia?: "celular" | "crm" | null;
  /** Quem da equipe enviou (a Casa pelo CRM): só ela edita a própria mensagem. */ byId?: string | null;
  error?: string | null; hasMedia?: boolean; quotedBody?: string | null; edited?: boolean; deleted?: boolean;
  /** Quando a retenção apagou o arquivo da mídia (ISO): a tela mostra \"Mídia expirada\". */ purgedAt?: string;
  /** Nota interna (kind "nota"): de onde veio. A cliente não vê. */ note?: "crm" | "chatguru" | "menu";
  /** Trazida do "Exportar conversa" do WhatsApp (ISO de quando foi importada): selo "importada" no balão. */ importedAt?: string;
  /** Reações do WhatsApp (a última de cada lado). */ reactions?: { cliente?: string; casa?: string } | null;
  /** Ligação (kind "call"): status, vídeo e duração (Lote 5). */ call?: CallInfo | null;
  /** O que foi falado na ligação (notas ligadas a ela). */ callNotes?: CallNote[];
  /** Áudio: duração real (s), cópia .m4a pronta (toca no iPhone) e transcrição. */
  durationSec?: number | null; hasPlayback?: boolean; transcript?: string | null; transcriptStatus?: TranscriptStatus | null };

/**
 * Reagir e Editar (Task 12). Segurar a mensagem (celular) ou clicar com o botão direito abre a barra de reações; "Editar" só nas mensagens
 * de texto que a própria pessoa enviou pelo CRM, dentro do prazo. O servidor confere tudo de novo.
 */
export type BubbleTools = { react?: (m: Msg, emoji: string) => void; edit?: (m: Msg) => void; canEdit?: (m: Msg) => boolean; forward?: (m: Msg) => void; canForward?: (m: Msg) => boolean };
const LONG_PRESS_MS = 450;
const canReactTo = (m: Msg) => m.id !== "optimistic" && !!m.externalId && !m.deleted && !m.importedAt && m.status !== "pending" && m.status !== "failed" && m.status !== "simulado";

export type CallNote = { id: string; subject: string | null; body: string; authorName: string | null; createdAt: string };

/** O que a linha da ligação pode fazer: anotar o que foi falado e, depois, marcar o horário. Sem isso, a linha só mostra. */
export type CallActions = { onNote: (messageId: string, note: { subject: string; body: string }) => Promise<boolean>; onBook?: () => void;
  /** Ligação recebida sem resultado ("recebida"): a equipe marca à mão; "recebida" volta ao que era. */
  onMark?: (messageId: string, status: "atendida" | "perdida" | "recebida") => Promise<boolean> };
const CallActionsCtx = createContext<CallActions | null>(null);

/** Foto, figurinha, áudio, vídeo ou documento vindos do WhatsApp (arquivo servido por /api/media/[id]). */
function Media({ m }: { m: Msg }) {
  const [failed, setFailed] = useState(false);
  /** A miniatura falhou (servidor sem disco, foto estranha): tenta o original uma vez antes de avisar. */
  const [original, setOriginal] = useState(false);
  const src = `/api/media/${m.id}`;
  if (m.purgedAt) return <span data-testid="midia-expirada" className="text-graphite italic">Mídia expirada · apagada em {new Date(m.purgedAt).toLocaleDateString("pt-BR", { timeZone: "America/Bahia" })}</span>;
  if (failed) return <span className="text-graphite italic">{KIND_LABEL[m.kind] ?? "Mídia"} (não foi possível carregar)</span>;
  switch (m.kind) {
    // Miniatura de até 720 px (~1/4 dos bytes; o balão mostra no máximo 288 px de altura) e prioridade baixa: o texto da conversa chega antes.
    // O toque abre o original.
    case "image": return <a href={src} target="_blank" rel="noreferrer" className="block -mx-1.5 -mt-0.5 mb-1"><img src={original ? src : `${src}?thumb=1`} alt={m.body ?? "Foto enviada"} loading="lazy" fetchPriority="low" decoding="async" onError={() => (original ? setFailed(true) : setOriginal(true))} className="rounded-[var(--radius-control)] max-h-72 w-auto max-w-full object-cover bg-paper-2" /></a>;
    case "sticker": return <img src={src} alt="Figurinha" loading="lazy" onError={() => setFailed(true)} className="size-28 object-contain" />;
    // .m4a (AAC) primeiro: o Safari/iPhone não toca o ogg/opus do WhatsApp. O navegador fica com a primeira fonte que sabe tocar.
    case "audio": return (
      <span className="flex items-center gap-2">
        <audio controls preload={m.hasPlayback ? "metadata" : "none"} className="w-[240px] max-w-full h-10">
          {m.hasPlayback && <source src={src} type="audio/mp4" />}
          <source src={m.hasPlayback ? `${src}?original=1` : src} type="audio/ogg" onError={() => setFailed(true)} />
        </audio>
        {m.durationSec != null && <span className="text-xs tabular-nums text-muted">{formatDuration(m.durationSec)}</span>}
      </span>
    );
    case "video": return <video controls preload="none" src={src} onError={() => setFailed(true)} className="rounded-[var(--radius-control)] max-h-72 max-w-full bg-ink" />;
    case "document": return <a href={src} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 underline decoration-line-strong underline-offset-2">Abrir documento{m.body ? `: ${m.body}` : ""}</a>;
    default: return null;
  }
}

/** Transcrição do áudio embaixo do player: recolhível, 3 linhas e "ver tudo". Pendente: "Transcrevendo…". Sem fala/falhou: nada. */
function Transcript({ m }: { m: Msg }) {
  const [open, setOpen] = useState(true);
  const [full, setFull] = useState(false);
  if (m.transcriptStatus === "pendente") return <span className="block mt-1 text-xs italic text-muted">Transcrevendo…</span>;
  if (m.transcriptStatus !== "pronta" || !m.transcript) return null;
  const long = m.transcript.length > 160 || m.transcript.split("\n").length > 3;
  return (
    <span className="block mt-1.5 border-t border-line/70 pt-1.5">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="text-xs font-medium text-graphite hover:text-ink">
        Transcrição {open ? "▾" : "▸"}
      </button>
      {open && <>
        <span data-testid="transcricao" className={`block text-sm text-graphite whitespace-pre-wrap break-words ${long && !full ? "line-clamp-3" : ""}`}>{m.transcript}</span>
        {long && !full && <button type="button" onClick={() => setFull(true)} className="text-xs font-medium text-gold-ink underline underline-offset-2">ver tudo</button>}
        {(m.durationSec ?? 0) > TRANSCRIPT_MAX_SECONDS && <span className="block text-xs text-muted">Só os 10 primeiros minutos foram transcritos.</span>}
      </>}
    </span>
  );
}

const STATUS: Record<string, [string, string]> = { pending: ["enviando…", ""], sent: ["✓", ""], delivered: ["✓✓", ""], read: ["✓✓", "text-gold-ink"], simulado: ["simulado", ""], failed: ["não enviada", "text-alert font-semibold"] };

const dayLabel = (iso: string) => {
  const d = new Date(iso), t = new Date(); const y = new Date(); y.setDate(t.getDate() - 1);
  if (d.toDateString() === t.toDateString()) return "Hoje";
  if (d.toDateString() === y.toDateString()) return "Ontem";
  // Outro ano (histórico importado do WhatsApp): o ano vai junto, senão "02 de março" de 2025 parece deste ano.
  return d.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", ...(d.getFullYear() !== t.getFullYear() ? { year: "numeric" } : {}) });
};
const KIND_LABEL: Record<string, string> = { call: "Ligação", image: "Foto", video: "Vídeo", document: "Documento", sticker: "Figurinha", location: "Localização", contact: "Contato", poll: "Enquete", event: "Evento", other: "Mensagem sem prévia (veja no celular)" };

/** Texto curto da mensagem para a faixa "Respondendo a". */
/**
 * A mensagem que acabou de ser enviada (o balão provisório) já chegou do servidor? Então o provisório sai.
 * O servidor grava com a assinatura de quem enviou na frente ("*SARA - CASA FIAES:*"): compara sem ela.
 */
export const optimisticArrived = (messages: Msg[], o: { text: string; at: number }) =>
  messages.some((m) => m.direction === "out" && m.kind !== "nota" && stripSignature(m.body) === o.text && new Date(m.createdAt).getTime() >= o.at - 2000);

export const quotePreview = (m: Msg) => (stripSignature(m.body).trim() || KIND_LABEL[m.kind] || "Mensagem").slice(0, 300);

const quoteNorm = (s: string | null | undefined) => stripSignature(s ?? "").replace(/\s+/g, " ").trim().toLocaleLowerCase("pt-BR");
/**
 * A mensagem original de uma citação (o WhatsApp só manda o texto citado, sem id): a mais recente ANTES da que cita com o mesmo texto
 * (a citação pode vir cortada, então vale começar igual). `null`: não está no histórico carregado.
 */
export function findQuoted(messages: Msg[], quotingId: string): string | null {
  const i = messages.findIndex((x) => x.id === quotingId);
  const q = quoteNorm(messages[i]?.quotedBody);
  if (i < 0 || !q) return null;
  for (let k = i - 1; k >= 0; k--) {
    const c = messages[k];
    if (c.kind === "nota" || c.kind === "call") continue;
    const t = quoteNorm(c.body ?? c.transcript);
    if (t && (t === q || t.startsWith(q) || (t.length >= 12 && q.startsWith(t)))) return c.id;
  }
  return null;
}

/** Os campos que mudam o que o balão mostra. A lista recria os objetos a cada carga; só re-renderiza quem mudou de verdade. */
const sameMsg = (a: Msg, b: Msg) =>
  a === b || (a.id === b.id && a.status === b.status && a.body === b.body && a.kind === b.kind && a.error === b.error && a.quotedBody === b.quotedBody && a.edited === b.edited
    && a.deleted === b.deleted && a.purgedAt === b.purgedAt && a.hasMedia === b.hasMedia && a.externalId === b.externalId && a.sender === b.sender && a.fromPhone === b.fromPhone && a.sentVia === b.sentVia && a.byId === b.byId && a.direction === b.direction && a.createdAt === b.createdAt && a.importedAt === b.importedAt
    && a.durationSec === b.durationSec && a.hasPlayback === b.hasPlayback && a.transcript === b.transcript && a.transcriptStatus === b.transcriptStatus
    && (a.reactions?.cliente ?? null) === (b.reactions?.cliente ?? null) && (a.reactions?.casa ?? null) === (b.reactions?.casa ?? null)
    && JSON.stringify(a.call ?? null) === JSON.stringify(b.call ?? null) && JSON.stringify(a.callNotes ?? null) === JSON.stringify(b.callNotes ?? null));

type BubbleProps = { m: Msg; /** Rótulo do dia, quando este balão abre um dia novo. */ day: string | null; /** Nome pequeno no topo: só quando muda quem fala. */ who?: string | null; onReply?: (m: Msg) => void;
  /** "Apagar para todos" (17/10): só em mensagem enviada pela Casa que chegou ao WhatsApp. Quem chama pede a confirmação. */ onDelete?: (m: Msg) => void;
  /** "Apagar só aqui" (20/10): tira a mensagem da conversa no CRM, qualquer uma, sem mexer no WhatsApp. */ onHide?: (m: Msg) => void;
  /** Reagir e Editar; ausente = a pessoa não tem a permissão ou a função está desligada. */ tools?: BubbleTools;
  /** Tocar na citação: rola até a mensagem original. */ onQuote?: (m: Msg) => void; /** Destaque de ~2 s (veio de uma citação). */ flash?: boolean; /** Entra com animação (mensagem que chegou depois da abertura). */ animateIn: boolean; /** Continuação do balão de cima (mesma pessoa, até 5 min). */ cont?: boolean };

/** Dois conjuntos de props rendem o mesmo balão? (a lista recria os objetos a cada carga; o `memo` compara pelo conteúdo, não pela identidade) */
export const bubblePropsEqual = (a: BubbleProps, b: BubbleProps) => a.day === b.day && (a.who ?? null) === (b.who ?? null) && a.cont === b.cont && a.onReply === b.onReply && a.onDelete === b.onDelete && a.onHide === b.onHide && a.tools === b.tools && a.onQuote === b.onQuote && !!a.flash === !!b.flash && a.animateIn === b.animateIn && sameMsg(a.m, b.m);

const NOTE_FROM: Record<NonNullable<Msg["note"]>, string> = { crm: "", chatguru: " · veio do ChatGuru", menu: " · menu de boas-vindas" };
/** @Nome em negrito dentro da nota. */
const withMentions = (text: string) => text.split(/(@[\p{L}][\p{L}0-9]*)/u).map((part, i) => (part.startsWith("@") ? <b key={i} className="font-semibold">{part}</b> : <Fragment key={i}>{withLinks(part)}</Fragment>));

// Endereço no texto (http(s):// ou www.); a pontuação colada no fim ("veja www.x.com.") fica de fora do link.
const URL_RE = /((?:https?:\/\/|www\.)[^\s<>"']+)/gi;
/** Links clicáveis no balão (22/10, vídeo da Cati: o reel do Instagram que a cliente mandou não abria). Só http/https, em aba nova. */
export function withLinks(text: string) {
  return text.split(URL_RE).map((part, i) => {
    if (i % 2 === 0) return part;
    const url = part.replace(/[.,;:!?)\]}]+$/, "");
    const rest = part.slice(url.length);
    const href = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    return <Fragment key={i}><a href={href} target="_blank" rel="noopener noreferrer" className="break-all text-gold-ink underline decoration-gold/60 underline-offset-2 hover:decoration-gold">{url}</a>{rest}</Fragment>;
  });
}

/** Nota interna: amarela, no meio, com "só a equipe vê". Sem botão Responder e sem tique de envio. */
function NoteBubble({ m, day, animateIn }: { m: Msg; day: string | null; animateIn: boolean }) {
  return (
    <motion.div initial={animateIn ? { opacity: 0, y: 10 } : false} animate={{ opacity: 1, y: 0 }} transition={SPRING_UI} className="flex flex-col">
      {day && <p className="self-center my-2 text-xs font-medium text-muted bg-paper border border-line rounded-full px-2.5 py-0.5 first-letter:uppercase">{day}</p>}
      <div role="note" aria-label="Nota interna" className="self-center w-full max-w-[86%] rounded-[var(--radius-card)] border border-dashed border-gold/60 bg-gold-soft/50 px-3.5 py-2">
        <p className="text-xs font-semibold text-gold-ink">Nota interna · só a equipe vê{NOTE_FROM[m.note ?? "crm"]}</p>
        <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-ink">{withMentions(m.body ?? "")}</p>
        <p className="mt-1 text-right text-xs text-muted">{m.sender ?? "Equipe"} · {new Date(m.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</p>
      </div>
    </motion.div>
  );
}

const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

/** "Anotar o que foi falado": assunto + o que ocorreu. Salvo, oferece "Marcar horário". */
function CallNoteForm({ messageId, actions, onClose }: { messageId: string; actions: CallActions; onClose: (saved: boolean) => void }) {
  const id = useId();
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const ok = await actions.onNote(messageId, { subject: subject.trim(), body: body.trim() }).catch(() => false);
    setBusy(false);
    if (ok) onClose(true);
  };
  return (
    <form className="mt-2 flex flex-col gap-2 text-left" onSubmit={(e) => { e.preventDefault(); if (body.trim()) void save(); }}>
      <label htmlFor={`${id}-a`} className="text-xs font-medium text-graphite">Assunto</label>
      <Input id={`${id}-a`} value={subject} maxLength={120} placeholder="ex.: Agendamento" onChange={(e) => setSubject(e.target.value)} className="h-9" />
      <label htmlFor={`${id}-o`} className="text-xs font-medium text-graphite">O que ocorreu</label>
      <Textarea id={`${id}-o`} value={body} maxLength={2000} rows={2} placeholder="ex.: marcou corte sábado 14h com a Ana" onChange={(e) => setBody(e.target.value)} className="min-h-16" />
      <p className="text-xs text-muted">Fica como nota interna: a cliente não vê.</p>
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={() => onClose(false)} disabled={busy}>Cancelar</Button>
        <Button type="submit" size="sm" aria-label="Salvar anotação" disabled={!body.trim()} loading={busy}>Salvar</Button>
      </div>
    </form>
  );
}

/** Ligação: registro no meio da conversa, como no WhatsApp. Perdida/recusada da cliente em vermelho; com o que foi falado logo abaixo. */
function CallRow({ m, day }: { m: Msg; day: string | null }) {
  const actions = useContext(CallActionsCtx);
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const label = m.call ? callLabel(m.call, m.direction) : m.body ?? "Ligação";
  const missed = m.direction === "in" && (m.call ? m.call.status === "perdida" || m.call.status === "recusada" : /perdida|recusada/i.test(m.body ?? ""));
  const notes = m.callNotes ?? [];
  // Qualquer ligação aceita anotação (a atendida no celular chega como "recebida"; a perdida pode ter sido retornada).
  const canNote = !!actions && m.id !== "optimistic";
  // "Recebida": o WhatsApp não diz se foi atendida no celular; a equipe marca. Marcada à mão: dá para trocar pelo menu discreto.
  const onMark = canNote && m.direction === "in" ? actions.onMark : undefined;
  const unknown = !!onMark && m.call?.status === "recebida";
  const marked = !!onMark && !!m.call?.marked;
  const [marking, setMarking] = useState(false);
  const mark = (status: "atendida" | "perdida" | "recebida") => { setMarking(true); void onMark!(m.id, status).finally(() => setMarking(false)); };
  const by = m.direction === "out" && m.call?.manual && m.sender ? firstName(m.sender) ?? m.sender : null;
  return (
    <div className="flex flex-col">
      {day && <p className="self-center my-2 text-xs font-medium text-muted bg-paper border border-line rounded-full px-2.5 py-0.5 first-letter:uppercase">{day}</p>}
      <div data-testid="ligacao-card" className="self-center my-1 flex w-full max-w-[86%] flex-col items-center">
        <p data-testid="ligacao" className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${missed ? "border-alert/30 bg-alert-soft text-alert" : "border-line bg-paper text-graphite"}`}>
          <IconPhone size={13} aria-hidden />{label} · {hhmm(m.createdAt)}{by && <span className="font-normal text-muted"> · registrada por {by}</span>}
        </p>
        {unknown && (
          <div className="mt-1 flex flex-wrap items-center justify-center gap-1">
            <span className="text-xs text-muted">O WhatsApp não diz se atenderam:</span>
            <Button type="button" size="sm" variant="ghost" disabled={marking} onClick={() => mark("atendida")}>Foi atendida</Button>
            <Button type="button" size="sm" variant="ghost" disabled={marking} onClick={() => mark("perdida")}>Foi perdida</Button>
          </div>
        )}
        {marked && (
          <Menu label="Trocar resultado da ligação" align="left" triggerClassName="mt-0.5 h-6 px-2 rounded-full text-xs text-muted hover:text-ink hover:bg-paper-2"
            trigger={<span>marcada à mão ▾</span>}
            items={[m.call!.status === "atendida" ? { label: "Foi perdida", onSelect: () => mark("perdida") } : { label: "Foi atendida", onSelect: () => mark("atendida") },
              { label: "Não sei (voltar)", onSelect: () => mark("recebida") }]} />
        )}
        {notes.length > 0 && (
          <ul aria-label="O que foi falado na ligação" className="mt-1.5 w-full flex flex-col gap-1.5">
            {notes.map((n) => (
              <li key={n.id} className="rounded-[var(--radius-card)] border border-dashed border-gold/60 bg-gold-soft/50 px-3.5 py-2">
                <p className="text-xs font-semibold text-gold-ink">O que foi falado · só a equipe vê</p>
                {n.subject && <p className="mt-0.5 text-sm font-semibold text-ink">{n.subject}</p>}
                <p className="whitespace-pre-wrap break-words text-sm text-ink">{n.body}</p>
                <p className="mt-1 text-right text-xs text-muted">{n.authorName ?? "Equipe"} · {hhmm(n.createdAt)}</p>
              </li>
            ))}
          </ul>
        )}
        {canNote && !open && (
          <div className="mt-1 flex flex-wrap justify-center gap-1">
            <Button type="button" size="sm" variant="ghost" onClick={() => { setOpen(true); setSaved(false); }}>{notes.length ? "Anotar mais" : "Anotar o que foi falado"}</Button>
            {(saved || notes.length > 0) && actions.onBook && <Button type="button" size="sm" variant="secondary" onClick={actions.onBook}>Marcar horário</Button>}
          </div>
        )}
        {canNote && open && (
          <div className="w-full rounded-[var(--radius-card)] border border-line bg-paper px-3 py-2 shadow-[var(--shadow-card)]">
            <CallNoteForm messageId={m.id} actions={actions} onClose={(ok) => { setOpen(false); setSaved(ok); }} />
          </div>
        )}
      </div>
    </div>
  );
}
const REACTION_WHO = { cliente: "da cliente", casa: "da Casa" } as const;

/** Um balão. `memo` por conteúdo: um evento novo não re-renderiza a conversa inteira. */
/** A Casa pode apagar para todos: enviada pelo número da Casa (CRM, celular ou ChatGuru), com id no WhatsApp, entregue e não importada. */
export const canDeleteForEveryone = (m: Msg) => m.direction === "out" && m.kind !== "nota" && m.kind !== "call" && m.id !== "optimistic" && !!m.externalId
  && !m.deleted && !m.importedAt && m.status !== "pending" && m.status !== "failed" && m.status !== "simulado";

export const Bubble = memo(function Bubble({ m, day, who = null, onReply, onDelete, onHide, tools, onQuote, flash = false, animateIn, cont = false }: BubbleProps) {
  const [bar, setBar] = useState(false);
  const press = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelPress = () => { if (press.current) { clearTimeout(press.current); press.current = null; } };
  if (m.kind === "nota") return <NoteBubble m={m} day={day} animateIn={animateIn} />;
  if (m.kind === "call") return <CallRow m={m} day={day} />;
  const out = m.direction === "out";
  // A assinatura "*SARA - CASA FIAES:*" vira o nome no rodapé; no texto ela some.
  const text = out ? stripSignature(m.body) : m.body;
  const canReact = !!tools?.react && canReactTo(m);
  const canEdit = !!tools?.edit && !!tools.canEdit?.(m);
  const canForward = !!tools?.forward && !!tools.canForward?.(m);
  const myReaction = m.reactions?.casa ?? null;
  const toolItems = [
    ...(canReact ? REACTION_CHOICES.map((e) => ({ label: `Reagir ${e}`, onSelect: () => tools!.react!(m, e) })) : []),
    ...(canEdit ? [{ label: "Editar", onSelect: () => tools!.edit!(m) }] : []),
    ...(canForward ? [{ label: "Encaminhar", onSelect: () => tools!.forward!(m) }] : []),
  ];
  const menuItems = [...toolItems, ...(onHide && m.id !== "optimistic" ? [{ label: "Apagar só aqui", danger: true, onSelect: () => onHide(m) }] : []),
    ...(onDelete && canDeleteForEveryone(m) ? [{ label: "Apagar para todos", danger: true, onSelect: () => onDelete(m) }] : [])];
  // Continuação: cola no balão de cima (sem a "pontinha" de quem fala).
  const shape = out ? (cont ? "rounded-tr-[5px]" : "rounded-br-[5px]") : (cont ? "rounded-tl-[5px]" : "rounded-bl-[5px]");
  return (
    <motion.div data-msg-id={m.id} initial={animateIn ? { opacity: 0, y: 10 } : false} animate={{ opacity: 1, y: 0 }} transition={SPRING_UI} className={`flex flex-col ${cont ? "-mt-1" : ""}`}>
      {day && <p className="self-center my-2 text-xs font-medium text-muted bg-paper border border-line rounded-full px-2.5 py-0.5 first-letter:uppercase">{day}</p>}
      <div className={`group flex items-center gap-1 ${out ? "flex-row-reverse self-end" : "self-start"} max-w-full`}>
        <div data-destaque={flash ? "" : undefined}
          onPointerDown={(e) => { if (e.pointerType === "touch" && (canReact || canEdit || canForward)) { cancelPress(); press.current = setTimeout(() => { press.current = null; setBar(true); }, LONG_PRESS_MS); } }}
          onPointerUp={cancelPress} onPointerLeave={cancelPress} onPointerCancel={cancelPress} onPointerMove={cancelPress}
          onContextMenu={(e) => { if (canReact || canEdit || canForward) { e.preventDefault(); setBar(true); } }}
          className={`min-w-0 max-w-[78%] rounded-[var(--radius-card)] px-3.5 py-2 text-base leading-relaxed shadow-[var(--shadow-card)] transition-shadow duration-300 ${flash ? "ring-2 ring-gold ring-offset-2 ring-offset-paper" : ""} ${out ? "bg-[#f3ead9]" : "bg-paper border border-line"} ${shape} ${m.status === "pending" ? "opacity-60" : ""}`}>
          {who && <span data-quem="" className="block mb-0.5 text-xs font-semibold leading-tight text-gold-ink">{who}</span>}
          {m.quotedBody && !m.deleted && (onQuote ? (
            <button type="button" onClick={() => onQuote(m)} aria-label={`Ir para a mensagem citada: ${stripSignature(m.quotedBody).slice(0, 80)}`}
              className={`block w-[calc(100%+0.5rem)] text-left mb-1.5 -mx-1 px-2.5 py-1.5 rounded-[var(--radius-control)] border-l-2 border-gold/70 text-sm text-graphite line-clamp-3 cursor-pointer hover:brightness-95 ${out ? "bg-paper/60" : "bg-paper-2"}`}>{stripSignature(m.quotedBody)}</button>
          ) : (
            <span className={`block mb-1.5 -mx-1 px-2.5 py-1.5 rounded-[var(--radius-control)] border-l-2 border-gold/70 text-sm text-graphite line-clamp-3 ${out ? "bg-paper/60" : "bg-paper-2"}`}>{stripSignature(m.quotedBody)}</span>
          ))}
          {/* Apagada (20/10, pedido do dono): como no WhatsApp, só o aviso; o texto, o áudio, a foto e o vídeo não aparecem mais. */}
          {m.deleted ? (
            <span data-apagada="" className="inline-flex items-center gap-1.5 italic text-graphite">
              <span aria-hidden>🚫</span>{out ? "Mensagem apagada" : "A cliente apagou esta mensagem"}
            </span>
          ) : (
          <span className="contents">
            {m.hasMedia && m.kind !== "text" ? (
              <><Media m={m} />{text && m.kind !== "document" && <span className="block whitespace-pre-wrap break-words">{withLinks(text)}</span>}{m.kind === "audio" && !m.purgedAt && <Transcript m={m} />}</>
            ) : m.importedAt && m.kind !== "text" ? (
              <span className="text-graphite italic">{KIND_LABEL[m.kind] ?? "Mídia"} (mídia não importada){text ? <span className="block not-italic text-ink whitespace-pre-wrap break-words">{withLinks(text)}</span> : null}</span>
            ) : m.kind === "audio" ? (
              <span className="inline-flex items-center gap-2 text-graphite"><IconMic size={15} /> Áudio</span>
            ) : m.kind !== "text" && !m.body ? (
              <span className="text-graphite italic">{KIND_LABEL[m.kind] ?? "Mensagem"}</span>
            ) : (
              <>{m.kind !== "text" && <span className="text-graphite italic">{KIND_LABEL[m.kind]}: </span>}<span className="whitespace-pre-wrap break-words">{withLinks(text ?? "")}</span></>
            )}
          </span>
          )}
          <span className="flex items-center justify-end gap-1 text-xs text-muted mt-1" title={m.status === "failed" && m.error ? m.error : undefined}>
            {m.importedAt && <span data-importada="" className="shrink-0 rounded-full border border-line px-1.5 leading-4 text-xs text-muted">importada</span>}
            {m.edited && "editada · "}
            {out && outVia(m)}
            {new Date(m.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
            {out && !m.importedAt && STATUS[m.status] && <span className={`ml-0.5 ${STATUS[m.status][1]}`} aria-label={`Status: ${m.status}`}>{STATUS[m.status][0]}</span>}
          </span>
          {(m.reactions?.cliente || m.reactions?.casa) && (
            <span className={`mt-1 flex gap-1 ${out ? "justify-end" : "justify-start"}`}>
              {(["cliente", "casa"] as const).filter((k) => m.reactions?.[k]).map((k) => (
                <span key={k} aria-label={`Reação ${REACTION_WHO[k]}: ${m.reactions![k]}`} title={`Reação ${REACTION_WHO[k]}`}
                  className="rounded-full border border-line bg-paper px-1.5 text-sm leading-6 shadow-[var(--shadow-card)]">{m.reactions![k]}</span>
              ))}
            </span>
          )}
          {bar && (canReact || canEdit || canForward) && (
            <span role="group" aria-label="Ações da mensagem" data-testid="barra-mensagem" className={`mt-1.5 flex flex-wrap items-center gap-1 ${out ? "justify-end" : "justify-start"}`}>
              {canReact && REACTION_CHOICES.map((e) => (
                <button key={e} type="button" aria-label={myReaction === e ? `Tirar reação ${e}` : `Reagir ${e}`} aria-pressed={myReaction === e}
                  onClick={() => { setBar(false); tools!.react!(m, e); }}
                  className={`size-10 rounded-full text-xl leading-none hover:bg-paper-2 ${myReaction === e ? "bg-gold-soft/60 ring-1 ring-gold" : "bg-paper border border-line"}`}>{e}</button>
              ))}
              {canEdit && <button type="button" onClick={() => { setBar(false); tools!.edit!(m); }} className="h-10 rounded-full border border-line bg-paper px-3 text-sm font-medium text-ink hover:bg-paper-2">Editar</button>}
              {canForward && <button type="button" onClick={() => { setBar(false); tools!.forward!(m); }} className="h-10 rounded-full border border-line bg-paper px-3 text-sm font-medium text-ink hover:bg-paper-2">Encaminhar</button>}
              <button type="button" aria-label="Fechar" onClick={() => setBar(false)} className="h-10 rounded-full px-2.5 text-sm text-muted hover:text-ink">Fechar</button>
            </span>
          )}
          {out && m.status === "failed" && <span className="block text-xs text-alert mt-1">Não chegou na cliente. Copie o texto e envie de novo.</span>}
        </div>
        {onReply && m.id !== "optimistic" && m.externalId && m.status !== "pending" && m.status !== "failed" && !m.deleted && (
          <IconButton label="Responder" onClick={() => onReply(m)}
            className="opacity-40 group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-70 transition-opacity"><IconReply size={16} /></IconButton>
        )}
        {/* 20/10 (Cati): só no "…" ela não achava; 21/10 (dono): nem passando o mouse achou, então as setas ficam sempre à vista (clarinhas). */}
        {canForward && (
          <IconButton label="Encaminhar" onClick={() => tools!.forward!(m)}
            className="opacity-40 group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-70 transition-opacity"><IconForward size={16} /></IconButton>
        )}
        {menuItems.length > 0 && (
          <Menu label="Mais ações da mensagem" align={out ? "right" : "left"} items={menuItems}
            triggerClassName="grid size-9 place-items-center rounded-full text-muted hover:text-ink hover:bg-paper-2 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100 pointer-coarse:opacity-70 transition-opacity"
            trigger={<IconMore size={16} />} />
        )}
      </div>
    </motion.div>
  );
}, bubblePropsEqual);

const GROUP_MS = 5 * 60_000;
/**
 * Os balões com o rótulo do dia onde o dia muda e `cont` (continuação): mesma pessoa, mesmo lado, mesmo dia e até 5 min
 * depois da anterior. O balão de continuação cola no de cima, sem a "pontinha".
 */
export const withDays = (messages: Msg[]) => messages.map((m, i) => {
  const day = dayLabel(m.createdAt);
  const prev = messages[i - 1];
  const newDay = i === 0 || dayLabel(prev.createdAt) !== day;
  const cont = m.kind !== "nota" && prev?.kind !== "nota" && m.kind !== "call" && prev?.kind !== "call" && !newDay && !!prev && prev.direction === m.direction && (prev.sender ?? null) === (m.sender ?? null) && prev.fromPhone === m.fromPhone && (prev.sentVia ?? null) === (m.sentVia ?? null)
    && new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() <= GROUP_MS;
  // Nome de quem fala, pequeno no topo do balão da Casa, só quando muda quem fala (como num grupo do WhatsApp).
  const speaker = m.direction === "out" && m.kind !== "nota" && m.kind !== "call" ? speakerOf(m) : null;
  const prevSpeaker = prev && prev.direction === "out" && prev.kind !== "nota" && prev.kind !== "call" ? speakerOf(prev) : null;
  const who = speaker && (newDay || speaker !== prevSpeaker) ? speaker : null;
  return { m, day: newDay ? day : null, cont, who };
});

const BOTTOM_SLACK = 48; // quanto de folga ainda conta como "no fim"
export const WRAP = "bg-[radial-gradient(circle_at_1px_1px,rgb(18_18_18/0.035)_1px,transparent_0)] [background-size:18px_18px]";

/**
 * A conversa. Abre no fim (sem rolagem animada). Mensagem nova: se a pessoa está no fim, a conversa desce junto;
 * se ela rolou para cima, a leitura não se mexe e aparece o aviso "N nova(s) mensagem(ns)".
 * Só o que a própria atendente envia desce sozinho (o balão provisório, ou `forceEndKey` mudando quando o envio é de mídia, sem balão provisório);
 * saída por outro canal (celular da Casa, automação) segue a regra do aviso.
 * `visible` é falso quando a conversa está escondida por uma aba (celular): ao reaparecer, volta ao fim se estava no fim, ou à posição em que ficou.
 */
export function Conversation({ messages, onReply, onDelete, onHide, tools, label = "Mensagens", forceEndKey = 0, visible = true, callActions }: { messages: Msg[]; onReply?: (m: Msg) => void;
  /** "Apagar para todos" (17/10): quem chama pede a confirmação e chama o servidor. */ onDelete?: (m: Msg) => void; /** "Apagar só aqui" (20/10). */ onHide?: (m: Msg) => void; /** Reagir e Editar (Task 12). */ tools?: BubbleTools; label?: string; forceEndKey?: number; visible?: boolean;
  /** Ligações: "Anotar o que foi falado" e "Marcar horário" (Lote 5). */ callActions?: CallActions }) {
  const scroller = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const lastTop = useRef(0); // onde a leitura estava (para voltar a ela depois de uma aba)
  const stuck = useRef(true); // a pessoa está no fim: acompanha o que crescer (mensagem, foto que carregou, teclado que abriu)
  const seen = useRef<{ lastId: string | null; optimistic: boolean } | null>(null);
  const [unseen, setUnseen] = useState(0);
  /** Longe do fim (lendo mensagens antigas): aparece "Mais recentes ↓" para voltar com um toque. */
  const [away, setAway] = useState(false);
  // Quem já estava na tela ao abrir não anima; só o que chega depois.
  const [initialIds] = useState(() => new Set(messages.map((m) => m.id)));
  // Citação: rola até a original e destaca ~2 s; fora do histórico carregado, avisa. Ref: o callback não muda a cada carga (memo dos balões).
  const msgsRef = useRef(messages);
  useLayoutEffect(() => { msgsRef.current = messages; }, [messages]);
  const [flash, setFlash] = useState<string | null>(null);
  const [quoteNotice, setQuoteNotice] = useState(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(flashTimer.current), []);
  const onQuote = useCallback((m: Msg) => {
    const target = findQuoted(msgsRef.current, m.id);
    clearTimeout(flashTimer.current);
    if (!target) { setFlash(null); setQuoteNotice(true); flashTimer.current = setTimeout(() => setQuoteNotice(false), 3000); return; }
    const el = scroller.current?.querySelector<HTMLElement>(`[data-msg-id="${target}"]`);
    stuck.current = false;
    const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    el?.scrollIntoView?.({ block: "center", behavior: reduce ? "auto" : "smooth" });
    setQuoteNotice(false); setFlash(target);
    flashTimer.current = setTimeout(() => setFlash(null), 2000);
  }, []);

  const toEnd = useCallback(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
    stuck.current = true;
    setAway(false);
  }, []);

  useLayoutEffect(() => {
    const real = messages.filter((m) => m.id !== "optimistic");
    const lastId = real.at(-1)?.id ?? null;
    const optimistic = messages.length > real.length;
    const prev = seen.current;
    seen.current = { lastId, optimistic };
    if (!prev) { toEnd(); return; } // abertura: direto no fim, antes da pintura
    const at = prev.lastId ? real.findIndex((m) => m.id === prev.lastId) : -1;
    // Outra conversa (a lista trocou por inteiro): abre sempre nas mais recentes, nunca onde a anterior estava.
    if (prev.lastId && at < 0 && prev.lastId !== lastId) { toEnd(); setUnseen(0); return; }
    const fresh = at >= 0 ? real.slice(at + 1) : prev.lastId === lastId ? [] : real;
    const mine = optimistic && !prev.optimistic; // o balão provisório da própria atendente
    if (mine || (fresh.length && stuck.current)) { toEnd(); setUnseen(0); } // o aviso zera junto com a rolagem
    else if (fresh.length) setUnseen((n) => n + fresh.length);
  }, [messages, toEnd]);

  // Envio de mídia (sem balão provisório): a própria atendente quer ver o que mandou.
  const endKey = useRef(forceEndKey);
  useLayoutEffect(() => {
    if (endKey.current === forceEndKey) return;
    endKey.current = forceEndKey;
    toEnd(); setUnseen(0); // zera o aviso junto com a rolagem
  }, [forceEndKey, toEnd]);

  // Aba que reexibe a conversa (o navegador perde a rolagem de um elemento escondido).
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!visible || !el) return;
    if (stuck.current) toEnd(); else el.scrollTop = lastTop.current;
  }, [visible, toEnd]);

  useLayoutEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => { if (stuck.current && scroller.current?.clientHeight) toEnd(); });
    if (inner.current) ro.observe(inner.current);
    if (scroller.current) ro.observe(scroller.current);
    return () => ro.disconnect();
  }, [toEnd]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el || !el.clientHeight) return; // escondida por uma aba: o navegador zera a rolagem, e isso não é a pessoa lendo
    lastTop.current = el.scrollTop;
    const atEnd = el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_SLACK;
    stuck.current = atEnd;
    setAway(el.scrollHeight - el.scrollTop - el.clientHeight > el.clientHeight);
    if (atEnd) setUnseen((n) => (n ? 0 : n));
  };

  const rows = withDays(messages);
  // "Histórico importado do WhatsApp em 16/10": uma linha só, antes da primeira mensagem trazida do arquivo.
  const firstImported = rows.findIndex((r) => r.m.importedAt);
  return (
    <CallActionsCtx.Provider value={callActions ?? null}>
    <div className="relative flex-1 min-h-0 flex flex-col">
      <div ref={scroller} onScroll={onScroll} role="log" aria-label={label} tabIndex={0}
        className={`flex-1 min-h-0 overflow-y-auto overscroll-contain scroll-thin px-4 py-4 outline-offset-[-2px] ${WRAP}`}>
        <div ref={inner} className="flex flex-col gap-1.5 min-h-full">
          {messages.length === 0 && <p className="m-auto text-center text-muted text-sm max-w-[30ch]">Nenhuma mensagem ainda. A conversa aparece aqui assim que o cliente escrever.</p>}
          {rows.map(({ m, day, cont, who }, i) => (
            <Fragment key={m.id}>
            {i === firstImported && (
              <p data-testid="historico-importado" className="self-center mt-2 mb-1 text-xs text-muted">Histórico importado do WhatsApp em {new Date(m.importedAt!).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Bahia" })}</p>
            )}
            <Bubble m={m} day={day} who={who} cont={cont} onReply={onReply} onDelete={onDelete} onHide={onHide} tools={tools} onQuote={onQuote} flash={flash === m.id} animateIn={!initialIds.has(m.id) && (m.direction === "in" || m.id === "optimistic" || m.kind === "nota")} />
            </Fragment>
          ))}
        </div>
      </div>
      <AnimatePresence>
        {quoteNotice && (
          <motion.p key="citada-fora" role="status" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: T.base, ease: EASE }}
            className="absolute top-3 left-1/2 -translate-x-1/2 rounded-full bg-ink px-4 py-2 text-sm font-medium text-paper shadow-[var(--shadow-pop)]">
            Mensagem antiga, fora do histórico carregado
          </motion.p>
        )}
        {unseen > 0 && (
          <motion.button type="button" key="novas" onClick={() => { toEnd(); setUnseen(0); }}
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }} transition={{ duration: T.base, ease: EASE }}
            className="absolute bottom-3 left-1/2 -translate-x-1/2 min-h-11 px-4 rounded-full bg-ink text-paper text-sm font-semibold shadow-[var(--shadow-pop)] inline-flex items-center gap-2">
            {unseen === 1 ? "1 nova mensagem" : `${unseen} novas mensagens`} <span aria-hidden>↓</span>
          </motion.button>
        )}
        {unseen === 0 && away && (
          <motion.button type="button" key="recentes" onClick={toEnd}
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }} transition={{ duration: T.base, ease: EASE }}
            className="absolute bottom-3 left-1/2 -translate-x-1/2 min-h-11 px-4 rounded-full bg-paper text-ink border border-line-strong text-sm font-semibold shadow-[var(--shadow-pop)] inline-flex items-center gap-2">
            Mais recentes <span aria-hidden>↓</span>
          </motion.button>
        )}
      </AnimatePresence>
    </div>
    </CallActionsCtx.Provider>
  );
}
