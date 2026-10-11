"use client";
import { ContactAvatar } from "@/components/ui/contact-avatar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import type { DealDetail } from "@/server/queries/deal";
import { Conversation, quotePreview, type Msg } from "./conversation";
import { Composer, type QuoteTarget } from "./composer";
import { AutoField } from "./fields";
import { markConversationReadAction } from "@/app/(app)/funil/actions";
import type { Viewer } from "@/app/(app)/atendimento/actions";
import { useLeadActions } from "@/components/queue/use-lead-actions";
import { IconClose, IconPhone, IconMail, IconInstagram, IconWhatsApp, IconCake, IconClock, IconArrowRight } from "@/components/icons";
import { useLiveRefresh } from "@/components/shell/live";
import { useUrgencyLevel } from "@/components/pipeline/timer";
import { Elapsed } from "@/components/motion/elapsed";
import { Badge } from "@/components/ui/badge";
import { formatPhoneClient } from "@/lib/phone-client";
import { money, PAYMENT_LABEL } from "@/lib/format";
import { groupByDay, HISTORY_EVENT_LIMIT, historyEntries } from "@/lib/history";
import { Button } from "@/components/ui/button";
import { SPRING_UI, SPRING_SHEET, EASE, T, exitOf } from "@/lib/motion";
import { isChannelOrigin, NOT_IDENTIFIED } from "@/lib/source-kinds";

