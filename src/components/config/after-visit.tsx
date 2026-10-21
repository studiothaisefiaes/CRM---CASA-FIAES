"use client";
import { StepDots } from "@/components/ui/step-dots";
import Link from "next/link";
import { useId, useState, useTransition, type ChangeEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { saveAfterVisitAction } from "@/app/(app)/config/depois-atendimento/actions";
import {
  AFTER_VISIT_LIMITS, NOTA_BAIXA_AVISO, SATISFACTION_OPTIONS, afterVisitTimingError, renderAfterVisit, renderNotaBaixa, type AfterVisitConfig, type AfterVisitMode,
} from "@/lib/after-visit";
import { CASA_AGRADECIMENTO, CASA_NOTA_ALTA, CASA_PESQUISA_TITULO } from "@/lib/casa-texts";

const CARD = "rounded-[var(--radius-card)] border border-line bg-paper p-5";
const STEPS = [
  "O que a cliente recebe depois do atendimento?", "Quanto tempo depois?", "O que diz a mensagem?", "O que a Pesquisa de satisfação pergunta?", "E quando a nota é baixa?",
] as const;
const MODES: { value: AfterVisitMode; label: string }[] = [
  { value: "desligado", label: "Nada" },
  { value: "agradecimento", label: "Agradecimento com o link do Google" },
  { value: "pesquisa", label: "Pesquisa de satisfação (nota de 1 a 5; nota alta recebe o link do Google)" },
];
const EXEMPLO = "Maria";

/**
 * Depois do atendimento (Fase B, item 11): uma pergunta por passo. Nasce DESLIGADO; ligar é pela troca do ChatGuru para o CRM (até lá, a escolha fica
 * desabilitada com "Ligue pela troca do ChatGuru para o CRM"). Desligar é na hora. Números e texto se editam sempre, com prévia e "Usar o texto da Casa".
 */
export function AfterVisitSettings({ initial }: { initial: AfterVisitConfig }) {
  const [v, setV] = useState(initial);
  const [saved, setSaved] = useState(initial.mode);
  const [step, setStep] = useState(0);
  const [pending, start] = useTransition();
  const toast = useToast();
  const titleId = useId();
  const on = saved !== "desligado";
  const timingError = afterVisitTimingError(v);
  const link = v.linkGoogle?.trim() || "(link do Google)";
  const num = (k: keyof typeof AFTER_VISIT_LIMITS) => ({
    type: "number" as const, inputMode: "numeric" as const, min: AFTER_VISIT_LIMITS[k].min, max: AFTER_VISIT_LIMITS[k].max, className: "w-32",
    value: Number.isFinite(v[k]) ? String(v[k]) : "", onChange: (e: ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.value === "" ? NaN : Number(e.target.value) }),
  });
  const save = (next: AfterVisitConfig) => start(async () => {
    if (timingError) { setStep(1); toast(timingError, "error"); return; } // o servidor recusaria do mesmo jeito
    const r = await saveAfterVisitAction(next);
    if (!r.ok) { toast(r.error, "error"); return; }
    setV(next); setSaved(next.mode);
    toast(next.mode !== saved ? (next.mode === "desligado" ? "Depois do atendimento desligado" : "Depois do atendimento ligado") : "Salvo", "ok");
  });
  /** Desligar salva na hora; ligar só pela troca do ChatGuru para o CRM. */
  const pick = (mode: AfterVisitMode) => { if (mode === "desligado" && on) save({ ...v, mode }); };

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-4">
      <div className={CARD}>
        <h2 id={titleId} className="sr-only">Depois do atendimento</h2>{/* r68 #8: o título da página (h1) já diz isto; o h2 fica só para o leitor de tela */}
        <p className="mt-1 text-sm text-graphite">Quando todos os serviços da visita ficam Finalizados (na Agenda, na comanda ou na baixa do Avec), a cliente recebe uma mensagem só, no tempo e na janela escolhidos: o agradecimento ou a Pesquisa de satisfação. Quem faltou não recebe.</p>
        <StepDots className="mt-3" current={step + 1} total={STEPS.length} />
      </div>

      <form className={`${CARD} flex flex-col gap-4`} onSubmit={(e) => { e.preventDefault(); save(v); }}>
        <h3 className="font-display text-lg">{STEPS[step]}</h3>

        {step === 0 && (
          <fieldset className="flex flex-col gap-2">
            <legend className="sr-only">{STEPS[0]}</legend>
            {MODES.map((m) => {
              const locked = m.value !== "desligado" && !on;
              return (
                <label key={m.value} className="flex min-h-11 items-center gap-2 text-sm">
                  <input type="radio" name="depois-modo" className="size-5" value={m.value} checked={saved === m.value} disabled={pending || locked} onChange={() => pick(m.value)} />
                  {m.label}
                </label>
              );
            })}
            {!on && <p role="note" className="rounded-[var(--radius-control)] bg-gold-soft px-3 py-2 text-sm text-ink"><Link href="/config/virada?alvo=depois" className="font-medium underline underline-offset-2">Ligue pela troca do ChatGuru para o CRM</Link></p>}
          </fieldset>
        )}

        {step === 1 && (
          <div className="flex flex-col gap-3">
            <Field label="Minutos depois do atendimento" htmlFor="dv-delay" hint="De 30 a 1.440 minutos (24 horas). Conta da hora em que o último serviço ficou Finalizado.">
              <Input id="dv-delay" {...num("delayMinutes")} />
            </Field>
            <div className="flex flex-wrap gap-4">
              <Field label="A partir de que hora" htmlFor="dv-inicio"><Input id="dv-inicio" {...num("janelaInicio")} /></Field>
              <Field label="Até que hora" htmlFor="dv-fim" hint="Fora dessa janela (horário de Salvador), espera o começo dela."><Input id="dv-fim" {...num("janelaFim")} /></Field>
            </div>
            <Field label="Depois de quantas horas não manda mais" htmlFor="dv-max" error={timingError} hint="De 1 a 72 horas desde o atendimento. Passou disso, a mensagem não sai.">
              <Input id="dv-max" {...num("horasMax")} />
            </Field>
          </div>
        )}

        {step === 2 && (
          <div className="flex flex-col gap-3">
            <Field label="Link da Avaliação no Google" htmlFor="dv-google" hint="Sem o link, o agradecimento não liga e a nota alta da pesquisa não recebe nada.">
              <Input id="dv-google" value={v.linkGoogle ?? ""} maxLength={300} placeholder="https://g.page/r/…/review" onChange={(e) => setV({ ...v, linkGoogle: e.target.value })} />
            </Field>
            <Field label="Texto do agradecimento" htmlFor="dv-texto" hint="Use {primeiro_nome} e {link_google}.">
              <Textarea id="dv-texto" rows={7} maxLength={1000} value={v.textoAgradecimento} onChange={(e) => setV({ ...v, textoAgradecimento: e.target.value })} />
            </Field>
            <Button type="button" variant="ghost" size="sm" className="-mt-1 self-start" onClick={() => setV({ ...v, textoAgradecimento: CASA_AGRADECIMENTO })}>Usar o texto da Casa</Button>
            <section aria-label="Prévia" className="rounded-[var(--radius-control)] bg-paper-2 px-3 py-2 text-sm whitespace-pre-wrap text-ink">
              {renderAfterVisit(v.textoAgradecimento, { primeiro_nome: EXEMPLO, link_google: link })}
            </section>
          </div>
        )}

        {step === 3 && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-graphite">A cliente recebe uma enquete com as notas de 5 (Excelente) a 1 (Muito ruim). Só uma mensagem: com a pesquisa ligada, o agradecimento não sai.</p>
            <Field label="Pergunta da enquete" htmlFor="dv-pergunta" hint="Use {primeiro_nome}. Até 200 caracteres.">
              <Input id="dv-pergunta" maxLength={200} value={v.tituloPesquisa} onChange={(e) => setV({ ...v, tituloPesquisa: e.target.value })} />
            </Field>
            <section aria-label="Prévia da pesquisa" className="rounded-[var(--radius-control)] bg-paper-2 px-3 py-2 text-sm text-ink">
              <p className="font-medium">{renderAfterVisit(v.tituloPesquisa, { primeiro_nome: EXEMPLO, link_google: link })}</p>
              <ul className="mt-1 flex flex-col gap-0.5">{SATISFACTION_OPTIONS.map((o) => <li key={o}>○ {o}</li>)}</ul>
            </section>
            <Field label="A partir de que nota a cliente recebe o link do Google" htmlFor="dv-nota-alta" hint="Abaixo dessa nota é nota baixa: a cliente não recebe nada e a gestão é avisada.">
              <Select id="dv-nota-alta" className="w-auto" value={String(v.notaAltaMin)} onChange={(e) => setV({ ...v, notaAltaMin: e.target.value === "5" ? 5 : 4 })}>
                <option value="4">4 ou 5</option>
                <option value="5">Só 5</option>
              </Select>
            </Field>
            <Field label="Texto da nota alta" htmlFor="dv-nota-alta-texto" hint="Use {primeiro_nome} e {link_google}. Sai uma vez só, mesmo se ela mudar o voto.">
              <Textarea id="dv-nota-alta-texto" rows={3} maxLength={1000} value={v.textoNotaAlta} onChange={(e) => setV({ ...v, textoNotaAlta: e.target.value })} />
            </Field>
            <Button type="button" variant="ghost" size="sm" className="-mt-1 self-start" onClick={() => setV({ ...v, tituloPesquisa: CASA_PESQUISA_TITULO, textoNotaAlta: CASA_NOTA_ALTA })}>Usar o texto da Casa</Button>
            <section aria-label="Prévia da nota alta" className="rounded-[var(--radius-control)] bg-paper-2 px-3 py-2 text-sm whitespace-pre-wrap text-ink">
              {renderAfterVisit(v.textoNotaAlta, { primeiro_nome: EXEMPLO, link_google: link })}
            </section>
          </div>
        )}

        {step === 4 && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-graphite">Nota de 1 a {v.notaAltaMin - 1}: a cliente não recebe nada. A gestão recebe o aviso e a cliente ganha a etiqueta. Se ela mudar para uma nota alta, o aviso se resolve.</p>
            <Field label="Aviso para a gestão" htmlFor="dv-aviso" hint="Use {nome}, {nota}, {servicos} e {profissionais}.">
              <Textarea id="dv-aviso" rows={3} maxLength={300} value={v.textoNotaBaixa} onChange={(e) => setV({ ...v, textoNotaBaixa: e.target.value })} />
            </Field>
            <Button type="button" variant="ghost" size="sm" className="-mt-1 self-start" onClick={() => setV({ ...v, textoNotaBaixa: NOTA_BAIXA_AVISO })}>Usar o texto sugerido</Button>
            <section aria-label="Prévia do aviso" className="rounded-[var(--radius-control)] bg-paper-2 px-3 py-2 text-sm whitespace-pre-wrap text-ink">
              {renderNotaBaixa(v.textoNotaBaixa, { nome: EXEMPLO, nota: 2, servicos: ["Escova"], profissionais: ["Gilvan"] })}
            </section>
            <Field label="Etiqueta que a cliente recebe" htmlFor="dv-etiqueta">
              <Input id="dv-etiqueta" className="w-60" maxLength={30} value={v.etiquetaNotaBaixa} onChange={(e) => setV({ ...v, etiquetaNotaBaixa: e.target.value })} />
            </Field>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {step > 0 && <Button type="button" variant="ghost" onClick={() => setStep(step - 1)}>Voltar</Button>}
          {step < STEPS.length - 1 && <Button type="button" variant="secondary" onClick={() => setStep(step + 1)}>Continuar</Button>}
          <Button type="submit" loading={pending}>Salvar</Button>
        </div>
      </form>
    </section>
  );
}
