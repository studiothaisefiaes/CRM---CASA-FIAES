"use client";
import { useId, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Select, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { findFreeSlotsAction } from "@/app/(app)/agenda/actions";
import type { NextFree } from "@/server/domain/agenda/availability";
import { hhmm } from "@/lib/free-slots";
import { optionsText, slotDayLabel } from "@/lib/slot-text";
import { paletteHex } from "@/lib/palette";
import { cn } from "@/lib/cn";

type Service = { id: string; label: string };
type Pro = { id: string; name: string; serviceIds: string[] };
const keyOf = (proId: string, day: string, start: number) => `${proId}|${day}|${start}`;

/**
 * Procurar horário: escolhe o serviço (e, se quiser, a profissional) e vê os 3 próximos horários livres de cada profissional que faz.
 * Os horários viram botões que entram e saem do texto; de saída, os 3 mais cedo. "Copiar opções" põe o texto na área de transferência
 * para colar na conversa. Não marca nada.
 */
export function SlotFinder({ open, onClose, services, pros }: { open: boolean; onClose: () => void; services: Service[]; pros: Pro[] }) {
  return (
    <Sheet open={open} onClose={onClose} title="Procurar horário">
      {open && <Finder services={services} pros={pros} />}
    </Sheet>
  );
}

function Finder({ services, pros }: { services: Service[]; pros: Pro[] }) {
  const id = useId();
  const toast = useToast();
  const [serviceId, setServiceId] = useState("");
  const [proId, setProId] = useState("");
  const [result, setResult] = useState<NextFree | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [manual, setManual] = useState<string | null>(null);
  const manualRef = useRef<HTMLTextAreaElement>(null);
  const [pending, start] = useTransition();
  const doers = serviceId ? pros.filter((p) => p.serviceIds.includes(serviceId)) : pros;

  const search = () => start(async () => {
    setError(null); setManual(null);
    const r = await findFreeSlotsAction({ serviceId, professionalId: proId || null });
    if (!r.ok || !r.data) { setResult(null); setError(r.ok ? "Não deu certo. Tente de novo." : r.error); return; }
    setResult(r.data);
    if (r.data.ok) {
      const all = r.data.pros.flatMap((p) => p.slots.map((s) => ({ key: keyOf(p.id, s.day, s.start), day: s.day, start: s.start })))
        .sort((a, b) => a.day.localeCompare(b.day) || a.start - b.start);
      setPicked(new Set(all.slice(0, 3).map((x) => x.key)));
    }
  });
  const options = result?.ok
    ? result.pros.flatMap((p) => p.slots.filter((s) => picked.has(keyOf(p.id, s.day, s.start))).map((s) => ({ day: s.day, start: s.start, proName: p.name })))
    : [];
  const text = optionsText(options);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); toast("Opções copiadas: cole na conversa"); }
    catch { setManual(text); toast("Não deu para copiar sozinho: selecione o texto e copie", "info"); setTimeout(() => manualRef.current?.select(), 50); }
  };
  const toggle = (key: string) => setPicked((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-servico`} className="text-sm font-medium text-graphite">Serviço</label>
        <Select id={`${id}-servico`} value={serviceId} onChange={(e) => { setServiceId(e.target.value); setProId(""); setResult(null); }}>
          <option value="">Escolha o serviço</option>
          {services.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-pro`} className="text-sm font-medium text-graphite">Profissional</label>
        <Select id={`${id}-pro`} value={proId} onChange={(e) => setProId(e.target.value)}>
          <option value="">Qualquer uma que faça</option>
          {doers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
      </div>
      <div className="flex justify-end"><Button loading={pending} disabled={!serviceId} onClick={search}>Procurar</Button></div>
      {error && <p role="alert" className="text-sm text-alert">{error}</p>}
      {result && !result.ok && (
        <div role="status" className="flex flex-col items-start gap-2 rounded-[var(--radius-control)] border border-gold/40 bg-gold-soft/60 px-4 py-3 text-sm text-gold-ink">
          {result.reason === "sem_duracao" ? (
            <>
              <p>{`${result.service.label} não tem duração cadastrada. Preencha em Configurações › Serviços para ver horários livres.`}</p>
              <Link href={`/servicos?servico=${result.service.id}`} className="font-medium underline underline-offset-4">Preencher a duração</Link>
            </>
          ) : (
            <>
              <p>{result.professionalName
                ? `${result.professionalName} não está marcada para fazer ${result.service.label}. Marque em Configurações › Profissionais.`
                : `Ninguém está marcado para fazer ${result.service.label}. Marque em Configurações › Profissionais.`}</p>
              <Link href="/config/profissionais?aba=matriz" className="font-medium underline underline-offset-4">Marcar quem faz</Link>
            </>
          )}
        </div>
      )}
      {result?.ok && (
        <>
          <ul className="flex flex-col gap-3">
            {result.pros.map((p) => {
              const hex = paletteHex(p.color);
              const warnings = [...new Set(p.slots.flatMap((s) => s.warnings))];
              return (
                <li key={p.id} className="rounded-[var(--radius-control)] border border-line px-3 py-2.5">
                  <p className="flex items-center gap-2 text-sm font-semibold">
                    <span aria-hidden className={cn("size-2.5 rounded-full", !hex && "border border-line-strong")} style={hex ? { background: hex } : undefined} />{p.name}
                  </p>
                  {p.slots.length ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {p.slots.map((s) => {
                        const key = keyOf(p.id, s.day, s.start), on = picked.has(key);
                        return (
                          <button key={key} type="button" aria-pressed={on} aria-label={`${slotDayLabel(s.day)} · ${hhmm(s.start)} com ${p.name}`} onClick={() => toggle(key)}
                            className={cn("min-h-11 rounded-full border px-3 text-sm tabular transition-colors lg:min-h-8", on ? "border-ink bg-ink text-paper" : "border-line-strong text-graphite hover:bg-paper-2")}>
                            {slotDayLabel(s.day)} · {hhmm(s.start)}
                          </button>
                        );
                      })}
                    </div>
                  ) : <p className="mt-1 text-sm text-muted">Sem horário livre nos próximos 14 dias.</p>}
                  {warnings.map((w) => <p key={w} className="mt-2 text-sm text-gold-ink">{w}</p>)}
                </li>
              );
            })}
          </ul>
          <div className="flex flex-col gap-2 border-t border-line pt-4">
            <p className="text-sm text-graphite">{text || "Toque nos horários que quer oferecer."}</p>
            <div className="flex justify-end"><Button variant="gold" disabled={!text} onClick={copy}>Copiar opções</Button></div>
            {manual && <Textarea ref={manualRef} readOnly value={manual} aria-label="Texto das opções" rows={3} />}
          </div>
        </>
      )}
    </div>
  );
}
