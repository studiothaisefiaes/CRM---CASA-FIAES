"use client";
import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { cancelLinkAction, confirmLinkAction, rescheduleLinkAction, type LinkResult } from "@/app/c/[token]/actions";
import type { LinkView } from "@/server/domain/client-link/links";
import { IconCalendar, IconCheck, IconClock, IconWhatsApp } from "@/components/icons";

const CANCEL = [["nao_vou_conseguir", "Não vou conseguir ir"], ["saude", "Problema de saúde"], ["imprevisto", "Imprevisto"], ["outro", "Outro"]] as const;
const BIG_LINK = "inline-flex min-h-12 flex-[1_1_auto] items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-control)] border border-line-strong bg-paper px-3.5 font-medium transition-colors hover:bg-paper-2";
const TALK = "inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-[var(--radius-control)] border border-line-strong bg-paper px-5 text-md font-medium transition-colors hover:bg-paper-2";
const STATE_CHIP: Partial<Record<LinkView["state"], [string, string]>> = {
  agendado: ["Falta confirmar", "bg-gold-soft text-gold-ink"],
  confirmado: ["Confirmado", "bg-ok-soft text-ok"],
  solicitado: ["Aguardando a Casa", "bg-info-soft text-ink-2"],
  cancelado: ["Cancelado", "bg-alert-soft text-alert"],
  aconteceu: ["Atendido", "bg-paper-2 text-graphite"],
};

const IconPin = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" /><circle cx="12" cy="10" r="2.3" />
  </svg>
);

/** A marca no topo: o monograma (mesmo desenho do ícone) e o nome. */
function Brand() {
  return (
    <header className="flex items-center gap-3">
      <span aria-hidden className="flex size-10 flex-col items-center justify-center rounded-[12px] bg-ink text-paper">
        <span className="text-[15px] font-semibold leading-none tracking-[-0.04em]">CF</span>
        <svg width="20" height="6" viewBox="0 0 20 6" className="mt-[3px] text-gold" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M1 6a4.5 4.5 0 0 1 9 0M10 6a4.5 4.5 0 0 1 9 0" /></svg>
      </span>
      <span className="font-display text-[19px] font-semibold tracking-[-0.02em]">Casa <span className="text-gold-ink">Fiaes</span></span>
    </header>
  );
}

/** A casca da página pública: leve, sem menu, feita para o celular. */
export function LinkShell({ children }: { children: ReactNode }) {
  return (
    <main className="ds-congelada mx-auto flex min-h-dvh w-full max-w-[460px] flex-col gap-5 bg-paper px-5 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))]">
      <Brand />
      {children}
      <footer className="mt-auto pt-6 text-center text-xs text-muted">Casa Fiaes · Salvador</footer>
    </main>
  );
}

