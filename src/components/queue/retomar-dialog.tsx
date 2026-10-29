"use client";
import { DictateButton } from "@/components/lead/dictate-button";
import { useEffect, useState, useTransition } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { useHours } from "@/components/pipeline/timer";
import { bulkResumeAction, resumeAction } from "@/app/(app)/conversa/actions";
import { editScheduledAction } from "@/app/(app)/atendimento/programadas/actions";
import { aiProgramadaAction, aiProgramadaAvailableAction } from "@/app/(app)/conversa/ai-actions";
import { dueLabel, retomarPresets } from "@/lib/next-action";
import { bahiaParts, slotMs } from "@/lib/schedule";
import { fillFirstName } from "@/lib/retomada";
import { replyTitle } from "@/lib/quick-reply";
import { cn } from "@/lib/cn";

type Prontas = { id?: string; label: string; body: string | null }[];
const CHIP = "min-h-9 rounded-full border px-3 text-sm transition-colors pointer-coarse:min-h-11";
const REASONS = ["Ver se ela decidiu", "Confirmar o horário", "Mandar os valores", "Ela pediu para chamar depois"];

/**
 * Retomar (nova organização, 16/10): UMA ação para lembrete e mensagem programada. Dia e hora (atalhos que pulam dia fechado, ou Escolher),
 * motivo e uma mensagem OPCIONAL (com respostas prontas). Sem texto vira lembrete para quem marcou; com texto a mensagem sai sozinha na hora,
 * com "Cancelar se ela responder antes" ligado por padrão. Serve para uma conversa (`dealIds` com 1) e para o lote (o 1º nome entra sozinho).
 * O relógio do campo de mensagem ("Programar mensagem") abre este mesmo diálogo com o texto já preenchido.
 * "Escrever com IA" (IA ligada): a atendente diz o tema e a IA escreve o texto para o dia/hora escolhidos. O texto só entra no campo
 * (editável, com Desfazer); nada é programado sem o botão Programar. No lote, um modelo só com {primeiro_nome} (não lê as conversas).
 */
