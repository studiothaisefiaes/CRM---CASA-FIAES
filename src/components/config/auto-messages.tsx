"use client";
import { useState, useTransition } from "react";
import { SaveButton } from "@/components/ui/save-button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { SendConfirmDialog } from "@/components/config/send-confirm";
import { saveAutoMessageAction, saveAutoMessageAsReplyAction } from "@/app/(app)/config/actions";
import { fillName } from "@/lib/auto-message-text";

type Kind = "boas_vindas" | "ausencia" | "encerramento";
const COPY: Record<Kind, { title: string; help: string; what: string; placeholder: string }> = {
  boas_vindas: { title: "Boas-vindas", help: "Para quem escreve pela primeira vez, com a Casa aberta. Com a Casa fechada, vale a resposta fora do horário.",
    what: "Responde automaticamente quem escreve pela primeira vez para a Casa.", placeholder: "Oi, {nome}! Que bom falar com você. Já vamos te responder." },
  ausencia: { title: "Ausência", help: "Quando a Casa está aberta e ninguém da equipe está Disponível no CRM. No máximo uma resposta automática a cada 12 horas por cliente.",
    what: "Responde automaticamente quando ninguém da equipe está Disponível.", placeholder: "Oi, {nome}! Recebemos sua mensagem e já, já alguém te responde." },
  encerramento: { title: "Conversa resolvida", help: "Quando alguém marca a conversa como Resolvido. Não sai se a cliente escrever antes.",
    what: "Envia uma mensagem toda vez que uma conversa é resolvida.", placeholder: "Obrigada, {nome}! Qualquer coisa, é só chamar." },
};
const MAX = 500;

/** Uma mensagem automática (Lote 4): texto, prévia e liga/desliga com o aviso de envio real. Nasce desligada. */
export function AutoMessageEditor({ kind, initial, note }: { kind: Kind; initial: { enabled: boolean; text: string }; note?: string }) {
  const c = COPY[kind];
  const [saved, setSaved] = useState(initial);
  const [text, setText] = useState(initial.text);
  const [confirm, setConfirm] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition(); const toast = useToast();
  const dirty = text.trim() !== saved.text.trim();
  const persist = (enabled: boolean, msg: string) => start(async () => {
    setErr(null);
    const r = await saveAutoMessageAction(kind, { enabled, text });
    setConfirm(false);
    if (!r.ok) return setErr(r.error);
    setSaved({ enabled, text: text.trim() }); setText(text.trim());
    toast(msg, "ok");
  });
  const [shortcut, setShortcut] = useState<string | null>(null);
  const asReply = () => start(async () => {
    setErr(null);
    const r = await saveAutoMessageAsReplyAction(kind, text);
    if (!r.ok) return setErr(r.error);
    setSaved({ enabled: false, text: text.trim() }); setText(text.trim());
    setShortcut(`/${(r.data as { shortcut: string }).shortcut}`);
    toast("Pronto: ficou como resposta pronta, sem enviar nada sozinha", "ok");
  });
  const preview = fillName(text.trim(), "Maria");
  return (
    <section aria-labelledby={`msg-${kind}`} className="@container rounded-[var(--radius-card)] border border-line bg-paper p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 id={`msg-${kind}`} className="text-lg font-semibold">{c.title}</h2>
          <p className="text-sm text-graphite mt-1 max-w-[60ch]">{c.help}</p>
        </div>
        <Switch checked={saved.enabled} label={saved.enabled ? `Desligar ${c.title}` : `Ligar ${c.title}`} disabled={pending}
          onChange={(on) => (on ? setConfirm(true) : persist(false, `${c.title} desligada`))} />
      </div>
      {note && <p className="text-sm mt-3 rounded-[var(--radius-control)] bg-paper-2 px-3 py-2">{note}</p>}
      <div className="mt-4 grid items-start gap-x-6 @min-[44rem]:grid-cols-2">
      <div className="min-w-0">
      <label className="block">
        <span className="text-sm font-medium text-graphite">Texto</span>
        <Textarea className="mt-1.5 min-h-24" value={text} maxLength={MAX} onChange={(e) => setText(e.target.value)} placeholder={c.placeholder} aria-describedby={`msg-${kind}-count`} />
      </label>
      <p id={`msg-${kind}-count`} className="text-xs text-muted mt-1 tabular">{text.length}/{MAX} · use {"{nome}"} para o primeiro nome da cliente</p>
      </div>
      <div className="min-w-0">{preview && <p aria-label={`Prévia de ${c.title}`} className="mt-3 @min-[44rem]:mt-0 inline-block max-w-full whitespace-pre-wrap break-words rounded-[14px] rounded-tl-[4px] bg-ok-soft px-3.5 py-2 text-base">{preview}</p>}</div>
      </div>
      {err && <p className="text-sm text-alert mt-3" role="alert">{err}</p>}
      <div className="flex flex-wrap items-center justify-between gap-3 mt-4">
        <div className="min-w-0 text-sm text-graphite">
          <button type="button" disabled={pending || text.trim().length < 3} onClick={asReply}
            className="min-h-11 rounded-[var(--radius-control)] border border-line-strong bg-paper px-3 text-sm font-medium text-ink hover:bg-paper-2 disabled:opacity-60 lg:min-h-9">
            Deixar só como resposta pronta
          </button>
          <span className="ml-2 text-xs text-muted">{shortcut ? `Está em ${shortcut}: digite “/” na conversa. Nada sai sozinho.` : "Não envia nada sozinha: o texto fica para consulta e uso."}</span>
        </div>
        <SaveButton aria-label={`Salvar texto de ${c.title}`} dirty={dirty} loading={pending && !confirm} onClick={() => persist(saved.enabled, saved.enabled ? "Texto salvo" : `Texto salvo. ${c.title} continua desligada`)}>Salvar texto</SaveButton>
      </div>
      <SendConfirmDialog open={confirm} pending={pending} onClose={() => setConfirm(false)} onConfirm={() => persist(true, `${c.title} ligada`)} what={c.what} />
    </section>
  );
}
