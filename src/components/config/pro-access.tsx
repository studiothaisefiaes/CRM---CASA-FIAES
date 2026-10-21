"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { inviteProAction, regenerateProInviteAction, revokeProAccessAction } from "@/app/(app)/config/profissionais/acesso-actions";
import type { ProAccess } from "@/server/domain/pro/access";

const BR = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Bahia", day: "2-digit", month: "2-digit" });
type Link = { url: string; text: string };

/** "Acesso ao app": a gestão cria o acesso e copia o link do convite. Nada é enviado (decisão 2). */
export function ProAccessPanel({ professionalId, name, access }: { professionalId: string; name: string; access: ProAccess | null }) {
  const [email, setEmail] = useState(access?.email ?? "");
  const [link, setLink] = useState<Link | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [pending, start] = useTransition();
  const toast = useToast();
  const copy = async (s: string, ok: string) => { try { await navigator.clipboard.writeText(s); toast(ok); } catch { toast("Não deu para copiar. Selecione o texto e copie.", "error"); } };
  const got = (r: { ok: true; data?: Link } | { ok: false; error: string }) => { if (!r.ok) toast(r.error, "error"); else if (r.data) setLink(r.data); };
  const status = access?.active
    ? `${access.enteredAt ? `Entrou em ${BR.format(new Date(access.enteredAt))}` : access.invitePending && access.inviteExpiresAt ? `Ainda não entrou (o convite vale até ${BR.format(new Date(access.inviteExpiresAt))})` : "Ainda não entrou"}`
      + ` · Avisos no celular: ${access.devices ? `ligados (${access.devices} ${access.devices === 1 ? "aparelho" : "aparelhos"})` : "ainda não ligados"}`
    : access ? "Acesso tirado. Para devolver, use o e-mail dela de novo." : null;
  return (
    <section aria-label={`Acesso ao app de ${name}`} className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-line bg-paper-2/60 p-3">
      <p className="text-sm font-medium">Acesso ao app</p>
      {status && <p className="text-sm text-graphite">{status}</p>}
      {!access?.active && (
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); start(async () => got(await inviteProAction(professionalId, email))); }}>
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm text-graphite">E-mail dela
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="o e-mail que ela usa no celular" autoComplete="off" required />
          </label>
          <Button type="submit" loading={pending}>{access ? "Dar acesso de novo" : "Criar acesso"}</Button>
        </form>
      )}
      {access?.active && (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" loading={pending} onClick={() => start(async () => got(await regenerateProInviteAction(professionalId)))}>Gerar novo link</Button>
          {confirmRevoke ? (
            <>
              <Button variant="ghost" onClick={() => setConfirmRevoke(false)}>Voltar</Button>
              <Button variant="danger" loading={pending} onClick={() => start(async () => {
                const r = await revokeProAccessAction(professionalId);
                if (r.ok) { setConfirmRevoke(false); setLink(null); toast("Acesso tirado: a sessão dela caiu"); } else toast(r.error, "error");
              })}>Sim, tirar acesso</Button>
            </>
          ) : <Button variant="secondary" onClick={() => setConfirmRevoke(true)}>Tirar acesso</Button>}
        </div>
      )}
      {link && (
        <div role="status" className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-gold/40 bg-gold-soft p-3">
          <p className="text-sm text-ink">Link do convite (vale 7 dias). <b className="font-semibold">Nada foi enviado</b>: copie e mande você mesma.</p>
          <code className="break-all text-xs">{link.url}</code>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => copy(link.url, "Link copiado")}>Copiar link do convite</Button>
            <Button size="sm" variant="secondary" onClick={() => copy(link.text, "Texto copiado")}>Copiar com a sugestão de texto</Button>
          </div>
          <p className="text-sm text-graphite">{link.text}</p>
        </div>
      )}
    </section>
  );
}
