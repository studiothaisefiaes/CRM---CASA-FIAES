"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { saveOnlineBookingAction } from "@/app/(app)/config/agendamento-online/actions";
import type { OnlineBooking } from "@/server/domain/client-link/settings";
import { cn } from "@/lib/cn";
import { IconCheck } from "@/components/icons";

type Opt = { id: string; label: string; note?: string };

function Picker({ title, options, value, onChange }: { title: string; options: Opt[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1 text-sm font-medium text-graphite">{title}</legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const on = value.includes(o.id);
          return (
            <button key={o.id} type="button" aria-pressed={on} onClick={() => onChange(on ? value.filter((x) => x !== o.id) : [...value, o.id])}
              className={cn("min-h-11 rounded-full border px-3 text-sm lg:min-h-8", on ? "border-ink bg-ink text-paper" : "border-line-strong text-graphite")}>
              {o.label}{o.note ? <span className="opacity-70"> · {o.note}</span> : null}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

/**
 * Agendamento online: nasce DESLIGADO. Ligado, abre a página /agendar para qualquer pessoa; quem confirma é a recepção.
 * 18/10 (QA r58, I-5): mostra o link completo (no endereço da cliente) com Copiar, e não liga sem um serviço que apareça no site.
 */
export function OnlineBookingSettings({ value, services, pros, agendaMode, link }: { value: OnlineBooking; services: { id: string; label: string; durationMin: number | null }[]; pros: { id: string; name: string }[]; agendaMode: string; link: string }) {
  const [v, setV] = useState(value);
  const [confirm, setConfirm] = useState(false);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();
  const toast = useToast();
  const bookable = services.filter((s) => s.durationMin && v.servicos.includes(s.id));
  const whyNot = (next: OnlineBooking) => (!next.enabled ? null : !next.servicos.length ? "Escolha ao menos um serviço." : !bookable.length ? "Escolha ao menos um serviço com duração." : null);
  const save = (next: OnlineBooking) => {
    const why = whyNot(next);
    setBlocked(why);
    if (why) { setConfirm(false); return; }
    start(async () => {
      const r = await saveOnlineBookingAction(next);
      if (r.ok) { setV(next); setConfirm(false); toast("Salvo"); } else toast(r.error, "error");
    });
  };
  const turnOn = () => { const why = whyNot({ ...v, enabled: true }); setBlocked(why); if (!why) setConfirm(true); };
  const copy = async () => {
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { toast("Não foi possível copiar. Selecione o link e copie à mão.", "error"); }
  };
  return (
    <section className="rounded-[var(--radius-card)] border border-line bg-paper p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Agendamento online</h2>
          <p className="mt-1 text-sm text-graphite">A cliente pede o horário pelo link abaixo; o horário fica guardado até a recepção confirmar ou recusar. Nada é enviado no WhatsApp.</p>
          {agendaMode === "consulta" && <p role="note" className="mt-2 rounded-[var(--radius-control)] bg-gold-soft px-3 py-2 text-sm">Com a agenda em &quot;consulta&quot;, a página fica fechada mesmo ligada. Mude em Configurações › Ligação com o Avec.</p>}
        </div>
        <Switch checked={v.enabled} disabled={pending} label="Agendamento online" onChange={(on) => (on ? turnOn() : save({ ...v, enabled: false }))} />
      </div>
      {blocked && <p role="alert" className="mt-3 rounded-[var(--radius-control)] bg-alert-soft px-3 py-2 text-sm text-alert">{blocked}</p>}
      <div className="mt-4 flex flex-col gap-2">
        <Input readOnly value={link} aria-label="Link do agendamento online" onFocus={(e) => e.currentTarget.select()} className="font-mono" />
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" className="pointer-coarse:min-h-11" onClick={copy}>{copied ? <><IconCheck size={14} />Link copiado</> : "Copiar link"}</Button>
          <span className="text-sm text-graphite">{v.enabled ? "Aberto: quem tiver o link já pode pedir horário." : "Fechado: o link só abre depois de ligar."}</span>
        </div>
      </div>
      <form className="mt-4 flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); save(v); }}>
        <div className="flex flex-wrap gap-3">
          <Field label="Antecedência mínima (minutos)" htmlFor="ao-ant"><Input id="ao-ant" type="number" min={0} max={1440} className="w-32" value={v.antecedenciaMin} onChange={(e) => setV({ ...v, antecedenciaMin: Number(e.target.value) })} /></Field>
          <Field label="Até quantos dias à frente" htmlFor="ao-dias"><Input id="ao-dias" type="number" min={1} max={90} className="w-32" value={v.diasAFrente} onChange={(e) => setV({ ...v, diasAFrente: Number(e.target.value) })} /></Field>
        </div>
        <Picker title="Serviços no site (sem duração não aparecem)" value={v.servicos} onChange={(servicos) => { setV({ ...v, servicos }); setBlocked(null); }}
          options={services.map((s) => ({ id: s.id, label: s.label, note: s.durationMin ? undefined : "sem duração" }))} />
        <Picker title="Profissionais no site" value={v.profissionais} onChange={(profissionais) => setV({ ...v, profissionais })} options={pros.map((p) => ({ id: p.id, label: p.name }))} />
        <Button type="submit" variant="secondary" loading={pending} className="self-start">Salvar</Button>
      </form>
      <Dialog open={confirm} onClose={() => setConfirm(false)} title="Abrir o agendamento online?"
        description="O link fica aberto para qualquer pessoa. Os pedidos guardam o horário até a recepção responder."
        footer={<><Button variant="ghost" onClick={() => setConfirm(false)}>Cancelar</Button><Button loading={pending} onClick={() => save({ ...v, enabled: true })}>Ligar</Button></>} />
    </section>
  );
}
