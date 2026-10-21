"use client";
import { StepDots } from "@/components/ui/step-dots";
import { useId, useState, useTransition, type ChangeEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { SendConfirmDialog } from "@/components/config/send-confirm";
import { saveSummaryWhatsappAction } from "@/app/(app)/config/resumo-whatsapp/actions";
import { renderSummaryTitulo, SUMMARY_TITULO_SUGERIDO, SUMMARY_WHATSAPP_LIMITS, type SummaryDestino, type SummaryWhatsapp } from "@/lib/summary-whatsapp";

const CARD = "rounded-[var(--radius-card)] border border-line bg-paper p-5";
const STEPS = ["Quem recebe o resumo do dia no WhatsApp?", "A que horas o resumo sai?", "Para quantas pessoas, no máximo?", "Como a mensagem começa?"] as const;
export type SummaryPerson = { id: string; name: string; gestao: boolean };

/**
 * Resumo do dia no WhatsApp da gestão (Fase B, item 16): uma pergunta por passo. Nasce DESLIGADO; ligar pede a confirmação de envio real.
 * O resumo vai para a conversa de Equipe do número de cada pessoa (nunca para cliente).
 */
export function SummaryWhatsappSettings({ initial, people }: { initial: SummaryWhatsapp; people: SummaryPerson[] }) {
  const [v, setV] = useState(initial);
  const [saved, setSaved] = useState(initial.enabled);
  const [step, setStep] = useState(0);
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();
  const toast = useToast();
  const titleId = useId();
  const shown = v.destino === "gestao" ? people.filter((p) => p.gestao) : people;
  const phoneOf = (id: string) => v.numeros.find((n) => n.userId === id)?.phone ?? "";
  const setPhone = (id: string, phone: string) => setV({ ...v, numeros: [...v.numeros.filter((n) => n.userId !== id), ...(phone ? [{ userId: id, phone }] : [])] });
  const num = (k: "hora" | "maxPessoas") => ({
    type: "number" as const, inputMode: "numeric" as const, min: SUMMARY_WHATSAPP_LIMITS[k].min, max: SUMMARY_WHATSAPP_LIMITS[k].max, className: "w-32",
    value: Number.isFinite(v[k]) ? String(v[k]) : "", onChange: (e: ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.value === "" ? NaN : Number(e.target.value) }),
  });
  const save = (raw: SummaryWhatsapp, confirmouEnvio: boolean) => start(async () => {
    // Só as pessoas que a tela mostra: quem saiu da lista (desativada, sem permissão) não fica preso na configuração.
    const next = { ...raw, numeros: raw.numeros.filter((n) => people.some((p) => p.id === n.userId)) };
    const r = await saveSummaryWhatsappAction(next, confirmouEnvio);
    setConfirm(false);
    if (!r.ok) { toast(r.error, "error"); return; }
    setV(next); setSaved(next.enabled);
    if (r.descartadas) toast(`${r.descartadas === 1 ? "Uma pessoa saiu" : `${r.descartadas} pessoas saíram`} da lista (desativada ou sem permissão).`, "ok");
    else toast(next.enabled !== saved ? (next.enabled ? "Resumo no WhatsApp ligado" : "Resumo no WhatsApp desligado") : "Salvo", "ok");
  });
  const hora = `${String(v.hora).padStart(2, "0")}h`;

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-4">
      <div className={CARD}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id={titleId} className="sr-only">Resumo do dia no WhatsApp</h2>{/* r68 #8: o título da página (h1) já diz isto; o h2 fica só para o leitor de tela */}
            <p className="mt-1 text-sm text-graphite">O mesmo resumo do Hoje chega no WhatsApp de cada pessoa escolhida, às {Number.isFinite(v.hora) ? hora : "…"}, na conversa Equipe do número dela. {v.soDiasAbertos ? "Só nos dias em que a Casa abre (os Dias especiais valem)." : "Todos os dias."} Não vai para nenhuma cliente.</p>
          </div>
          <Switch checked={saved} disabled={pending} label="Resumo do dia no WhatsApp" onChange={(on) => (on ? setConfirm(true) : save({ ...v, enabled: false }, false))} />
        </div>
        <StepDots className="mt-3" current={step + 1} total={STEPS.length} />
      </div>

      <form className={`${CARD} flex flex-col gap-4`} onSubmit={(e) => { e.preventDefault(); save({ ...v, enabled: saved }, false); }}>
        <h3 className="font-display text-lg">{STEPS[step]}</h3>
        {step === 0 && (
          <>
            {([["gestao", "A Gestão"], ["escolhidas", "Só as pessoas que eu escolher"]] as [SummaryDestino, string][]).map(([value, label]) => (
              <label key={value} className="flex min-h-11 items-center gap-2 text-sm">
                <input type="radio" name="destino" className="size-5" checked={v.destino === value} onChange={() => setV({ ...v, destino: value })} />
                {label}
              </label>
            ))}
            <p className="text-sm text-muted">O sistema não guarda o WhatsApp de ninguém: ponha o número de cada pessoa. Sem número, a pessoa fica de fora.</p>
            {shown.map((p) => (
              <Field key={p.id} label={`WhatsApp de ${p.name}`} htmlFor={`rw-${p.id}`}>
                <Input id={`rw-${p.id}`} inputMode="tel" placeholder="(71) 9 8888-0000" value={phoneOf(p.id)} onChange={(e) => setPhone(p.id, e.target.value)} />
                {!phoneOf(p.id).trim() && <span className="text-sm text-muted">Sem número, fica de fora.</span>}
              </Field>
            ))}
          </>
        )}
        {step === 1 && (
          <>
            <Field label="Hora (0 a 23)" htmlFor="rw-hora" hint="Horário de Salvador."><Input id="rw-hora" {...num("hora")} /></Field>
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input type="checkbox" className="size-5" checked={v.soDiasAbertos} onChange={(e) => setV({ ...v, soDiasAbertos: e.target.checked })} />
              Só mandar nos dias em que a Casa abre
            </label>
          </>
        )}
        {step === 2 && <Field label="Máximo de pessoas" htmlFor="rw-max" hint="De 1 a 10. Passou disso, as últimas da lista ficam de fora."><Input id="rw-max" {...num("maxPessoas")} /></Field>}
        {step === 3 && (
          <>
            <Field label="Linha de abertura" htmlFor="rw-titulo" hint="Use {data} para o dia (ex.: terça-feira, 20/10). *texto* sai em negrito no WhatsApp. O resto do resumo é montado sozinho.">
              <Input id="rw-titulo" maxLength={120} value={v.titulo} onChange={(e) => setV({ ...v, titulo: e.target.value })} />
            </Field>
            <Button type="button" variant="ghost" size="sm" className="self-start" aria-label="Usar o texto sugerido" onClick={() => setV({ ...v, titulo: SUMMARY_TITULO_SUGERIDO })}>Usar o texto sugerido</Button>
            <section aria-label="Prévia" className="rounded-[var(--radius-control)] bg-paper-2 p-3 text-sm">{renderSummaryTitulo(v.titulo, "terça-feira, 20/10")}</section>
          </>
        )}
        <div className="flex flex-wrap gap-2">
          {step > 0 && <Button type="button" variant="ghost" onClick={() => setStep(step - 1)}>Voltar</Button>}
          {step < STEPS.length - 1 && <Button type="button" variant="secondary" onClick={() => setStep(step + 1)}>Continuar</Button>}
          <Button type="submit" loading={pending}>Salvar</Button>
        </div>
      </form>
      <SendConfirmDialog open={confirm} onClose={() => setConfirm(false)} pending={pending} onConfirm={() => save({ ...v, enabled: true }, true)}
        what="Todo dia, na hora escolhida, o resumo do dia chega no WhatsApp das pessoas escolhidas. Não vai para clientes." />
    </section>
  );
}
