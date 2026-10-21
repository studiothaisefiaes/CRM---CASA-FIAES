"use client";
import { useState, useTransition } from "react";
import { SaveButton } from "@/components/ui/save-button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { SendConfirmDialog } from "@/components/config/send-confirm";
import { saveAutoReplyAction } from "@/app/(app)/config/actions";
import { AUTO_REPLY_SUGGESTED } from "@/lib/auto-message-text";

const MAX = 500;

/** Resposta fora do horário: manda uma vez a cada 12 h por cliente, só quando a Casa está fechada. Ligar mostra o aviso de envio real. */
export function AutoReplyEditor({ initial, hoursSummary, hoursSaved }: { initial: { enabled: boolean; text: string }; hoursSummary: string; hoursSaved: boolean }) {
  const [saved, setSaved] = useState(initial);
  const [text, setText] = useState(initial.text);
  const [confirm, setConfirm] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition(); const toast = useToast();
  const dirty = text.trim() !== saved.text.trim();
  const persist = (enabled: boolean, msg: string) => start(async () => {
    setErr(null);
    const r = await saveAutoReplyAction({ enabled, text });
    setConfirm(false);
    if (!r.ok) return setErr(r.error);
    setSaved({ enabled, text: text.trim() }); setText(text.trim());
    toast(msg, "ok");
  });
  const onToggle = (on: boolean) => (on ? setConfirm(true) : persist(false, "Resposta fora do horário desligada"));
  const preview = text.trim().replace(/\{nome\}/g, "Maria").replace(/\{abertura\}/g, "amanhã a partir das 9h");
  return (
    <section className="@container rounded-[var(--radius-card)] border border-line bg-paper p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Resposta fora do horário</h2>
          <p className="text-sm text-graphite mt-1 max-w-[60ch]">Quando uma cliente escreve com a Casa fechada, ela recebe este texto uma vez, e no máximo uma vez a cada 12 horas.</p>
        </div>
        <Switch checked={saved.enabled} label={saved.enabled ? "Desligar a resposta fora do horário" : "Ligar a resposta fora do horário"} disabled={pending} onChange={onToggle} />
      </div>
      <p className="text-sm mt-3 rounded-[var(--radius-control)] bg-paper-2 px-3 py-2" data-testid="nota-expediente">
        {hoursSaved
          ? <>Expediente atual: <b className="font-semibold">{hoursSummary}</b>. Muda em Configurações › Horário de funcionamento.</>
          : <>Expediente padrão: <b className="font-semibold">{hoursSummary}</b>. Ninguém salvou o horário ainda: confirmar com a Casa em Configurações › Horário de funcionamento.</>}
      </p>
      <div className="mt-4 grid items-start gap-x-6 @min-[44rem]:grid-cols-2">
      <div className="min-w-0">
      <label className="block">
        <span className="text-sm font-medium text-graphite">Texto da resposta</span>
        <Textarea className="mt-1.5 min-h-28" value={text} maxLength={MAX} onChange={(e) => setText(e.target.value)} aria-describedby="auto-reply-count"
          placeholder={AUTO_REPLY_SUGGESTED} />
      </label>
      <p id="auto-reply-count" className="text-xs text-muted mt-1 tabular">{text.length}/{MAX} · use {"{nome}"} para o primeiro nome da cliente e {"{abertura}"} para quando a Casa responde (ex.: “amanhã a partir das 9h”, pelo horário de funcionamento)</p>
      {/* Pesquisa 20/10 (Maister): prazo concreto e uma pergunta útil. Só preenche o campo: nada é salvo nem ligado sem a pessoa. */}
      {text.trim() !== AUTO_REPLY_SUGGESTED && (
        <button type="button" onClick={() => setText(AUTO_REPLY_SUGGESTED)} className="mt-1.5 min-h-9 text-sm font-medium text-gold-ink hover:underline pointer-coarse:min-h-11">
          Usar o texto sugerido (com prazo e uma pergunta)
        </button>
      )}
      </div>
      {preview && (
        <div className="mt-3 min-w-0 @min-[44rem]:mt-0" aria-label="Prévia da mensagem">
          <p className="text-xs text-muted mb-1.5">Prévia, como a cliente vê</p>
          <p className="inline-block max-w-full whitespace-pre-wrap break-words rounded-[14px] rounded-tl-[4px] bg-ok-soft px-3.5 py-2 text-base" data-testid="previa-resposta">{preview}</p>
        </div>
      )}
      </div>
      {err && <p className="text-sm text-alert mt-3" role="alert">{err}</p>}
      <div className="flex justify-end mt-4">
        <SaveButton dirty={dirty} loading={pending && !confirm}
          onClick={() => (saved.enabled ? persist(true, "Texto salvo") : persist(false, "Texto salvo. A resposta continua desligada"))}>Salvar texto</SaveButton>
      </div>
      <SendConfirmDialog open={confirm} pending={pending} onClose={() => setConfirm(false)} onConfirm={() => persist(true, "Resposta fora do horário ligada")}
        what="Responde automaticamente quando a Casa está fechada, uma vez a cada 12 h por cliente." />
    </section>
  );
}
