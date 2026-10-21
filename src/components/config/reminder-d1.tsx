"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { saveLembreteD1Action } from "@/app/(app)/config/automacoes/lembrete-actions";
import type { LembreteD1 } from "@/server/domain/client-link/settings";
import { DEFAULT_REMINDER_TEXT, DEFAULT_RESCHEDULED_TEXT } from "@/lib/reminder-d1";

/**
 * Lembrete do horário (pedido do dono, 15/10): 24 h antes, na janela 8h–20h, e "seu horário foi remarcado" na hora da remarcação.
 * Nasce DESLIGADO; ligar é pela troca do ChatGuru para o CRM (Task 10: o do ChatGuru e o do Avec desligados, texto conferido, teste recebido e a confirmação
 * de envio real). Aqui ficam os textos e o desligar. Sem o link por padrão; o link só entra com a página da cliente publicada.
 */
export function ReminderD1Card({ value }: { value: LembreteD1 }) {
  const [v, setV] = useState(value);
  const [pending, start] = useTransition();
  const toast = useToast();
  const save = (next: LembreteD1) => start(async () => {
    const r = await saveLembreteD1Action(next);
    if (r.ok) { setV(next); toast(next.enabled !== v.enabled ? (next.enabled ? "Lembrete ligado" : "Lembrete desligado") : "Salvo"); } else toast(r.error, "error");
  });
  return (
    <section aria-labelledby="lembrete-d1" className="mt-6 rounded-[var(--radius-card)] border border-line bg-paper p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="lembrete-d1" className="text-lg font-semibold">Lembrete do horário</h2>
          <p className="mt-1 text-sm text-graphite">Cada cliente com horário marcado recebe a mensagem 24 horas antes, entre 8h e 20h. Quando o horário é remarcado, sai na hora a mensagem de remarcação e o lembrete passa para o horário novo. Cancelado e faltou não recebem.</p>
          <p role="note" className="mt-2 rounded-[var(--radius-control)] bg-gold-soft px-3 py-2 text-sm text-ink">Liga pela troca do ChatGuru para o CRM: antes, desligue o lembrete do ChatGuru e a confirmação do Avec (e da Avec IA), senão a cliente recebe duas mensagens.</p>
        </div>
        {v.enabled
          ? <Switch checked disabled={pending} label="Lembrete do horário" onChange={() => save({ ...v, enabled: false })} />
          : <Link href="/config/virada?alvo=lembrete" className="inline-flex min-h-11 shrink-0 items-center text-sm font-medium text-ink underline underline-offset-2 lg:min-h-9">Ligar pela troca do ChatGuru para o CRM</Link>}
      </div>
      <form className="mt-4 flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); save(v); }}>
        <Field label="Texto do lembrete" htmlFor="ld1-texto" hint="Use {primeiro_nome}, {data} (quinta-feira, 22/10), {hora} (14h), {servicos}, {endereco} e {mapa} (da Página da cliente). {servicos} numa linha só dele (pode ter um ✨ antes) põe um serviço por linha; sem endereço, a linha do endereço e a do mapa somem. *texto* sai em negrito no WhatsApp.">
          <Textarea id="ld1-texto" rows={9} value={v.texto} maxLength={600} onChange={(e) => setV({ ...v, texto: e.target.value })} />
        </Field>
        <Button type="button" variant="ghost" size="sm" className="-mt-1 self-start" aria-label="Usar o texto da Casa no lembrete" onClick={() => setV({ ...v, texto: DEFAULT_REMINDER_TEXT })}>Usar o texto da Casa</Button>
        <Field label="Texto quando o horário é remarcado" htmlFor="ld1-remarcado" hint="Sai na hora da remarcação.">
          <Textarea id="ld1-remarcado" rows={9} value={v.textoRemarcado} maxLength={600} onChange={(e) => setV({ ...v, textoRemarcado: e.target.value })} />
        </Field>
        <Button type="button" variant="ghost" size="sm" className="-mt-1 self-start" aria-label="Usar o texto sugerido da remarcação" onClick={() => setV({ ...v, textoRemarcado: DEFAULT_RESCHEDULED_TEXT })}>Usar o texto sugerido</Button>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" className="size-5" checked={v.comLink} onChange={(e) => setV({ ...v, comLink: e.target.checked })} />
          Incluir o link para confirmar ou remarcar (só depois de publicar a página da cliente)
        </label>
        <Button type="submit" variant="secondary" loading={pending} className="self-start">Salvar textos</Button>
      </form>
    </section>
  );
}
