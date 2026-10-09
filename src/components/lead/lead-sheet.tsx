"use client";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import type { DealDetail } from "@/server/queries/deal";
import { Conversation, type Msg } from "./conversation";
import { Composer } from "./composer";
import { AutoField } from "./fields";
import { StageDialogs, type PendingMove } from "@/components/pipeline/stage-dialogs";
import { moveDealAction } from "@/app/(app)/funil/actions";
import { useToast } from "@/components/ui/toast";
import { IconClose, IconPhone, IconMail, IconInstagram, IconWhatsApp, IconCake } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { formatPhoneClient } from "@/lib/phone-client";
import { relTime, money, PAYMENT_LABEL } from "@/lib/format";
import { SPRING, EASE } from "@/lib/motion";

const pad = (n: number) => String(n).padStart(2, "0");
const toLocal = (d: Date | string | null) => { if (!d) return ""; const x = new Date(d); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}T${pad(x.getHours())}:${pad(x.getMinutes())}`; };
const toDate = (d: Date | string | null) => (d ? toLocal(d).slice(0, 10) : "");
const centsToInput = (c: number | null) => (c == null ? "" : (c / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 }));

const EVENT_TEXT = (e: DealDetail["events"][number]): string => {
  const p = e.payload as Record<string, unknown>;
  switch (e.type) {
    case "lead_criado": return `Lead criado${p.origin ? ` (${p.origin})` : ""}`;
    case "etapa_alterada": return `Movido para ${String(p.para).replace("followup_", "Follow-up ").replace(/^\w/, (c) => c.toUpperCase())}${String(p.motivo ?? "").startsWith("automacao") ? " (automático)" : p.motivo === "respondido" ? " (respondido)" : p.motivo === "cliente_respondeu" ? " (cliente respondeu)" : ""}`;
    case "resposta": { const s = Number(p.waitedSeconds ?? 0); return `Respondido em ${s < 60 ? `${s}s` : `${Math.round(s / 60)} min`}${p.fromPhone ? " pelo celular" : ""}`; }
    case "campo_alterado": return `Alterou ${(p.campos as string[] | undefined)?.join(", ") ?? "dados"}`;
    case "responsavel_alterado": return "Trocou o responsável";
    case "alerta": return String(p.mensagem ?? "Alerta");
    case "mensagem_recebida": return "Mensagem recebida";
    case "mensagem_enviada": return p.fromPhone ? "Mensagem enviada pelo celular" : "Mensagem enviada";
    default: return e.type;
  }
};

export function LeadSheet({ d }: { d: DealDetail }) {
  const router = useRouter();
  const sp = useSearchParams();
  const toast = useToast();
  const [, start] = useTransition();
  const [tab, setTab] = useState<"conversa" | "dados" | "historico">("conversa");
  const [optimistic, setOptimistic] = useState<string | null>(null);
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null);

  const close = () => { const p = new URLSearchParams(sp.toString()); p.delete("lead"); router.push(`/funil${p.size ? `?${p}` : ""}`, { scroll: false }); };
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape" && !document.querySelector("[role=dialog][aria-modal]")) close(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); });

  const name = d.contact.name?.trim() || formatPhoneClient(d.contact.phoneE164);
  const firstName = d.contact.name?.trim().split(/\s+/)[0] ?? "";
  const msgs: Msg[] = useMemo(() => {
    const base = d.messages.map((m) => ({ id: m.id, direction: m.direction, kind: m.kind, body: m.body, status: m.status, createdAt: new Date(m.createdAt).toISOString(), sender: m.sender, fromPhone: m.fromPhone }));
    return optimistic ? [...base, { id: "optimistic", direction: "out" as const, kind: "text", body: optimistic, status: "pending", createdAt: new Date().toISOString(), sender: null, fromPhone: false }] : base;
  }, [d.messages, optimistic]);

  const moveTo = (key: string) => {
    const to = d.stages.find((s) => s.key === key); if (!to || to.id === d.deal.stageId) return;
    const m: PendingMove = { cardId: d.deal.id, name, to: { id: to.id, key: to.key, name: to.name, kind: to.kind } };
    if (["agendado", "perdido", "fechado"].includes(to.kind)) setPendingMove(m);
    else start(async () => { const r = await moveDealAction(d.deal.id, key); toast(r.ok ? `Movido para ${to.name}` : r.error, r.ok ? "ok" : "error"); });
  };
  const wa = `https://wa.me/${d.contact.phoneE164.replace(/\D/g, "")}`;
  const birthday = d.contact.birthDay && d.contact.birthMonth ? `${pad(d.contact.birthDay)}/${pad(d.contact.birthMonth)}${d.contact.birthYear ? `/${d.contact.birthYear}` : ""}` : "";

  const details = (
    <div className="flex flex-col gap-3.5">
      {d.contact.isClient && (
        <div className="rounded-[12px] bg-ok-soft text-ok px-3 py-2.5 text-[13px]">
          <b>Já é cliente</b>{d.contact.clientSince ? ` desde ${new Date(d.contact.clientSince).getFullYear()}` : ""}{d.contact.lastServiceAt ? ` · último atendimento ${new Date(d.contact.lastServiceAt).toLocaleDateString("pt-BR")}` : ""}
        </div>
      )}
      <AutoField dealId={d.deal.id} name="name" label="Nome" value={d.contact.name ?? ""} placeholder="Nome da cliente" />
      <div className="grid grid-cols-2 gap-x-4 gap-y-3.5">
        <AutoField dealId={d.deal.id} name="email" label="E-mail" kind="email" value={d.contact.email ?? ""} placeholder="nome@email.com" />
        <AutoField dealId={d.deal.id} name="instagram" label="Instagram" value={d.contact.instagram ? `@${d.contact.instagram}` : ""} placeholder="@perfil" />
        <AutoField dealId={d.deal.id} name="birthday" label="Aniversário" kind="birthday" value={birthday} placeholder="14/11" icon={<IconCake size={12} />} />
        <AutoField dealId={d.deal.id} name="origin" label="Origem" kind="select" value={d.deal.origin} options={[...new Set([...d.origins.map((o) => o.label), d.deal.origin])].map((o) => ({ value: o, label: o }))} />
        <AutoField dealId={d.deal.id} name="objectionId" label="Objeção" kind="select" value={d.deal.objectionId ?? ""} options={d.objections.map((o) => ({ value: o.id, label: o.label }))} />
        <AutoField dealId={d.deal.id} name="ownerId" label="Responsável" kind="select" value={d.deal.ownerId ?? ""} options={d.people.map((p) => ({ value: p.id, label: p.name }))} />
      </div>
      <AutoField dealId={d.deal.id} name="observations" label="Observações" kind="textarea" value={d.deal.observations ?? ""} placeholder="Anotações livres sobre a cliente…" />
      <div className="h-px bg-line my-1" />
      <div className="grid grid-cols-2 gap-x-4 gap-y-3.5">
        <AutoField dealId={d.deal.id} name="scheduledAt" label="Agendamento" kind="datetime" value={toLocal(d.deal.scheduledAt)} />
        <AutoField dealId={d.deal.id} name="valueCents" label="Valor (R$)" kind="money" value={centsToInput(d.deal.valueCents)} placeholder="0,00" />
        <AutoField dealId={d.deal.id} name="paymentMethod" label="Forma de pagamento" kind="select" value={d.deal.paymentMethod ?? ""} options={Object.entries(PAYMENT_LABEL).map(([value, label]) => ({ value, label }))} />
        <AutoField dealId={d.deal.id} name="chargeAt" label="Data de cobrança" kind="datetime" value={toLocal(d.deal.chargeAt)} />
        <AutoField dealId={d.deal.id} name="recontactAt" label="Recontato em" kind="date" value={toDate(d.deal.recontactAt)} />
        {d.stage.kind === "perdido" && <AutoField dealId={d.deal.id} name="lostReasonId" label="Motivo da perda" kind="select" value={d.deal.lostReasonId ?? ""} options={d.lostReasons.map((o) => ({ value: o.id, label: o.label }))} />}
      </div>
      {d.history.length > 0 && (
        <div className="mt-2">
          <p className="text-[11.5px] font-medium text-muted mb-1.5">Atendimentos anteriores</p>
          <ul className="text-[13px] flex flex-col gap-1">{d.history.map((h) => <li key={h.id} className="flex justify-between"><span>{h.stage}</span><span className="text-muted">{new Date(h.createdAt).toLocaleDateString("pt-BR")}{h.valueCents ? ` · ${money(h.valueCents)}` : ""}</span></li>)}</ul>
        </div>
      )}
    </div>
  );

  const timeline = (
    <ol className="relative flex flex-col gap-3 pl-4 before:absolute before:left-[3px] before:top-1 before:bottom-1 before:w-px before:bg-line">
      {d.events.map((e, i) => (
        <motion.li key={e.id} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: Math.min(i * 0.025, 0.4), duration: 0.3, ease: EASE }} className="relative">
          <span className={`absolute -left-4 top-1.5 size-[7px] rounded-full ${e.type === "alerta" ? "bg-alert" : e.type === "etapa_alterada" ? "bg-gold" : "bg-line-strong"}`} />
          <p className="text-[13px] leading-snug">{EVENT_TEXT(e)}</p>
          <p className="text-[11.5px] text-muted">{relTime(e.createdAt)}{e.user ? ` · ${e.user.split(" ")[0]}` : ""}</p>
        </motion.li>
      ))}
    </ol>
  );

  return (
    <>
      <motion.div className="fixed inset-0 z-40 bg-ink/25 lg:bg-ink/15" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={close} aria-hidden />
      <motion.aside role="dialog" aria-label={`Lead ${name}`} initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }} transition={{ ...SPRING, stiffness: 380, damping: 38 }}
        className="fixed z-50 inset-y-0 right-0 w-full lg:w-[min(1040px,calc(100vw-260px))] bg-paper shadow-[-30px_0_60px_-30px_rgb(40_30_15/0.35)] flex flex-col">
        <header className="px-5 lg:px-6 pt-4 pb-3 border-b border-line">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="font-serif text-[28px] leading-tight font-light truncate">{name}</h2>
                {d.contact.isClient && <Badge tone="ok">Cliente</Badge>}
              </div>
              <p className="text-[13px] text-graphite mt-0.5">{formatPhoneClient(d.contact.phoneE164)} · {d.deal.origin}{d.channelName ? ` · ${d.channelName}` : ""}</p>
            </div>
            <button onClick={close} className="size-9 grid place-items-center rounded-[10px] text-muted hover:bg-paper-2 hover:text-ink" aria-label="Fechar"><IconClose /></button>
          </div>
          <div className="flex flex-wrap items-center gap-2 mt-3">
            <label className="relative">
              <span className="sr-only">Etapa</span>
              <select value={d.stage.key} onChange={(e) => moveTo(e.target.value)} className="h-9 pl-3 pr-8 rounded-[10px] bg-ink text-paper text-[13px] font-medium appearance-none cursor-pointer">
                {d.stages.map((s) => <option key={s.id} value={s.key}>{s.name}</option>)}
              </select>
              <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-paper/70 text-[10px]">▼</span>
            </label>
            <a href={`tel:${d.contact.phoneE164}`} className="h-9 px-3 inline-flex items-center gap-1.5 rounded-[10px] border border-line-strong text-[13px] hover:bg-paper-2"><IconPhone size={15} />Ligar</a>
            <a href={wa} target="_blank" rel="noreferrer" className="h-9 px-3 inline-flex items-center gap-1.5 rounded-[10px] border border-line-strong text-[13px] hover:bg-paper-2"><IconWhatsApp size={15} />WhatsApp</a>
            {d.contact.email && <a href={`mailto:${d.contact.email}`} className="h-9 px-3 inline-flex items-center gap-1.5 rounded-[10px] border border-line-strong text-[13px] hover:bg-paper-2"><IconMail size={15} />E-mail</a>}
            {d.contact.instagram && <a href={`https://instagram.com/${d.contact.instagram}`} target="_blank" rel="noreferrer" className="h-9 px-3 inline-flex items-center gap-1.5 rounded-[10px] border border-line-strong text-[13px] hover:bg-paper-2"><IconInstagram size={15} />@{d.contact.instagram}</a>}
            {d.deal.valueCents != null && <Badge tone="ok" className="ml-auto">{money(d.deal.valueCents)}{d.deal.paymentMethod ? ` · ${PAYMENT_LABEL[d.deal.paymentMethod]}` : ""}</Badge>}
          </div>
          <div className="lg:hidden flex gap-1 mt-3 bg-paper-2 rounded-[10px] p-1" role="tablist">
            {(["conversa", "dados", "historico"] as const).map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className="relative flex-1 h-8 text-[13px] rounded-[8px]">
                {tab === t && <motion.span layoutId="lead-tab" transition={SPRING} className="absolute inset-0 bg-paper rounded-[8px] shadow-[var(--shadow-card)]" />}
                <span className="relative">{t === "conversa" ? "Conversa" : t === "dados" ? "Dados" : "Histórico"}</span>
              </button>
            ))}
          </div>
        </header>
        <div className="flex-1 min-h-0 grid lg:grid-cols-[1fr_360px]">
          <section className={`min-h-0 flex-col ${tab === "conversa" ? "flex" : "hidden"} lg:flex`}>
            <Conversation messages={msgs} />
            <Composer dealId={d.deal.id} firstName={firstName} quickReplies={d.quickReplies} onOptimistic={setOptimistic} />
          </section>
          <section className={`min-h-0 overflow-y-auto scroll-thin border-l border-line px-5 py-4 ${tab === "conversa" ? "hidden" : "block"} lg:block bg-paper-2/40`}>
            <div className={`${tab === "historico" ? "hidden" : ""} lg:block`}>{details}</div>
            <div className={`${tab === "dados" ? "hidden" : ""} lg:block lg:mt-6`}>
              <p className="text-[11.5px] font-medium text-muted mb-3 hidden lg:block">Histórico</p>{timeline}
            </div>
          </section>
        </div>
      </motion.aside>
      <StageDialogs pending={pendingMove} lostReasons={d.lostReasons.map((l) => ({ id: l.id, label: l.label }))} onCancel={() => setPendingMove(null)}
        onConfirm={(extra) => { const m = pendingMove!; setPendingMove(null); start(async () => { const r = await moveDealAction(m.cardId, m.to.key, extra); toast(r.ok ? `Movido para ${m.to.name}` : r.error, r.ok ? "ok" : "error"); }); }} />
    </>
  );
}

export function LeadSheetPresence({ d }: { d: DealDetail | null }) {
  return <AnimatePresence>{d && <LeadSheet key={d.deal.id} d={d} />}</AnimatePresence>;
}
