"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { onlineRequestAction, onlineSlotsAction } from "@/app/agendar/actions";
import type { OnlineOptions } from "@/server/domain/client-link/online";
import { LinkShell } from "@/components/client-link/link-page";
import { cn } from "@/lib/cn";

/** O que a página manda para o navegador: do serviço, só o nome e o preço como a cliente vê (0084: nunca o custo nem os centavos). */
export type WizardOptions = Omit<OnlineOptions, "services"> & { services: { id: string; label: string; priceText: string | null }[] };

/** /agendar: serviço, profissional (ou "Qualquer uma"), dia, horário livre, nome, celular e observação. Quem confirma é a Casa. */
export function BookingWizard({ options, formToken }: { options: WizardOptions; formToken: string }) {
  const [serviceId, setServiceId] = useState("");
  const [pro, setPro] = useState("");
  const [day, setDay] = useState("");
  const [times, setTimes] = useState<string[] | null>(null);
  const [time, setTime] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [isca, setIsca] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const pros = options.professionals.filter((p) => !serviceId || p.serviceIds.includes(serviceId));
  const loadTimes = (s: string, p: string, d: string) => {
    setTime(""); setTimes(null);
    if (!s || !d) return;
    start(async () => { const r = await onlineSlotsAction(s, p || null, d); if (r.ok) setTimes(r.data ?? []); else setError(r.error); });
  };
  const send = () => start(async () => {
    setError(null);
    const r = await onlineRequestAction({ serviceId, professionalId: pro || null, day, time, name, phone, note, honeypot: isca, formToken });
    if (r.ok) setDone(r.data?.message ?? "Pedido enviado!"); else setError(r.error);
  });
  if (done) return <LinkShell><h1 className="font-display text-2xl">Pedido enviado</h1><p role="status">{done}</p></LinkShell>;
  return (
    <LinkShell>
      <h1 className="font-display text-2xl leading-tight">Agendar horário</h1>
      <p className="text-graphite">Escolha o serviço, o dia e o horário. A Casa confirma pelo WhatsApp.</p>
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <Field label="Serviço" htmlFor="ag-servico">
          <Select id="ag-servico" value={serviceId} onChange={(e) => { setServiceId(e.target.value); setPro(""); loadTimes(e.target.value, "", day); }} required>
            <option value="">Escolha</option>
            {options.services.map((s) => <option key={s.id} value={s.id}>{s.priceText ? `${s.label} · ${s.priceText}` : s.label}</option>)}
          </Select>
        </Field>
        <Field label="Profissional" htmlFor="ag-pro">
          <Select id="ag-pro" value={pro} onChange={(e) => { setPro(e.target.value); loadTimes(serviceId, e.target.value, day); }}>
            <option value="">Qualquer uma</option>
            {pros.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>
        <Field label="Dia" htmlFor="ag-dia">
          <Input id="ag-dia" type="date" min={options.firstDay} max={options.lastDay} value={day} onChange={(e) => { setDay(e.target.value); loadTimes(serviceId, pro, e.target.value); }} required />
        </Field>
        {times && (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium text-graphite">Horário</legend>
            {times.length === 0 ? <p className="text-sm text-graphite">Nenhum horário livre nesse dia. Escolha outro dia.</p> : (
              <div className="flex flex-wrap gap-2">
                {times.map((t) => <button key={t} type="button" aria-pressed={time === t} onClick={() => setTime(t)}
                  className={cn("min-h-11 rounded-full border px-4 tabular", time === t ? "border-ink bg-ink text-paper" : "border-line-strong")}>{t}</button>)}
              </div>
            )}
          </fieldset>
        )}
        <Field label="Seu nome" htmlFor="ag-nome"><Input id="ag-nome" value={name} maxLength={80} autoComplete="name" onChange={(e) => setName(e.target.value)} required /></Field>
        <Field label="Celular (WhatsApp)" htmlFor="ag-cel"><Input id="ag-cel" value={phone} maxLength={30} inputMode="tel" autoComplete="tel" onChange={(e) => setPhone(e.target.value)} required /></Field>
        <Field label="Observação (opcional)" htmlFor="ag-obs"><Textarea id="ag-obs" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} /></Field>
        <div aria-hidden className="absolute -left-[10000px] h-px w-px overflow-hidden">
          <label htmlFor="ag-site">Site</label><input id="ag-site" tabIndex={-1} autoComplete="off" value={isca} onChange={(e) => setIsca(e.target.value)} />
        </div>
        {error && <p role="alert" className="rounded-[var(--radius-control)] bg-alert-soft px-3 py-2 text-alert">{error}</p>}
        <Button type="submit" size="lg" loading={pending} disabled={!serviceId || !day || !time}>Pedir horário</Button>
      </form>
    </LinkShell>
  );
}
