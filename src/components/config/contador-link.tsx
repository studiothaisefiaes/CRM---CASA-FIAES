"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { createContadorLinkAction, revokeContadorLinkAction } from "@/app/(app)/config/actions";

export type ContadorLinkView = { id: string; createdAt: string; expiresAt: string; createdByName: string | null };

const DM = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Bahia" });
const DMH = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Bahia" });

/**
 * Configurações › Equipe › Pessoas: "Gerar link para o contador" (26/10). O link aparece uma vez só (no banco fica o hash), vale uma vez,
 * por 7 dias, e sempre com o perfil Contador. Os que ainda valem ficam listados para revogar.
 */
export function ContadorLinkPanel({ pending }: { pending: ContadorLinkView[] }) {
  const [shown, setShown] = useState<{ url: string; expiresAt: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const toast = useToast();
  const generate = () => start(async () => {
    const r = await createContadorLinkAction();
    if (r.ok) { setShown({ url: r.data!.url, expiresAt: r.data!.expiresAt }); setErr(null); } else setErr(r.error);
  });
  const revoke = (id: string) => start(async () => {
    const r = await revokeContadorLinkAction(id);
    if (r.ok) toast("Link cancelado", "ok"); else toast(r.error, "error");
  });
  const copy = async () => { if (!shown) return; await navigator.clipboard.writeText(shown.url); toast("Link copiado"); };
  return (
    <section aria-labelledby="contador-t" className="mb-5 rounded-[var(--radius-card)] border border-line bg-paper px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 max-w-[60ch]">
          <h2 id="contador-t" className="font-medium text-base">Acesso do contador</h2>
          <p className="text-sm text-graphite">Gere um link e mande para o contador. Ele põe o nome, o e-mail e uma senha e entra com o perfil <b>Contador</b>: só vê os relatórios do dinheiro e as notas fiscais, sem mudar nada. O link vale uma vez, por 7 dias.</p>
        </div>
        <Button size="sm" variant="secondary" className="h-9 shrink-0" loading={busy && !shown} onClick={generate}>Gerar link para o contador</Button>
      </div>
      {err && <p className="mt-2 text-sm text-alert" role="alert">{err}</p>}
      {pending.length > 0 && (
        <ul aria-label="Links do contador ainda valendo" className="mt-3 divide-y divide-line/70 border-t border-line/70">
          {pending.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <span className="text-graphite">Link gerado em {DMH.format(new Date(l.createdAt))}{l.createdByName ? ` por ${l.createdByName}` : ""}, ainda não usado. Vale até {DM.format(new Date(l.expiresAt))}.</span>
              <Button size="sm" variant="ghost" className="text-alert" disabled={busy} aria-label={`Revogar o link gerado em ${DMH.format(new Date(l.createdAt))}`} onClick={() => revoke(l.id)}>Revogar</Button>
            </li>
          ))}
        </ul>
      )}
      <Dialog open={!!shown} onClose={() => setShown(null)} title="Link para o contador"
        description="Copie e mande para o contador agora: por segurança, este link não aparece de novo. Se perder, revogue e gere outro."
        footer={<><Button variant="secondary" onClick={() => setShown(null)}>Fechar</Button><Button onClick={copy}>Copiar</Button></>}>
        {shown && (
          <div className="flex flex-col gap-2">
            <Input aria-label="Endereço do link" readOnly value={shown.url} className="font-mono text-sm" onFocus={(e) => e.currentTarget.select()} />
            <p className="text-sm text-muted">Vale uma vez, até {DM.format(new Date(shown.expiresAt))}. Quem abrir cria um acesso com o perfil Contador.</p>
          </div>
        )}
      </Dialog>
    </section>
  );
}
