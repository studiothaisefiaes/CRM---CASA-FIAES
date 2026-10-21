"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Field, Input } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { saveAiSettingsAction } from "@/app/(app)/config/ia/actions";
import { formatUsd } from "@/server/ai/pricing";
import type { AiSettings, AiSpend } from "@/server/ai/settings";

/**
 * Configurações › Conversas › Sugestão de resposta por IA. Nasce desligada. Ligada, a conversa ganha o botão "Sugerir resposta"
 * (só ele gera; abrir a conversa não gasta nada); nada sai sem a atendente enviar. Mostra o gasto do mês e os limites (mês em dólar, chamadas por dia).
 * No computador fica na coluna esquerda da tela (o manual vai à direita); no celular, em cima.
 */
export function AiSettingsForm({ initial, spend, hasKey, model }: { initial: AiSettings; spend: AiSpend; hasKey: boolean; model: string }) {
  const [on, setOn] = useState(initial.enabled);
  const [limit, setLimit] = useState(String(initial.monthlyLimitUsd).replace(".", ","));
  const [daily, setDaily] = useState(String(initial.dailyCalls));
  const [pending, start] = useTransition();
  const toast = useToast();
  const values = (enabled: boolean): AiSettings => ({ enabled, monthlyLimitUsd: Number(limit.replace(",", ".")), dailyCalls: Number(daily) });
  const save = (enabled: boolean, done: string) => start(async () => {
    const r = await saveAiSettingsAction(values(enabled));
    if (!r.ok) { toast(r.error, "error"); return; }
    setOn(enabled); toast(done, "ok");
  });
  const usedPct = Math.min(100, Math.round((spend.monthMicros / (initial.monthlyLimitUsd * 1_000_000)) * 100));
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <section className="rounded-[var(--radius-card)] border border-line bg-paper p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold">{on ? "Ligada" : "Desligada"}</h2>
            <p className="mt-1 text-sm text-graphite">{on ? "Toque em Sugerir resposta acima da caixa de mensagem, a qualquer momento." : "Nenhuma conversa vai para a IA e nenhuma sugestão aparece."}</p>
          </div>
          <Switch checked={on} label="Sugestão de resposta por IA" disabled={pending}
            onChange={(v) => save(v, v ? "Sugestão por IA ligada: toque em Sugerir resposta acima da caixa de mensagem." : "Sugestão por IA desligada.")} />
        </div>
        {!hasKey && <p role="alert" className="mt-3 rounded-[var(--radius-control)] bg-alert-soft px-3 py-2 text-sm text-alert">A chave da IA não está no servidor (ANTHROPIC_API_KEY): mesmo ligada, nenhuma sugestão é gerada.</p>}
        <h3 className="mt-5 text-base font-medium text-ink">Como funciona</h3>
        <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-5 text-sm text-graphite">
          <li>A qualquer momento, toque em <b>Sugerir resposta</b>: se a cliente escreveu por último, a IA responde; se a Casa falou por último, ela escreve a próxima mensagem da Casa (continuar, retomar, mandar uma informação nova) sem repetir o que já foi dito.</li>
          <li>Opcional: diga <b>Sobre o quê?</b> (ex.: &ldquo;dizer que a Cati vai continuar o atendimento&rdquo;) e a IA segue o tema. Marcou uma mensagem para responder? A IA responde a ela, mesmo que seja antiga.</li>
          <li>A IA sabe com quem a conversa está, se houve transferência, o status, a etapa, o próximo horário, o pacote, a retomada marcada e as notas internas recentes, e escreve como quem está pedindo.</li>
          <li>A IA só escreve quando alguém toca Sugerir resposta na conversa. Abrir a conversa não gera nada nem gasta.</li>
          <li>Economia: o mesmo pedido (mesma mensagem, mesmo tema, mesma mensagem marcada) mostra a sugestão já guardada, sem gastar de novo. Depois de usar ou fechar, dá para pedir outra.</li>
          <li>A atendente toca <b>Usar e editar</b>: o texto vai para a caixa de mensagem, ela confere, muda se quiser e aperta Enviar.</li>
          <li>Reclamação, desconto, remarcação: a sugestão avisa que pede alguém da equipe.</li>
          <li>Funciona também nas conversas com contatos da Equipe, para testes.</li>
          <li>Vai para a IA só o primeiro nome, as mensagens recentes e esse resumo curto da conversa. Nunca CPF, telefone ou e-mail.</li>
        </ul>
      </section>
      <section aria-labelledby="ia-gasto" className="rounded-[var(--radius-card)] border border-line bg-paper p-5">
        <h2 id="ia-gasto" className="text-lg font-semibold">Gasto</h2>
        <p className="mt-2 text-sm text-ink"><span className="text-2xl font-semibold tabular-nums">{formatUsd(spend.monthMicros)}</span> neste mês, de US$ {initial.monthlyLimitUsd.toFixed(2).replace(".", ",")} ({usedPct}%)</p>
        <p className="mt-1 text-sm text-graphite">{spend.monthCalls} {spend.monthCalls === 1 ? "sugestão" : "sugestões"} no mês · {spend.todayCalls} hoje · modelo {model}</p>
        <p className="mt-1 text-xs text-muted">Passou de um dos limites, a IA para de sugerir até virar o mês (ou o dia). A conversa segue normal.</p>
        <form className="mt-4 grid gap-4 sm:grid-cols-2 min-[1100px]:grid-cols-1" onSubmit={(e) => { e.preventDefault(); save(on, "Limites salvos."); }}>
          <Field label="Limite do mês (US$)" htmlFor="ia-limite" hint="De 1 a 200.">
            <Input id="ia-limite" inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} />
          </Field>
          <Field label="Sugestões por dia (no máximo)" htmlFor="ia-dia" hint="De 10 a 10.000.">
            <Input id="ia-dia" inputMode="numeric" value={daily} onChange={(e) => setDaily(e.target.value.replace(/\D/g, ""))} />
          </Field>
          <div className="sm:col-span-2 min-[1100px]:col-span-1"><Button type="submit" variant="secondary" loading={pending}>Salvar limites</Button></div>
        </form>
      </section>
    </div>
  );
}
