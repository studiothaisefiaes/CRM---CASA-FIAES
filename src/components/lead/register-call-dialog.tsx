"use client";
import { useId, useState, useTransition } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import { IconPhone } from "@/components/icons";
import { registerCallAction } from "@/app/(app)/conversa/actions";

type Outcome = "atendeu" | "nao_atendeu" | "ocupado";
const OUTCOMES = [{ value: "atendeu", label: "Atendeu" }, { value: "nao_atendeu", label: "Não atendeu" }, { value: "ocupado", label: "Caixa postal/ocupado" }] as { value: Outcome; label: string }[];

/** "Ligar agora" no celular deixa a marca: voltando para a página (mesmo recarregada), o registro abre de novo. Até 2 h. */
const DIALED_TTL = 2 * 60 * 60 * 1000;
export const dialedKey = (dealId: string) => `ligacao:${dealId}`;
export function dialedRecently(dealId: string): boolean {
  try { const t = Number(sessionStorage.getItem(dialedKey(dealId))); return !!t && Date.now() - t < DIALED_TTL; } catch { return false; }
}
const forgetDialed = (dealId: string) => { try { sessionStorage.removeItem(dialedKey(dealId)); } catch { /* sem storage */ } };
/** Navegador de celular: só nele "Ligar agora" (tel:) faz sentido. */
export const isPhoneBrowser = () => typeof navigator !== "undefined" && /Android|iPhone|iPod|Mobile/i.test(navigator.userAgent);

/**
 * "Registrar ligação": a ligação que a Casa fez pelo celular (o WhatsApp não avisa) entra na conversa. Nada vai para a cliente.
 * Atendeu: pede o que foi falado (como "Anotar o que foi falado") e, salvo, oferece Marcar horário. No celular, "Ligar agora" disca antes.
 */
export function RegisterCallDialog({ open, onClose, dealId, name, phone, phoneBrowser, onSaved, onBook }: {
  open: boolean; onClose: () => void; dealId: string; name: string;
  /** Número discável (sem número oculto). Sem ele, não há "Ligar agora". */ phone: string | null;
  /** Força o modo celular (testes); sem isso, detecta pelo navegador. */ phoneBrowser?: boolean;
  onSaved: (r: { answered: boolean }) => void; onBook?: () => void;
}) {
  const id = useId();
  // O diálogo só monta no navegador (abre por toque ou pela volta do "Ligar agora"): dá para olhar o navegador já no início.
  const [mobile] = useState(() => phoneBrowser ?? isPhoneBrowser());
  const [dialed, setDialed] = useState(() => dialedRecently(dealId));
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [subject, setSubject] = useState("");
  const [note, setNote] = useState("");
  const [minutes, setMinutes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const answered = outcome === "atendeu";
  const ready = !!outcome && (!answered || !!note.trim());
  /** Por que o Salvar está cinza (P16): a frase fica embaixo, ligada ao botão. */
  const missing = !outcome ? "Para salvar, escolha o resultado da ligação." : answered && !note.trim() ? "Para salvar, escreva o que foi falado." : null;
  const close = () => { forgetDialed(dealId); onClose(); };

  const submit = () => {
    if (!ready || !outcome) return;
    const min = minutes.trim() ? Number(minutes) : null;
    if (min !== null && (!Number.isInteger(min) || min < 1)) { setError("Duração em minutos inteiros (ou deixe em branco)."); return; }
    setError(null);
    start(async () => {
      const r = await registerCallAction({ dealId, outcome, durationMin: answered ? min : null, subject: answered ? subject.trim() || null : null, note: answered ? note.trim() : null });
      if (!r.ok) { setError(r.error); return; }
      forgetDialed(dealId);
      onSaved({ answered });
      if (answered) setSaved(true); else onClose();
    });
  };

  if (saved) {
    return (
      <Dialog open={open} onClose={onClose} title="Ligação registrada" width={420}
        description={`A conversa com ${name} mostra a ligação e o que foi falado.`}
        footer={<><Button variant="ghost" onClick={onClose}>Pronto</Button>{onBook && <Button onClick={onBook}>Marcar horário</Button>}</>} />
    );
  }
  return (
    <Dialog open={open} onClose={close} title="Registrar ligação" width={440}
      description={<>Ligação que a Casa fez para {name} pelo celular. Não envia nada para a cliente.</>}
      footer={<><Button variant="ghost" onClick={close}>Cancelar</Button><Button onClick={submit} disabled={!ready} loading={pending} aria-label="Salvar ligação" aria-describedby={missing ? `${id}-falta` : undefined}>Salvar</Button></>}>
      <div className="flex flex-col gap-3">
        {mobile && phone && (
          <a href={`tel:${phone}`} onClick={() => { try { sessionStorage.setItem(dialedKey(dealId), String(Date.now())); } catch { /* sem storage */ } setDialed(true); }}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-[var(--radius-control)] bg-ink px-4 text-sm font-semibold text-paper">
            <IconPhone size={16} aria-hidden />Ligar agora
          </a>
        )}
        {dialed && <p className="text-sm text-graphite">Quando desligar, conte como foi:</p>}
        <div className="flex flex-col gap-1.5">
          <span id={`${id}-r`} className="text-xs font-medium text-graphite">Resultado</span>
          <Segmented labelledBy={`${id}-r`} options={OUTCOMES} value={outcome} onChange={(v) => { setOutcome(v); setError(null); }} />
        </div>
        {answered && (
          <>
            <label htmlFor={`${id}-a`} className="text-xs font-medium text-graphite">Assunto (opcional)</label>
            <Input id={`${id}-a`} value={subject} maxLength={120} placeholder="ex.: Agendamento" onChange={(e) => setSubject(e.target.value)} className="h-9 -mt-2" />
            <label htmlFor={`${id}-o`} className="text-xs font-medium text-graphite">O que foi falado</label>
            <Textarea id={`${id}-o`} value={note} maxLength={2000} rows={3} placeholder="ex.: marcou escova sábado 10h com a Ana" onChange={(e) => setNote(e.target.value)} className="min-h-20 -mt-2" />
            <label htmlFor={`${id}-d`} className="text-xs font-medium text-graphite">Duração em minutos (opcional)</label>
            <Input id={`${id}-d`} type="number" inputMode="numeric" min={1} max={600} value={minutes} onChange={(e) => setMinutes(e.target.value)} className="h-9 w-28 -mt-2" />
            <p className="text-xs text-muted">O que foi falado fica como nota interna: a cliente não vê.</p>
          </>
        )}
        {missing && <p id={`${id}-falta`} className="text-sm text-graphite">{missing}</p>}
        {error && <p role="alert" className="text-sm text-alert">{error}</p>}
      </div>
    </Dialog>
  );
}