/** A página do horário: confirmar, pedir para remarcar ou cancelar (com motivo). Depois de agir, diz o que aconteceu e o que vem agora. */
export function LinkPage({ token, view }: { token: string; view: LinkView }) {
  const router = useRouter();
  const [mode, setMode] = useState<"" | "remarcar" | "cancelar">("");
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [wish, setWish] = useState("");
  const [motivo, setMotivo] = useState("");
  const [texto, setTexto] = useState("");
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<LinkResult>) => start(async () => {
    setError(null);
    const r = await fn();
    if (r.ok) { setDone(r.message); setMode(""); } else setError(r.error);
    router.refresh();
  });
  const cancelled = view.state === "cancelado";
  const chip = STATE_CHIP[view.state];
  const talk = view.whatsappUrl
    ? <a href={view.whatsappUrl} target="_blank" rel="noreferrer noopener" className={TALK}><IconWhatsApp size={20} />Falar com a Casa</a>
    : <p className="text-graphite">Fale com a Casa pelo WhatsApp.</p>;
  return (
    <LinkShell>
      <h1 className="font-display text-[30px] font-semibold leading-[1.12] tracking-[-0.025em] text-balance">
        <span className="block text-lg font-normal tracking-normal text-graphite">{view.firstName ? `Oi, ${view.firstName}!` : "Oi!"}</span>{" "}
        Seu horário na Casa Fiaes
      </h1>
      {view.changedNotice && <p role="status" className="rounded-[var(--radius-control)] bg-gold-soft px-4 py-3 text-md text-ink">{view.changedNotice}</p>}

      <section aria-label="Seu horário" className="overflow-hidden rounded-[var(--radius-panel)] border border-line bg-white shadow-[var(--shadow-card)]">
        <div className={`flex items-stretch gap-4 p-4 ${cancelled ? "opacity-60" : ""}`}>
          <div className="flex w-[84px] shrink-0 flex-col items-center justify-center rounded-[14px] bg-ink py-3 text-paper">
            <span className="text-xs font-medium uppercase tracking-[0.12em] text-gold">{view.day.weekday.slice(0, 3)}</span>
            <span className="font-display text-[38px] font-semibold leading-none tracking-[-0.04em]">{view.day.day}</span>
            <span className="text-xs text-paper/75">{view.day.month}</span>
          </div>
          <div className="flex min-w-0 flex-col justify-center">
            <p className={`font-display text-[34px] font-semibold leading-none tracking-[-0.03em] ${cancelled ? "line-through" : ""}`}>{view.startHour}</p>
            <p className="mt-1.5 text-md text-graphite">{view.endHour ? `até ${view.endHour} · ` : ""}{view.day.weekday}</p>
            {chip && <span className={`mt-2.5 inline-flex w-fit items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${chip[1]}`}>{view.state === "confirmado" && <IconCheck size={14} />}{chip[0]}</span>}
          </div>
        </div>
        <ul className="border-t border-dashed border-line-strong px-4 py-3">
          {view.items.map((i, n) => (
            <li key={n} className="flex items-baseline justify-between gap-3 py-1.5">
              <span className={`text-md font-medium ${cancelled ? "text-muted line-through" : ""}`}>{i.service}</span>
              {i.pro && <span className="shrink-0 text-sm text-graphite">com {i.pro}</span>}
            </li>
          ))}
        </ul>
        <p className="sr-only">{view.services}. {view.when}.</p>
        {view.address && !cancelled && (
          <div className="flex flex-col gap-3 border-t border-line bg-paper px-4 py-4">
            <p className="flex items-start gap-2 text-sm text-ink-2"><span className="mt-0.5 text-gold-ink"><IconPin /></span>{view.address}</p>
            <div className="flex flex-wrap gap-2">
              {view.mapsUrl && <a href={view.mapsUrl} target="_blank" rel="noreferrer noopener" className={BIG_LINK}><IconPin />Como chegar</a>}
              <a href={`/c/${token}/agenda.ics`} className={BIG_LINK}><IconCalendar />Salvar na agenda</a>
            </div>
          </div>
        )}
        {!view.address && !cancelled && (
          <div className="border-t border-line bg-paper px-4 py-3"><a href={`/c/${token}/agenda.ics`} className={`${BIG_LINK} w-full`}><IconCalendar />Salvar na agenda</a></div>
        )}
      </section>

      {done && <p role="status" className="rounded-[var(--radius-control)] bg-ok-soft px-4 py-3 text-md text-ok">{done}</p>}
      {error && <p role="alert" className="rounded-[var(--radius-control)] bg-alert-soft px-4 py-3 text-md text-alert">{error}</p>}
      {view.state === "cancelado" && <><p role="status" className="text-lg">Este horário foi cancelado.</p>{talk}</>}
      {view.state === "aconteceu" && <p role="status" className="text-lg">Obrigada pela visita!</p>}
      {view.state === "solicitado" && <p role="status" className="text-lg">Aguardando a Casa confirmar.</p>}
      {view.state === "confirmado" && !done && <p role="status" className="text-lg font-medium text-ok">Você confirmou ✓ Te esperamos!</p>}
      {view.canAct && !mode && (
        <div className="flex flex-col gap-2.5">
          {view.remarcarPedido ? (
            <>
              <p role="status" className="text-lg font-medium">Pedido de remarcar enviado. A Casa vai te chamar no WhatsApp.</p>
              <Button size="lg" variant="ghost" className="h-12 text-md" loading={pending} onClick={() => run(() => confirmLinkAction(token, view.shownStart))}>Mudei de ideia, vou manter o horário</Button>
            </>
          ) : (
            <>
              {view.state === "agendado" && <Button size="lg" className="h-14 text-md" loading={pending} onClick={() => run(() => confirmLinkAction(token, view.shownStart))}><IconCheck size={20} />Confirmar presença</Button>}
              <Button size="lg" variant="secondary" className="h-14 text-md" onClick={() => setMode("remarcar")}><IconClock size={20} />Preciso remarcar</Button>
            </>
          )}
          {view.canCancel ? <Button size="lg" variant="ghost" className="h-14 text-md text-alert hover:bg-alert-soft" onClick={() => setMode("cancelar")}>Cancelar</Button> : talk}
        </div>
      )}
      {mode === "remarcar" && (
        <form className="flex flex-col gap-3 rounded-[var(--radius-panel)] border border-line bg-white p-4" onSubmit={(e) => { e.preventDefault(); run(() => rescheduleLinkAction(token, view.shownStart, wish)); }}>
          <Field label="Qual dia ou horário é melhor para você? (opcional)" htmlFor="link-quando">
            <Textarea id="link-quando" value={wish} maxLength={200} onChange={(e) => setWish(e.target.value)} />
          </Field>
          <div className="grid grid-cols-[auto_1fr] gap-2"><Button type="button" size="lg" variant="ghost" onClick={() => setMode("")}>Voltar</Button><Button type="submit" size="lg" loading={pending}>Pedir para remarcar</Button></div>
        </form>
      )}
      {mode === "cancelar" && (
        <form className="flex flex-col gap-3 rounded-[var(--radius-panel)] border border-line bg-white p-4" onSubmit={(e) => { e.preventDefault(); run(() => cancelLinkAction(token, view.shownStart, motivo, texto)); }}>
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 text-sm font-medium text-graphite">Por que você vai cancelar?</legend>
            {CANCEL.map(([k, l]) => (
              <label key={k} className="flex min-h-11 items-center gap-2"><input type="radio" name="motivo" value={k} checked={motivo === k} onChange={() => setMotivo(k)} className="size-5" />{l}</label>
            ))}
          </fieldset>
          {motivo === "outro" && <Field label="Qual o motivo?" htmlFor="link-motivo"><Input id="link-motivo" value={texto} maxLength={200} onChange={(e) => setTexto(e.target.value)} /></Field>}
          <div className="grid grid-cols-[auto_1fr] gap-2"><Button type="button" size="lg" variant="ghost" onClick={() => setMode("")}>Voltar</Button><Button type="submit" size="lg" variant="danger" loading={pending} disabled={!motivo}>Cancelar horário</Button></div>
        </form>
      )}
      {view.whatsappUrl && !cancelled && !(view.canAct && !view.canCancel && !mode) && (
        <a href={view.whatsappUrl} target="_blank" rel="noreferrer noopener" className="mx-auto inline-flex min-h-11 items-center gap-2 text-sm text-graphite underline-offset-4 hover:underline">
          <IconWhatsApp size={16} />Dúvidas? Fale com a Casa no WhatsApp
        </a>
      )}
    </LinkShell>
  );
}
