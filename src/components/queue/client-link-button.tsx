"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { createClientLinkAction } from "@/app/(app)/agenda/actions";
import { composerHasText, offerDraft } from "@/components/lead/composer-draft";

/**
 * "Enviar link de confirmação": gera o link e PREENCHE a caixa de mensagem com o texto modelo. Não envia nada; a atendente lê,
 * ajusta e aperta Enviar. Se já houver texto digitado, pergunta antes de trocar.
 */
export function ClientLinkButton({ dealId }: { dealId: string }) {
  const [replace, setReplace] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const toast = useToast();
  const fill = (text: string) => { offerDraft(dealId, text); setReplace(null); toast("Texto pronto na caixa de mensagem. Confira e aperte Enviar."); };
  const go = () => start(async () => {
    const r = await createClientLinkAction({ dealId });
    if (!r.ok || !r.data) { toast(r.ok ? "Não deu para gerar o link." : r.error, "error"); return; }
    if (composerHasText(dealId)) setReplace(r.data.text); else fill(r.data.text);
  });
  if (replace !== null) return (
    <div role="group" aria-label="Trocar o texto da mensagem" className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-line bg-paper-2 p-3">
      <p className="text-sm">Trocar o que você estava escrevendo?</p>
      <div className="flex gap-2"><Button variant="ghost" onClick={() => setReplace(null)}>Manter o meu</Button><Button onClick={() => fill(replace)}>Trocar</Button></div>
    </div>
  );
  return <Button variant="secondary" loading={pending} onClick={go} className="self-start">Enviar link de confirmação</Button>;
}
