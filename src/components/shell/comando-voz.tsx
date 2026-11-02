"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "@/components/ui/dialog";
import { DictateButton } from "@/components/lead/dictate-button";
import { IconMic } from "@/components/icons";
import { useToast } from "@/components/ui/toast";
import { executarComandoAction, interpretarComandoAction } from "@/app/(app)/comando/actions";
import type { Plano } from "@/server/comando/plano";
import { cn } from "@/lib/cn";

const TITULO: Record<Plano["acao"], string> = { marcar: "Marcar horário", remarcar: "Remarcar horário", cancelar: "Cancelar horário", retomar: "Programar retomada", nota: "Anotar na cliente", resolver: "Resolver conversa", abrir: "Abrir conversa", nao_entendi: "Não entendi" };
const quando = (iso: string) => new Date(iso).toLocaleString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Bahia" });
const EXEMPLOS = ["Marca a Maria Souza amanhã às 9 com a Thaise, coloração, até as 13", "Remarca a Camilla para sexta às 14h", "Cancela o horário da Ana Paula", "Retoma a Juliana na segunda para falar do orçamento", "Anota na Carla que ela prefere de manhã"];

/**
 * Comando de voz (dono, 02/11): fala (ou digita) o que quer fazer; a IA monta um cartão "Vou fazer isto" e só faz no Confirmar.
 * Nunca manda WhatsApp para a cliente por conta própria (a retomada segue a regra de sempre e o cartão avisa).
 */
export function ComandoVoz({ compact }: { compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [frase, setFrase] = useState("");
  const [plano, setPlano] = useState<Plano | null>(null);
  const [escolhida, setEscolhida] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const reset = () => { setFrase(""); setPlano(null); setEscolhida(null); };
  const fechar = () => { setOpen(false); reset(); };

  const interpretar = (t: string) => {
    if (t.trim().length < 4) return;
    start(async () => {
      const r = await interpretarComandoAction(t);
      if (!r.ok) { toast(r.error, "error"); return; }
      setPlano(r.data);
      setEscolhida(r.data.candidatas.length === 1 ? r.data.candidatas[0].contactId : null);
    });
  };
  const confirmar = () => {
    if (!plano || !escolhida) return;
    start(async () => {
      const r = await executarComandoAction(plano, escolhida);
      if (!r.ok) { toast(r.error, "error"); return; }
      toast(r.data.mensagem);
      fechar();
      if (r.data.url) router.push(r.data.url);
    });
  };

  const horario = plano && escolhida ? plano.horarios[escolhida] : undefined;
  const pode = !!plano && !plano.faltando.length && !!escolhida && !((plano.acao === "remarcar" || plano.acao === "cancelar") && !horario);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label="Comando de voz" title="Comando de voz: fale o que quer fazer"
        className={cn("grid place-items-center rounded-[var(--radius-control)] text-graphite hover:text-ink hover:bg-paper", compact ? "size-11" : "size-9")}>
        <IconMic size={18} aria-hidden />
      </button>
      <Dialog open={open} onClose={fechar} title="Comando de voz" width={520}
        description="Fale ou digite o que quer fazer. Nada muda antes de você confirmar."
        footer={<>
          <button type="button" onClick={plano ? reset : fechar} className="min-h-10 px-3 rounded-[var(--radius-control)] border border-line-strong text-sm">{plano ? "Falar de novo" : "Fechar"}</button>
          {plano ? <button type="button" disabled={!pode || pending} onClick={confirmar} className="min-h-10 px-4 rounded-[var(--radius-control)] bg-ink text-paper text-sm font-medium disabled:opacity-50">{pending ? "Fazendo…" : "Confirmar"}</button>
            : <button type="button" disabled={pending || frase.trim().length < 4} onClick={() => interpretar(frase)} className="min-h-10 px-4 rounded-[var(--radius-control)] bg-ink text-paper text-sm font-medium disabled:opacity-50">{pending ? "Entendendo…" : "Continuar"}</button>}
        </>}>
        {!plano ? (
          <div className="flex flex-col gap-3">
            <div className="flex gap-2">
              <textarea value={frase} onChange={(e) => setFrase(e.target.value)} rows={3} maxLength={1000} placeholder="Ex.: marca a Maria amanhã às 9 com a Thaise, coloração, até as 13"
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); interpretar(frase); } }}
                className="flex-1 rounded-[var(--radius-control)] border border-line-strong bg-paper p-2 text-sm" />
              <DictateButton value={frase} onChange={setFrase} onTranscribed={interpretar} className="self-start min-h-10" />
            </div>
            <ul className="text-xs text-graphite flex flex-col gap-1">{EXEMPLOS.map((e) => <li key={e}>“{e}”</li>)}</ul>
          </div>
        ) : (
          <div className="flex flex-col gap-3 text-sm">
            <p className="text-xs text-graphite">Você disse: “{plano.frase}”</p>
            <p className="font-semibold text-base">{TITULO[plano.acao]}</p>
            {plano.candidatas.length > 1 && <fieldset className="flex flex-col gap-1"><legend className="text-xs text-graphite mb-1">Qual cliente?</legend>
              {plano.candidatas.map((c) => (
                <label key={c.contactId} className="flex items-center gap-2 min-h-9"><input type="radio" name="cliente" checked={escolhida === c.contactId} onChange={() => setEscolhida(c.contactId)} />
                  <span>{c.name} <span className="text-graphite tabular-nums">{c.phone ?? ""}</span></span></label>))}
            </fieldset>}
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              {plano.candidatas.length === 1 && <><dt className="text-graphite">Cliente</dt><dd>{plano.candidatas[0].name}</dd></>}
              {horario !== undefined && <><dt className="text-graphite">Horário atual</dt><dd>{horario ? horario.label : "nenhum marcado"}</dd></>}
              {plano.servico && <><dt className="text-graphite">Serviço</dt><dd>{plano.servico}</dd></>}
              {plano.profissional && <><dt className="text-graphite">Profissional</dt><dd>{plano.profissional}</dd></>}
              {plano.inicio && <><dt className="text-graphite">{plano.acao === "retomar" ? "Quando" : "Início"}</dt><dd className="capitalize">{quando(plano.inicio)}</dd></>}
              {plano.duracaoMin && <><dt className="text-graphite">Duração</dt><dd>{Math.floor(plano.duracaoMin / 60) ? `${Math.floor(plano.duracaoMin / 60)} h ` : ""}{plano.duracaoMin % 60 ? `${plano.duracaoMin % 60} min` : ""}</dd></>}
              {plano.texto && <><dt className="text-graphite">{plano.acao === "nota" ? "Nota" : "Assunto"}</dt><dd>{plano.texto}</dd></>}
            </dl>
            {plano.acao === "marcar" && !plano.duracaoMin && !plano.faltando.length && <p className="text-xs text-graphite">Sem hora de término: usa o tempo cadastrado do serviço.</p>}
            {plano.aviso && <p className="text-xs text-gold-ink">{plano.aviso}</p>}
            {plano.faltando.length > 0 && <ul className="rounded-[var(--radius-control)] bg-alert-soft p-2 text-alert text-sm">{plano.faltando.map((f) => <li key={f}>{f}</li>)}</ul>}
          </div>
        )}
      </Dialog>
    </>
  );
}
