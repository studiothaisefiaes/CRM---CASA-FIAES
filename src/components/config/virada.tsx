"use client";
import { StepDots } from "@/components/ui/step-dots";
import { UnderlineTabs } from "@/components/ui/tabs";
import Link from "next/link";
import { useId, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { SendConfirmDialog } from "@/components/config/send-confirm";
import { ligarViradaAction, saveViradaAction, sendViradaTestAction } from "@/app/(app)/config/virada/actions";
import { VIRADA_ITENS, VIRADA_NOME, VIRADA_PASSOS, viradaPronta, type ViradaAlvo, type ViradaItem, type ViradaModo, type ViradaPreview } from "@/lib/virada";

const CARD = "rounded-[var(--radius-card)] border border-line bg-paper p-5";
const MODO_PERGUNTA = "O que a cliente recebe depois do atendimento?";
const MODOS: { value: ViradaModo; label: string }[] = [
  { value: "agradecimento", label: "Agradecimento com o link do Google" },
  { value: "pesquisa", label: "Pesquisa de satisfação (nota de 1 a 5; nota alta recebe o link do Google)" },
];
const LIGADO: Record<ViradaAlvo, string> = { lembrete: "O lembrete do horário está ligado.", depois: "O Depois do atendimento está ligado." };
const LIGAR: Record<ViradaAlvo, string> = { lembrete: "Ligar o lembrete", depois: "Ligar o Depois do atendimento" };
const WHAT: Record<ViradaAlvo, string> = {
  lembrete: "Cada cliente com horário marcado recebe o lembrete 24 horas antes, e a mensagem de remarcação quando o horário muda.",
  depois: "Cada visita concluída recebe uma mensagem, no tempo e na janela de Configurações › Depois do atendimento.",
};

export type ViradaAlvoEstado = {
  ligado: boolean;
  marcados: string[];
  /** Prévia por chave: "lembrete", "agradecimento" e "pesquisa". */
  previews: Partial<Record<"lembrete" | ViradaModo, ViradaPreview>>;
  /** Já há um teste de verdade dentro do prazo (por chave). */
  testeRecente: Partial<Record<"lembrete" | ViradaModo, boolean>>;
  /** A tela própria (textos e desligar). */
  editarEm: string;
  /** Depois do atendimento: o modo gravado (quando ligado) ou o escolhido por último. */
  modo?: ViradaModo;
};
export type ViradaEstado = Record<ViradaAlvo, ViradaAlvoEstado>;

/**
 * Virada (Fase B, Task 10): o lembrete da véspera e o Depois do atendimento saem do ChatGuru e do Avec. Uma pergunta por passo, na ordem:
 * o do ChatGuru desligado, o do Avec desligado, o texto conferido, o teste recebido; só no fim aparece o botão de ligar, que pede a
 * confirmação de envio real. Cada passo marcado fica gravado no servidor (que confere tudo de novo ao ligar).
 */
export function ViradaSettings({ alvo: alvoInicial, estado, horasTeste }: { alvo: ViradaAlvo; estado: ViradaEstado; horasTeste: number }) {
  const [alvo, setAlvo] = useState(alvoInicial);
  const [marcados, setMarcados] = useState<Record<ViradaAlvo, string[]>>({ lembrete: estado.lembrete.marcados, depois: estado.depois.marcados });
  const [ligado, setLigado] = useState<Record<ViradaAlvo, boolean>>({ lembrete: estado.lembrete.ligado, depois: estado.depois.ligado });
  const [modo, setModo] = useState<ViradaModo>(estado.depois.modo ?? "agradecimento");
  const [step, setStep] = useState(0);
  const [phone, setPhone] = useState("");
  const [enviados, setEnviados] = useState<Partial<Record<string, boolean>>>({});
  const [aviso, setAviso] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();
  const toast = useToast();
  const titleId = useId();

  const e = estado[alvo];
  const m = marcados[alvo];
  const steps: (ViradaItem | "modo")[] = alvo === "depois" ? ["modo", ...VIRADA_ITENS.depois] : [...VIRADA_ITENS.lembrete];
  const cur = steps[step];
  const key = alvo === "lembrete" ? "lembrete" : modo;
  const preview = e.previews[key];
  const testeOk = !!enviados[key] || !!e.testeRecente[key];
  const pronta = viradaPronta(alvo, m);
  const last = step === steps.length - 1;

  const trocarAlvo = (a: ViradaAlvo) => { setAlvo(a); setStep(0); setAviso(null); setErro(null); };
  const marcar = (item: ViradaItem, on: boolean) => start(async () => {
    const itens: readonly string[] = VIRADA_ITENS[alvo];
    const next = itens.filter((i) => (i === item ? on : m.includes(i)));
    const r = await saveViradaAction(alvo, next);
    if (!r.ok) { toast(r.error, "error"); return; }
    setMarcados((x) => ({ ...x, [alvo]: next }));
  });
  const mandarTeste = () => start(async () => {
    setAviso(null); setErro(null);
    const r = await sendViradaTestAction(alvo, phone, alvo === "depois" ? modo : undefined);
    if (!r.ok) { setErro(r.error); return; }
    setEnviados((x) => ({ ...x, [key]: true }));
    setAviso("Mandei. Confira no WhatsApp e marque abaixo.");
  });
  const ligar = () => start(async () => {
    const r = await ligarViradaAction(alvo, alvo === "depois" ? { confirmouEnvio: true, modo } : { confirmouEnvio: true });
    setConfirm(false);
    if (!r.ok) { toast(r.error, "error"); return; }
    setLigado((x) => ({ ...x, [alvo]: true }));
    toast(alvo === "lembrete" ? "Lembrete ligado" : "Depois do atendimento ligado", "ok");
  });

  const checkbox = (item: ViradaItem, disabled = false) => (
    <label className="flex min-h-11 items-center gap-2 text-sm font-medium">
      <input type="checkbox" className="size-5" checked={m.includes(item)} disabled={pending || disabled} onChange={(ev) => marcar(item, ev.target.checked)} />
      {VIRADA_PASSOS[item].sim}
    </label>
  );

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-4">
      <div className={CARD}>
        <h2 id={titleId} className="sr-only">Troca do ChatGuru para o CRM</h2>{/* r68 #8: o título da página (h1) já diz isto; o h2 fica só para o leitor de tela */}
        <p className="mt-1 text-sm text-graphite">O lembrete do horário e o Depois do atendimento saem do ChatGuru e do Avec e passam a sair do CRM. Antes de ligar aqui, desligue lá: com os dois ligados, a cliente recebe a mesma mensagem duas ou três vezes.</p>
        <UnderlineTabs<ViradaAlvo> label="O que vai passar para o CRM" value={alvo} onChange={trocarAlvo} className="mt-3" items={(["lembrete", "depois"] as const).map((a) => ({ value: a, label: VIRADA_NOME[a] }))} />
        {!ligado[alvo] && <StepDots className="mt-3" current={step + 1} total={steps.length} />}
      </div>

      {ligado[alvo] ? (
        <div className={`${CARD} flex flex-col gap-2`}>
          <p className="font-medium text-ink">{LIGADO[alvo]}</p>
          <p className="text-sm text-graphite">Para voltar atrás, desligue aqui no CRM (o que está na fila não sai) e religue o do {alvo === "lembrete" ? "ChatGuru" : "Avec"}. Desligar zera a troca do ChatGuru para o CRM: para ligar de novo, os passos voltam.</p>
          <Link href={e.editarEm} className="self-start text-sm font-medium text-ink underline underline-offset-2">Desligar em {VIRADA_NOME[alvo]}</Link>
        </div>
      ) : (
        <div className={`${CARD} flex flex-col gap-4`}>
          <h3 className="font-display text-lg">{cur === "modo" ? MODO_PERGUNTA : VIRADA_PASSOS[cur].pergunta}</h3>

          {cur === "modo" && (
            <fieldset className="flex flex-col gap-2">
              <legend className="sr-only">{MODO_PERGUNTA}</legend>
              {MODOS.map((o) => (
                <label key={o.value} className="flex min-h-11 items-center gap-2 text-sm">
                  <input type="radio" name="virada-modo" className="size-5" value={o.value} checked={modo === o.value} onChange={() => { setModo(o.value); setAviso(null); setErro(null); }} />
                  {o.label}
                </label>
              ))}
              <p className="text-sm text-muted">Os tempos, a janela e os textos ficam em <Link href={estado.depois.editarEm} className="underline underline-offset-2">Depois do atendimento</Link>.</p>
            </fieldset>
          )}

          {cur !== "modo" && cur !== "texto_conferido" && cur !== "teste_enviado" && (
            <>
              <p className="text-sm text-graphite">{VIRADA_PASSOS[cur].ajuda}</p>
              {VIRADA_PASSOS[cur].caminho && <p className="rounded-[var(--radius-control)] bg-paper-2 px-3 py-2 text-sm text-ink">{VIRADA_PASSOS[cur].caminho}</p>}
              {checkbox(cur)}
            </>
          )}

          {cur === "texto_conferido" && (
            <>
              <p className="text-sm text-graphite">{VIRADA_PASSOS.texto_conferido.ajuda}</p>
              <section aria-label="Prévia" className="rounded-[var(--radius-control)] bg-paper-2 px-3 py-2 text-sm whitespace-pre-wrap text-ink">
                {preview ? (preview.kind === "poll"
                  ? <><p className="font-medium">{preview.text}</p><ul className="mt-1 flex flex-col gap-0.5">{preview.options.map((o) => <li key={o}>○ {o}</li>)}</ul></>
                  : preview.text) : "Sem prévia."}
              </section>
              <Link href={e.editarEm} className="self-start text-sm font-medium text-ink underline underline-offset-2">Mudar o texto</Link>
              {checkbox("texto_conferido")}
            </>
          )}

          {cur === "teste_enviado" && (
            <>
              <Field label="Para qual WhatsApp mando o teste?" htmlFor="virada-phone" error={erro}
                hint="Use o WhatsApp da gestora: o texto de verdade vai para esse número, que vira contato de Equipe. Número de cliente ou de fornecedor é recusado.">
                <Input id="virada-phone" inputMode="tel" placeholder="(71) 9 8888-0000" value={phone} onChange={(ev) => setPhone(ev.target.value)} />
              </Field>
              <Button type="button" variant="secondary" className="self-start" loading={pending} disabled={!phone.trim()} onClick={mandarTeste}>Mandar o teste</Button>
              {aviso && <p role="status" className="rounded-[var(--radius-control)] bg-gold-soft px-3 py-2 text-sm text-ink">{aviso}</p>}
              <p className="text-sm text-muted">O teste vale por {horasTeste} {horasTeste === 1 ? "hora" : "horas"}. Passou disso, mande outro antes de ligar.</p>
              {checkbox("teste_enviado", !testeOk)}
            </>
          )}

          <div className="flex flex-wrap gap-2">
            {step > 0 && <Button type="button" variant="ghost" onClick={() => setStep(step - 1)}>Voltar</Button>}
            {!last && <Button type="button" variant="secondary" disabled={cur !== "modo" && !m.includes(cur)} onClick={() => setStep(step + 1)}>Continuar</Button>}
            {last && pronta && <Button type="button" loading={pending} onClick={() => setConfirm(true)}>{LIGAR[alvo]}</Button>}
          </div>
        </div>
      )}
      <SendConfirmDialog open={confirm} onClose={() => setConfirm(false)} pending={pending} onConfirm={ligar} what={WHAT[alvo]} />
    </section>
  );
}