const pad = (n: number) => String(n).padStart(2, "0");
const toLocal = (d: Date | string | null) => { if (!d) return ""; const x = new Date(d); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}T${pad(x.getHours())}:${pad(x.getMinutes())}`; };
const toDate = (d: Date | string | null) => (d ? toLocal(d).slice(0, 10) : "");
const centsToInput = (c: number | null) => (c == null ? "" : (c / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 }));

/** Os campos editáveis do lead (nome, contato, origem, agendamento, valor…). `cols` é o número de colunas dos pares de campos. */
export function LeadDetails({ d, cols }: { d: DealDetail; cols: "grid-cols-1" | "grid-cols-2" }) {
  const birthday = d.contact.birthDay && d.contact.birthMonth ? `${pad(d.contact.birthDay)}/${pad(d.contact.birthMonth)}${d.contact.birthYear ? `/${d.contact.birthYear}` : ""}` : "";
  return (
  <div className="flex flex-col gap-3.5">
    {d.contact.isClient && (
      <div className="rounded-[var(--radius-control)] bg-ok-soft text-ok px-3 py-2.5 text-sm">
        <b>Já é cliente</b>{d.contact.clientSince ? ` desde ${new Date(d.contact.clientSince).getFullYear()}` : ""}{d.contact.lastServiceAt ? ` · último atendimento ${new Date(d.contact.lastServiceAt).toLocaleDateString("pt-BR")}` : ""}
      </div>
    )}
    <AutoField dealId={d.deal.id} name="name" label="Nome" value={d.contact.name ?? ""} placeholder="Adicionar nome" />
    <div className={`grid ${cols} gap-x-4 gap-y-3.5`}>
      <AutoField dealId={d.deal.id} name="email" label="E-mail" kind="email" value={d.contact.email ?? ""} placeholder="Adicionar e-mail" />
      <AutoField dealId={d.deal.id} name="instagram" label="Instagram" value={d.contact.instagram ? `@${d.contact.instagram}` : ""} placeholder="Adicionar @" />
      <AutoField dealId={d.deal.id} name="birthday" label="Aniversário" kind="birthday" value={birthday} placeholder="dd/mm" icon={<IconCake size={12} />} />
      <AutoField dealId={d.deal.id} name="origin" label="Origem" kind="select" emptyLabel={NOT_IDENTIFIED} value={d.sourceLabel === NOT_IDENTIFIED ? "" : d.sourceLabel}
        options={[...new Set([...d.origins.map((o) => o.label).filter((o) => !isChannelOrigin(o)), ...(d.sourceLabel === NOT_IDENTIFIED ? [] : [d.sourceLabel])])].map((o) => ({ value: o, label: o }))} />
      <AutoField dealId={d.deal.id} name="objectionId" label="Objeção" kind="select" value={d.deal.objectionId ?? ""} options={d.objections.map((o) => ({ value: o.id, label: o.label }))} />
      <AutoField dealId={d.deal.id} name="ownerId" label="Responsável" kind="select" value={d.deal.ownerId ?? ""} options={d.people.map((p) => ({ value: p.id, label: p.name }))} />
    </div>
    <AutoField dealId={d.deal.id} name="observations" label="Observações" kind="textarea" value={d.deal.observations ?? ""} placeholder="Anotações livres sobre a cliente…" />
    <div className="h-px bg-line my-1" />
    <div className={`grid ${cols} gap-x-4 gap-y-3.5`}>
      <AutoField dealId={d.deal.id} name="scheduledAt" label="Agendamento" kind="datetime" value={toLocal(d.deal.scheduledAt)} />
      <AutoField dealId={d.deal.id} name="valueCents" label="Valor (R$)" kind="money" value={centsToInput(d.deal.valueCents)} placeholder="0,00" />
      <AutoField dealId={d.deal.id} name="paymentMethod" label="Forma de pagamento" kind="select" value={d.deal.paymentMethod ?? ""} options={Object.entries(PAYMENT_LABEL).map(([value, label]) => ({ value, label }))} />
      <AutoField dealId={d.deal.id} name="chargeAt" label="Data de cobrança" kind="datetime" value={toLocal(d.deal.chargeAt)} />
      <AutoField dealId={d.deal.id} name="recontactAt" label="Recontato em" kind="date" value={toDate(d.deal.recontactAt)} />
      {d.stage.kind === "perdido" && <AutoField dealId={d.deal.id} name="lostReasonId" label="Motivo da perda" kind="select" value={d.deal.lostReasonId ?? ""} options={d.lostReasons.map((o) => ({ value: o.id, label: o.label }))} />}
    </div>
    {d.history.length > 0 && (
      <div className="mt-2">
        <p className="text-xs font-medium text-muted mb-1.5">Atendimentos anteriores</p>
        <ul className="text-sm flex flex-col gap-1">{d.history.map((h) => <li key={h.id} className="flex justify-between"><span>{h.stage}</span><span className="text-muted">{new Date(h.createdAt).toLocaleDateString("pt-BR")}{h.valueCents ? ` · ${money(h.valueCents)}` : ""}</span></li>)}</ul>
      </div>
    )}
  </div>
  );
}

const HISTORY_PAGE = 15;

/**
 * O histórico do lead: o que mudou, do mais novo para o mais antigo, agrupado por dia. Mudança de campo mostra o de/para
 * ("Valor: R$ 100,00 → R$ 150,00 (Ana, 14:02)"). Mensagens ficam de fora (já estão na conversa). "Ver mais" abre mais 15 linhas.
 */
export function LeadTimeline({ d }: { d: DealDetail }) {
  const [shown, setShown] = useState(HISTORY_PAGE);
  const [now] = useState(() => Date.now());
  const entries = useMemo(() => historyEntries(d.events, {
    users: Object.fromEntries(d.people.map((p) => [p.id, p.name])),
    lists: Object.fromEntries([...d.objections, ...d.lostReasons, ...d.services, ...d.origins].map((l) => [l.id, l.label])),
    sources: Object.fromEntries(d.sources.map((s) => [s.id, s.label])),
    stages: Object.fromEntries(d.stages.map((s) => [s.key, s.name])),
  }), [d.events, d.people, d.objections, d.lostReasons, d.services, d.origins, d.sources, d.stages]);
  const days = useMemo(() => groupByDay(entries.slice(0, shown), now), [entries, shown, now]);
  if (!entries.length) return <p className="text-sm text-muted">Nada aconteceu neste lead ainda.</p>;
  return (
    <div className="flex flex-col gap-4">
      {days.map((day) => (
        <section key={day.key} aria-label={day.label} className="flex flex-col gap-2">
          <h5 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted first-letter:uppercase" suppressHydrationWarning>{day.label}</h5>
          <ol className="relative flex flex-col gap-2.5 pl-4 before:absolute before:left-[3px] before:top-1.5 before:bottom-1.5 before:w-px before:bg-line">
            {day.entries.map((e) => (
              <li key={e.id} className="relative" data-testid="historico-item">
                <span aria-hidden className={`absolute -left-4 top-[7px] size-[7px] rounded-full ${e.tone === "alerta" ? "bg-alert" : e.tone === "etapa" ? "bg-gold" : e.tone === "ok" ? "bg-ok" : "bg-line-strong"}`} />
                <p className="text-sm leading-snug text-ink">{e.text} <span className="text-muted">({e.meta})</span></p>
              </li>
            ))}
          </ol>
        </section>
      ))}
      {d.events.length >= HISTORY_EVENT_LIMIT && <p className="text-xs text-muted">Mostrando os {HISTORY_EVENT_LIMIT} eventos mais recentes.</p>}
      {entries.length > shown && (
        <Button variant="secondary" size="sm" className="self-start pointer-coarse:min-h-11" onClick={() => setShown((n) => n + HISTORY_PAGE)}>
          Ver mais ({entries.length - shown})
        </Button>
      )}
    </div>
  );
}

/**
 * Dados + Histórico do lead, lado a lado com a conversa (`bp` = a partir de qual largura o painel fica fixo) ou nas abas Dados/Histórico do celular (`tab`).
 * Em telas estreitas quem escolhe é `tab`; no painel largo, as abas de dentro.
 */
const SIDE_CLASS = {
  lg: { tabs: "hidden lg:flex", dados: ["lg:block", "lg:hidden"], hist: ["lg:block", "lg:hidden"] },
  xl: { tabs: "hidden xl:flex", dados: ["xl:block", "xl:hidden"], hist: ["xl:block", "xl:hidden"] },
} as const;
export function LeadSide({ d, tab, bp, cols }: { d: DealDetail; tab: "conversa" | "dados" | "historico"; bp: "lg" | "xl"; cols: "grid-cols-1" | "grid-cols-2" }) {
  const [sideTab, setSideTab] = useState<"dados" | "historico">("dados");
  const c = SIDE_CLASS[bp];
  return (
    <>
      <div className={`${c.tabs} gap-1 bg-paper-2 rounded-[var(--radius-control)] p-1 mb-4`} role="tablist" aria-label="Painel do lead">
        {(["dados", "historico"] as const).map((t) => (
          <button key={t} role="tab" aria-selected={sideTab === t} onClick={() => setSideTab(t)} className="relative flex-1 h-8 text-sm rounded-[8px]">
            {sideTab === t && <motion.span layoutId={`lead-side-tab-${bp}`} transition={SPRING_UI} className="absolute inset-0 bg-paper rounded-[8px] shadow-[var(--shadow-card)]" />}
            <span className="relative">{t === "dados" ? "Dados" : `Histórico (${d.events.length})`}</span>
          </button>
        ))}
      </div>
      <div className={`${tab === "historico" ? "hidden" : ""} ${sideTab === "dados" ? c.dados[0] : c.dados[1]}`}><LeadDetails d={d} cols={cols} /></div>
      <div className={`${tab === "dados" ? "hidden" : ""} ${sideTab === "historico" ? c.hist[0] : c.hist[1]}`}><LeadTimeline d={d} /></div>
    </>
  );
}

/**
 * O lead aberto por cima do Quadro (/funil?lead=ID): folha lateral com cabeçalho, conversa e dados.
 * Em ≥ 1024 px a conversa fica à esquerda e os dados à direita; abaixo disso, abas Conversa | Dados | Histórico.
 * Na Fila (/atendimento) quem faz isso é o `ConversationPane`.
 */
/** "Esperando resposta há 5 min": folha própria, o único pedaço do painel que escuta o relógio (o painel e a conversa não re-renderizam por segundo). */
function WaitPill({ since, sla, hidden }: { since: string | null; sla: number | null; hidden: boolean }) {
  const urgency = useUrgencyLevel(since, sla);
  return (
    <AnimatePresence initial={false}>
      {since && !hidden && (
        <motion.div key="wait" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: T.enter, ease: EASE }}>
          <p className={`mt-3 inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-sm font-semibold ${urgency === "late" ? "bg-alert text-white" : urgency === "warn" ? "bg-gold-soft text-gold-ink" : "bg-paper-2 text-ink"}`}>
            <IconClock size={14} />Esperando resposta há <Elapsed since={since} sla={sla} />{sla ? <span className="font-normal opacity-80">· prazo {sla} min</span> : null}
          </p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * Trocar de lead com o painel aberto ("Próximo da fila") não fecha e reabre o painel: ele fica no lugar e o conteúdo faz um crossfade curto.
 * `swap` (custom) escolhe a variante: abrindo/fechando de verdade desliza para a direita; trocando de lead só esmaece (opacity), sem dois painéis cruzando a tela.
 */
const SCRIM_V = {
  hidden: (swap: boolean) => (swap ? { opacity: 1 } : { opacity: 0 }),
  shown: { opacity: 1 },
  gone: (swap: boolean) => (swap ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0 }),
};
const ASIDE_V = {
  hidden: (swap: boolean) => (swap ? { opacity: 0 } : { x: "100%" }),
  shown: (swap: boolean) => ({ x: 0, opacity: 1, transition: swap ? { duration: T.fast, ease: EASE } : SPRING_SHEET }),
  gone: (swap: boolean) => (swap ? { opacity: 0, transition: { duration: exitOf(T.fast), ease: EASE } } : { x: "100%", transition: SPRING_SHEET }),
};

export function LeadSheet({ d, nextId, viewer, swap = false }: { d: DealDetail; nextId?: string | null; viewer: Viewer | null; /** Entrou no lugar de outro lead aberto: sem deslizar. */ swap?: boolean }) {
  const router = useRouter();
  const sp = useSearchParams();
  useLiveRefresh([`deal:${d.deal.id}`]); // o card aberto só se atualiza com avisos do próprio lead
  const [tab, setTab] = useState<"conversa" | "dados" | "historico">("conversa");
  const [answered, setAnswered] = useState(false);
  const awaitingSince = d.deal.awaitingReplySince ? new Date(d.deal.awaitingReplySince).toISOString() : null;
  const [optimistic, setOptimistic] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<QuoteTarget | null>(null);
  // Visto azul: uma vez por abertura do lead (o servidor só marca o que chegou depois da última vez).
  const readFor = useRef<string | null>(null);
  useEffect(() => {
    if (readFor.current === d.deal.id) return;
    readFor.current = d.deal.id;
    void markConversationReadAction(d.deal.id);
  }, [d.deal.id]);

  const close = () => {
    const p = new URLSearchParams(sp.toString()); p.delete("lead");
    router.push(`/funil${p.size ? `?${p}` : ""}`, { scroll: false });
  };
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || document.querySelector("[role=dialog][aria-modal]")) return;
      // Não fecha o card se há texto sendo digitado (evita perder a resposta).
      const el = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
      if (el && (el.tagName === "TEXTAREA" || el.tagName === "INPUT") && el.value?.trim()) return;
      close();
    };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  });

  const name = d.contact.name?.trim() || formatPhoneClient(d.contact.phoneE164);
  const firstName = d.contact.name?.trim().split(/\s+/)[0] ?? "";
  const msgs: Msg[] = useMemo(() => {
    const base = d.messages.map((m) => ({ id: m.id, externalId: m.externalId, direction: m.direction, kind: m.kind, body: m.body, status: m.status, createdAt: new Date(m.createdAt).toISOString(), sender: m.sender, fromPhone: m.fromPhone, error: m.error, hasMedia: m.hasMedia, quotedBody: m.quotedBody, edited: !!m.editedAt, deleted: !!m.deletedAt }));
    return optimistic ? [...base, { id: "optimistic", direction: "out" as const, kind: "text", body: optimistic, status: "pending", createdAt: new Date().toISOString(), sender: null, fromPhone: false }] : base;
  }, [d.messages, optimistic]);

  // Agendar, fechar venda e perdido abrem as mesmas folhas da Fila; o servidor não move para essas etapas sem os dados.
  const { moveTo, sheets } = useLeadActions({ d, name, viewer, reload: async () => router.refresh() });
  const onReply = useCallback((m: Msg) => setReplyTo({ id: m.id, text: quotePreview(m) }), []);
  const wa = `https://wa.me/${d.contact.phoneE164.replace(/\D/g, "")}`;

  return (
    <>
      <motion.div className="fixed inset-0 z-40 bg-ink/25 lg:bg-ink/15" variants={SCRIM_V} custom={swap} initial="hidden" animate="shown" exit="gone" onClick={close} aria-hidden />
      <motion.aside role="dialog" aria-label={`Lead ${name}`} variants={ASIDE_V} custom={swap} initial="hidden" animate="shown" exit="gone"
        className="fixed z-50 inset-y-0 right-0 w-full lg:w-[min(1040px,calc(100vw-260px))] bg-paper shadow-[-30px_0_60px_-30px_rgb(40_30_15/0.35)] flex flex-col">
        <header className="px-5 lg:px-6 pt-4 pb-3 border-b border-line">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex items-center gap-3.5">
              <ContactAvatar contactId={d.contact.id} hasAvatar={!!d.contact.avatarPath} name={name} size={52} />
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="font-serif text-[28px] leading-tight font-light truncate">{name}</h2>
                  {d.contact.isClient && <Badge tone="ok">Cliente</Badge>}
                </div>
                <p className="text-sm text-graphite mt-0.5">{formatPhoneClient(d.contact.phoneE164)} · {d.sourceLabel}{d.channelName ? ` · ${d.channelName}` : ""}</p>
              </div>
            </div>
            <button onClick={close} className="size-9 pointer-coarse:size-11 grid place-items-center rounded-[var(--radius-control)] text-muted hover:bg-paper-2 hover:text-ink" aria-label="Fechar"><IconClose /></button>
          </div>
          <WaitPill since={awaitingSince} sla={d.stage.slaMinutes} hidden={answered} />
          <div className="flex items-center gap-2 mt-3 flex-wrap">
            <label className="relative">
              <span className="sr-only">Etapa</span>
              <select aria-label="Etapa" value={d.stage.key} onChange={(e) => moveTo(e.target.value)} className="h-9 pointer-coarse:min-h-11 pl-3 pr-8 rounded-[var(--radius-control)] border border-line-strong bg-paper text-sm font-medium appearance-none cursor-pointer hover:bg-paper-2">
                {d.stages.map((s) => <option key={s.id} value={s.key}>{s.name}</option>)}
              </select>
              <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted text-[10px]">▼</span>
            </label>
            {["lead", "atendimento", "followup"].includes(d.stage.kind) && <button type="button" onClick={() => moveTo("agendado")} className="h-9 pointer-coarse:min-h-11 px-3 rounded-[var(--radius-control)] bg-ink text-paper text-sm font-medium hover:bg-ink-2">Agendar</button>}
            {d.stage.kind === "agendado" && <button type="button" onClick={() => moveTo("fechado")} className="h-9 pointer-coarse:min-h-11 px-3 rounded-[var(--radius-control)] bg-ok text-white text-sm font-medium hover:brightness-110">Fechar venda</button>}
            {!["fechado", "perdido"].includes(d.stage.kind) && <button type="button" onClick={() => moveTo("perdido")} className="h-9 pointer-coarse:min-h-11 px-3 rounded-[var(--radius-control)] text-sm text-alert hover:bg-alert-soft">Perdido</button>}
            <span className="w-px h-6 bg-line mx-1 hidden sm:block" aria-hidden />
            <a href={`tel:${d.contact.phoneE164}`} className="h-9 pointer-coarse:min-h-11 px-3 inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-line-strong text-sm hover:bg-paper-2"><IconPhone size={15} />Ligar</a>
            <a href={wa} target="_blank" rel="noreferrer" className="h-9 pointer-coarse:min-h-11 px-3 inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-line-strong text-sm hover:bg-paper-2"><IconWhatsApp size={15} />WhatsApp</a>
            {d.contact.email && <a href={`mailto:${d.contact.email}`} className="h-9 pointer-coarse:min-h-11 px-3 inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-line-strong text-sm hover:bg-paper-2"><IconMail size={15} />E-mail</a>}
            {d.contact.instagram && <a href={`https://instagram.com/${d.contact.instagram}`} target="_blank" rel="noreferrer" className="h-9 pointer-coarse:min-h-11 px-3 inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-line-strong text-sm hover:bg-paper-2"><IconInstagram size={15} />@{d.contact.instagram}</a>}
            {d.deal.valueCents != null && <Badge tone="ok" className="ml-auto">{money(d.deal.valueCents)}{d.deal.paymentMethod ? ` · ${PAYMENT_LABEL[d.deal.paymentMethod]}` : ""}</Badge>}
          </div>
          <div className="lg:hidden flex gap-1 mt-3 bg-paper-2 rounded-[var(--radius-control)] p-1" role="tablist" aria-label="Partes do lead">
            {(["conversa", "dados", "historico"] as const).map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className="relative flex-1 h-8 pointer-coarse:min-h-11 text-sm rounded-[8px]">
                {tab === t && <motion.span layoutId="lead-tab" transition={SPRING_UI} className="absolute inset-0 bg-paper rounded-[8px] shadow-[var(--shadow-card)]" />}
                <span className="relative">{t === "conversa" ? "Conversa" : t === "dados" ? "Dados" : "Histórico"}</span>
              </button>
            ))}
          </div>
        </header>
        <div className="flex-1 min-h-0 grid lg:grid-cols-[1fr_360px]">
          <section className={`min-h-0 flex-col ${tab === "conversa" ? "flex" : "hidden"} lg:flex`}>
            <Conversation messages={msgs} onReply={onReply} />
            <AnimatePresence>
              {answered && nextId && (
                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="px-3 pt-2">
                  <button type="button" onClick={() => router.push(`/funil?lead=${nextId}`, { scroll: false })}
                    className="w-full h-10 rounded-[var(--radius-control)] bg-gold-soft text-gold-ink text-sm font-semibold inline-flex items-center justify-center gap-2 hover:brightness-[0.98]">
                    Próximo da fila esperando resposta <IconArrowRight size={15} />
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
            <Composer dealId={d.deal.id} firstName={firstName} quickReplies={d.quickReplies} onOptimistic={setOptimistic} onSent={() => setAnswered(true)} replyTo={replyTo} onClearReply={() => setReplyTo(null)} slaSeconds={d.stage.slaMinutes ? d.stage.slaMinutes * 60 : null} />
          </section>
          <section className={`min-h-0 overflow-y-auto scroll-thin border-l border-line px-5 py-4 ${tab === "conversa" ? "hidden" : "block"} lg:block bg-paper-2/40`}>
            <LeadSide d={d} tab={tab} bp="lg" cols="grid-cols-2" />
          </section>
        </div>
      </motion.aside>
      {sheets}
    </>
  );
}

export function LeadSheetPresence({ d, nextId, viewer }: { d: DealDetail | null; nextId?: string | null; viewer: Viewer | null }) {
  // "Trocou de lead sem fechar": havia um lead aberto e agora há outro. Calculado no render (estado, sem efeito) e entregue também a quem está saindo.
  const id = d?.deal.id ?? null;
  const [last, setLast] = useState<{ id: string | null; swap: boolean }>({ id, swap: false });
  if (last.id !== id) setLast({ id, swap: last.id !== null && id !== null });
  const swap = last.id === id ? last.swap : last.id !== null && id !== null;
  return <AnimatePresence custom={swap}>{d && <LeadSheet key={d.deal.id} d={d} nextId={nextId} viewer={viewer} swap={swap} />}</AnimatePresence>;
}
