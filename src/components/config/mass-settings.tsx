"use client";
import { useState, useTransition } from "react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { SendConfirmDialog } from "./send-confirm";
import { saveMassSettingsAction } from "@/app/(app)/config/massa/actions";
import { cancelCampaignAction, pauseCampaignAction, resumeCampaignAction } from "@/app/(app)/contatos/massa-actions";
import type { CampaignSummary } from "@/server/domain/campaigns";

const STATUS: Record<string, string> = { rascunho: "Rascunho (não confirmada)", agendada: "Agendada", enviando: "Enviando", pausada: "Pausada", concluida: "Concluída", cancelada: "Cancelada" };

/** A chave (nasce desligada, com confirmação "isto envia mensagens reais"), as regras e a lista com pausar/retomar/cancelar. */
export function MassSettings({ enabled, campaigns, canSend }: { enabled: boolean; campaigns: CampaignSummary[]; canSend: boolean }) {
  const [on, setOn] = useState(enabled);
  const [asking, setAsking] = useState(false);
  const [pending, start] = useTransition();
  const toast = useToast();
  const save = (v: boolean) => start(async () => {
    const r = await saveMassSettingsAction({ enabled: v });
    if (!r.ok) { toast(r.error, "error"); return; }
    setOn(v); setAsking(false); toast(v ? "Mensagem em massa ligada" : "Mensagem em massa desligada: nada mais sai", "ok");
  });
  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) => start(async () => { const r = await fn(); toast(r.ok ? done : r.error ?? "Não deu certo.", r.ok ? "ok" : "error"); });
  return (
    <div className="grid items-start gap-6 min-[1100px]:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <section className="rounded-[var(--radius-card)] border border-line bg-paper p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="sr-only">Mensagem em massa</h2>{/* r68 #8: o título da página (h1) já diz isto; o h2 fica só para o leitor de tela */}
            <p className="mt-1 text-sm text-graphite">Desligada, ninguém consegue montar nem enviar. Ligada, só quem tem a permissão “Mandar mensagem em massa” (Pessoas › Perfis de acesso) vê o botão em Clientes.</p>
          </div>
          <Switch checked={on} label={on ? "Desligar mensagem em massa" : "Ligar mensagem em massa"} disabled={pending} onChange={(v) => (v ? setAsking(true) : save(false))} />
        </div>
        <ul className="mt-4 list-disc pl-5 text-sm text-graphite">
          <li>Só para quem já escreveu para a Casa; ninguém com conversa aberta; ninguém duas vezes em 7 dias.</li>
          <li>No máximo 300 clientes por vez e 150 mensagens por dia, uma a cada 2 minutos ou mais, só com a Casa aberta.</li>
          <li>Confirmação dupla: marcar o risco de bloqueio e digitar quantas clientes vão receber.</li>
          <li>Desligar aqui para tudo na mesma hora (o que faltava não sai).</li>
        </ul>
      </section>
      <section aria-label="Mensagens em massa" className="rounded-[var(--radius-card)] border border-line bg-paper">
        {campaigns.length === 0 ? <p className="px-5 py-8 text-center text-sm text-muted">Nenhuma mensagem em massa ainda.</p> : (
          <ul className="divide-y divide-line/70">
            {campaigns.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
                <div>
                  <p className="font-medium text-ink">{c.name} <span className="text-graphite">· {STATUS[c.status] ?? c.status}</span></p>
                  <p className="text-graphite">{c.sent} de {c.total} enviadas{c.failed ? ` · ${c.failed} não saíram` : ""}{c.skipped ? ` · ${c.skipped} puladas` : ""} · por {c.createdByName}</p>
                </div>
                {canSend && ["agendada", "enviando", "pausada", "rascunho"].includes(c.status) && (
                  <div className="flex gap-2">
                    {c.status === "pausada"
                      ? <Button size="sm" variant="secondary" disabled={pending} onClick={() => act(() => resumeCampaignAction(c.id), "Retomada")}>Retomar</Button>
                      : c.status !== "rascunho" && <Button size="sm" variant="secondary" disabled={pending} onClick={() => act(() => pauseCampaignAction(c.id), "Pausada")}>Pausar</Button>}
                    <Button size="sm" variant="ghost" disabled={pending} onClick={() => act(() => cancelCampaignAction(c.id), "Cancelada: quem não recebeu fica de fora")}>Cancelar</Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      <SendConfirmDialog open={asking} onClose={() => setAsking(false)} onConfirm={() => save(true)} pending={pending}
        what="Com a chave ligada, quem tiver a permissão pode mandar a mesma mensagem para até 300 clientes de uma vez." />
    </div>
  );
}