export function RetomarDialog({ open, onClose, dealIds, name, initialText = "", initialMotivo = "", prontas = [], onDone, initialAt, initialCancela = true, editOutboxId, initialTema = "" }: {
  open: boolean; onClose: () => void; dealIds: string[]; name?: string | null; initialText?: string; initialMotivo?: string; prontas?: Prontas;
  /** Editar uma mensagem programada (Mensagens programadas): abre no dia/hora dela e, ao confirmar, a troca pela nova. */
  initialAt?: number; initialCancela?: boolean; editOutboxId?: string;
  /** Retomada pela IA sendo editada: o que a atendente tinha pedido. */ initialTema?: string;
  onDone: (r: { dueAt: string; texto: boolean; count: number }) => void;
}) {
  const hours = useHours();
  const [openedAt] = useState(() => Date.now());
  const presets = retomarPresets(openedAt, hours);
  const [quando, setQuando] = useState<string>(initialAt ? "escolher" : presets.find((p) => p.key === "amanha")?.key ?? presets[0].key);
  const [slot, setSlot] = useState(() => bahiaParts(initialAt ?? (presets.find((p) => p.key === "amanha") ?? presets[0]).at.getTime()));
  const [motivo, setMotivo] = useState(initialMotivo);
  const [texto, setTexto] = useState(initialText);
  const [cancela, setCancela] = useState(initialCancela);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [iaOk, setIaOk] = useState(false);
  const [iaAberta, setIaAberta] = useState(false);
  // Retomada pela IA ligada (29/10): sem texto, a IA escreve e envia na hora a partir do "O que falar?" (ou do motivo).
  const [iaAuto, setIaAuto] = useState(false);
  const [tema, setTema] = useState(initialTema);
  const [gerado, setGerado] = useState<string | null>(null);
  const [antes, setAntes] = useState<string | null>(null);
  const [iaErro, setIaErro] = useState<string | null>(null);
  const [gerando, startGerar] = useTransition();
  // Só aparece com a IA ligada e com chave no servidor (desligada: o botão não existe).
  useEffect(() => {
    if (!open) return;
    let alive = true;
    aiProgramadaAvailableAction().then((r) => {
      if (!alive || !r.ok) return;
      const d = typeof r.data === "boolean" ? { escrever: r.data, auto: false } : r.data;
      setIaOk(d.escrever); setIaAuto(d.auto); if (d.auto) setIaAberta(true);
    }).catch(() => {});
    return () => { alive = false; };
  }, [open]);
  const bulk = dealIds.length > 1;
  const first = name?.trim().split(/\s+/)[0] ?? "";
  const escolher = quando === "escolher";
  const ms = escolher ? slotMs(slot.date, slot.time) : presets.find((p) => p.key === quando)!.at.getTime();
  const hasText = !!texto.trim();
  const when = Number.isFinite(ms) ? dueLabel(ms, openedAt) : null;
  const autoIa = iaAuto && !hasText;
  const resumo = !when ? "Escolha o dia e a hora."
    : bulk ? (hasText ? `${dealIds.length} mensagens · ${when} · saem 1 a cada 20 s` : autoIa ? `${dealIds.length} retomadas · ${when} · a IA escreve e envia cada uma, 1 a cada 20 s` : `${dealIds.length} lembretes · ${when}`)
    : hasText ? `A mensagem sai sozinha ${when}${cancela ? ", se ela não responder antes" : ""}.`
    : autoIa ? `${when.charAt(0).toLocaleUpperCase("pt-BR")}${when.slice(1)}, a IA lê a conversa, escreve${tema.trim() ? " o que você pediu" : " a partir do motivo"} e envia sozinha${cancela ? ", se ela não responder antes" : ""}. Para ver o texto antes, toque em Gerar.`
    : `Lembrete para você ${when}. Nada é enviado.`;

  const gerar = () => {
    if (gerando) return;
    if (tema.trim().length < 3) { setIaErro("Diga em poucas palavras sobre o que é a mensagem."); return; }
    if (!Number.isFinite(ms)) { setIaErro("Escolha o dia e a hora primeiro."); return; }
    setIaErro(null);
    const prev = texto;
    startGerar(async () => {
      try {
        const r = await aiProgramadaAction({ dealIds, tema: tema.trim(), sendAt: new Date(ms).toISOString(), anterior: gerado });
        if (!r.ok) { setIaErro(r.error); return; }
        setAntes(prev); setGerado(r.data.texto); setTexto(r.data.texto);
      } catch { setIaErro("A IA não respondeu. Tente de novo em instantes."); }
    });
  };

  const confirm = () => {
    if (pending) return;
    if (!Number.isFinite(ms)) { setError("Escolha o dia e a hora."); return; }
    if (ms < openedAt - 5 * 60_000) { setError("Essa data já passou. Escolha uma data futura."); return; }
    setError(null);
    const input = { dueAt: new Date(ms).toISOString(), motivo: motivo.trim() || null, texto: hasText ? texto.trim() : null, cancelIfReply: cancela, ia: autoIa ? tema.trim() || null : null };
    start(async () => {
      if (editOutboxId) {
        const r = await editScheduledAction(editOutboxId, input);
        if (!r.ok) { setError(r.error); return; }
        onDone({ dueAt: r.data!.dueAt, texto: r.data!.texto, count: 1 });
      } else if (bulk) {
        const r = await bulkResumeAction(dealIds, input);
        if (!r.ok) { setError(r.error); return; }
        onDone({ dueAt: input.dueAt, texto: hasText, count: r.data!.ok });
      } else {
        const r = await resumeAction(dealIds[0], input);
        if (!r.ok) { setError(r.error); return; }
        onDone({ dueAt: r.data!.dueAt, texto: r.data!.texto, count: 1 });
      }
    });
  };

  return (
    <Dialog open={open} onClose={onClose} width={480} title={editOutboxId ? (first ? `Editar mensagem para ${first}` : "Editar mensagem programada") : bulk ? `Retomar ${dealIds.length} conversas` : first ? `Retomar ${first}` : "Retomar"}
      description={editOutboxId ? "Troque o texto, o dia ou a hora. A mensagem antiga dá lugar a esta." : iaAuto ? "Dia, hora e o que falar. A IA escreve e envia na hora, ou gere agora para aprovar o texto." : "Dia, hora e, se quiser, a mensagem. Sem mensagem, vira um lembrete para você."}
      footer={<><Button variant="ghost" onClick={onClose} disabled={pending}>Cancelar</Button><Button onClick={confirm} loading={pending}>{editOutboxId ? "Salvar" : hasText ? (gerado && texto === gerado ? "Aprovar e programar" : "Programar") : autoIa ? "Programar retomada" : "Salvar lembrete"}</Button></>}>
      <div className="flex max-h-[min(62vh,520px)] flex-col gap-4 overflow-y-auto pr-1">
        <div role="radiogroup" aria-label="Quando" className="flex flex-wrap gap-1.5">
          {[...presets.map((p) => ({ key: p.key as string, label: p.label })), { key: "escolher", label: "Escolher" }].map((p) => (
            <button key={p.key} type="button" role="radio" aria-checked={quando === p.key} onClick={() => { setQuando(p.key); const pr = presets.find((x) => x.key === p.key); if (pr) setSlot(bahiaParts(pr.at.getTime())); setError(null); }}
              className={cn(CHIP, quando === p.key ? "border-ink bg-ink text-paper" : "border-line-strong text-ink-2 hover:bg-paper-2")}>{p.label}</button>
          ))}
        </div>
        {escolher && (
          <div className="grid grid-cols-2 gap-3">
            <Input type="date" aria-label="Dia" min={bahiaParts(openedAt).date} value={slot.date} onChange={(e) => setSlot((s) => ({ ...s, date: e.target.value }))} className="h-11" />
            <Input type="time" aria-label="Hora" step={300} value={slot.time} onChange={(e) => setSlot((s) => ({ ...s, time: e.target.value }))} className="h-11" />
          </div>
        )}
        <p className="-mt-2 text-xs text-muted">Os atalhos pulam os dias em que a Casa está fechada.</p>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-graphite">Motivo</span>
          <Input value={motivo} maxLength={120} autoComplete="off" placeholder="Ex.: ver se fechou o orçamento" onChange={(e) => setMotivo(e.target.value)} className="h-11" />
          <span className="flex flex-wrap gap-1.5">
            {REASONS.map((r) => <button key={r} type="button" onClick={() => setMotivo(r)} className={cn(CHIP, "min-h-8 text-sm", motivo === r ? "border-ink bg-ink text-paper" : "border-line text-graphite hover:bg-paper-2")}>{r}</button>)}
          </span>
        </label>
        <div className="flex flex-col gap-1.5">
          <span className="flex min-h-8 items-center justify-between gap-2">
            <label htmlFor="retomar-texto" className="text-xs font-semibold text-graphite">Mensagem (opcional)</label>
            {iaOk && <Button size="sm" variant="ghost" className="-mr-2" aria-expanded={iaAberta} onClick={() => { setIaAberta((a) => !a); setIaErro(null); }}>Escrever com IA</Button>}
          </span>
          {iaOk && iaAberta && (
            <div className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-line bg-paper-2 p-3">
              <label htmlFor="retomar-tema" className="text-xs font-semibold text-graphite">{iaAuto ? "O que falar com ela?" : "Sobre o que é a mensagem?"}</label>
              <div className="flex gap-2">
                <Input id="retomar-tema" value={tema} maxLength={1000} autoComplete="off" placeholder="Ex.: perguntar se ficou alguma dúvida do orçamento"
                  onChange={(e) => setTema(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); gerar(); } }} className="h-11 min-w-0 flex-1" />
                <DictateButton value={tema} onChange={setTema} className="h-11" />
                <Button variant="secondary" className="h-11 shrink-0" onClick={gerar} loading={gerando}>{gerado ? "Gerar de novo" : "Gerar"}</Button>
              </div>
              <p className="text-xs text-muted" suppressHydrationWarning>
                {bulk ? `Um texto só para as ${dealIds.length}, com {primeiro_nome} no lugar do nome (a IA não lê as conversas).` : "A IA lê as últimas mensagens."}
                {when ? ` Escrito para sair ${when}.` : ""} {iaAuto ? "Gerar mostra o texto agora para você aprovar; sem gerar, a IA escreve na hora de sair." : "Confira antes de programar."}
              </p>
              {iaErro && <p role="alert" className="text-sm text-alert">{iaErro}</p>}
            </div>
          )}
          <textarea id="retomar-texto" value={texto} rows={3} maxLength={4000} placeholder={iaAuto ? "Sem texto, a IA escreve e envia na hora." : "Sem texto, vira um lembrete para você."} onChange={(e) => setTexto(e.target.value)}
            className="w-full resize-none rounded-[var(--radius-control)] border border-line-strong bg-paper px-3 py-2 text-[16px] lg:text-sm" />
          {prontas.length > 0 && (
            <span className="flex flex-wrap gap-1.5" aria-label="Respostas prontas">
              {prontas.filter((p) => p.body).slice(0, 6).map((p) => (
                <button key={p.id ?? p.label} type="button" title={`/${p.label}`} onClick={() => setTexto(bulk ? p.body! : fillFirstName(p.body!, name))}
                  className={cn(CHIP, "min-h-8 border-line text-sm text-graphite hover:bg-paper-2")}>{replyTitle(p.label)}</button>
              ))}
            </span>
          )}
          {antes !== null && (
            <button type="button" onClick={() => { setTexto(antes); setAntes(null); }} className="self-start text-xs font-medium text-graphite underline underline-offset-2 hover:text-ink">
              Desfazer (voltar ao texto anterior)
            </button>
          )}
          {bulk && <p className="text-xs text-muted">Use {"{primeiro_nome}"}: o primeiro nome de cada cliente entra sozinho.</p>}
        </div>
        {(hasText || autoIa) && (
          <button type="button" role="switch" aria-checked={cancela} onClick={() => setCancela((c) => !c)} className="flex min-h-11 items-center gap-3 text-left text-sm">
            <span aria-hidden className={cn("relative h-6 w-10 shrink-0 rounded-full transition-colors", cancela ? "bg-ink" : "bg-paper-3")}>
              <span className={cn("absolute top-0.5 size-5 rounded-full bg-paper transition-all", cancela ? "left-[18px]" : "left-0.5")} />
            </span>
            Cancelar se ela responder antes
          </button>
        )}
        <p role="status" className="rounded-[var(--radius-control)] bg-paper-2 px-3 py-2 text-sm text-ink" suppressHydrationWarning>{resumo}</p>
        {error && <p role="alert" className="text-sm text-alert">{error}</p>}
      </div>
    </Dialog>
  );
}
