"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import type { Approval } from "@/app/(app)/caixa/actions";

/**
 * Aprovação da gestão ali mesmo (o mesmo fluxo do fechamento do caixa): a gestão aprova com um clique; a equipe chama alguém da gestão,
 * que digita e-mail e senha. Usada na cortesia e no desconto acima do limite da Casa (QA r58, I-11).
 */
export function ApprovalBox({ message, canGerir, pending, error, onApprove, onCancel, confirmLabel = "Aprovar e salvar" }: {
  message: string; canGerir: boolean; pending: boolean; error?: string | null; onApprove: (a: NonNullable<Approval>) => void; onCancel: () => void; confirmLabel?: string;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  return (
    <section aria-label="Aprovação da gestão" className="flex flex-col gap-3 rounded-[var(--radius-control)] border border-gold/50 bg-gold-soft/40 p-3">
      <p className="text-sm font-medium text-gold-ink">{message}</p>
      {error && <p role="alert" className="text-sm text-alert">{error}</p>}
      {canGerir ? (
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>Voltar</Button>
          <Button variant="gold" loading={pending} onClick={() => onApprove({ self: true })}>Aprovar</Button>
        </div>
      ) : (
        <>
          <p className="text-sm text-graphite">Chame alguém da gestão para aprovar aqui, com o login dela.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm text-graphite">E-mail da gestão<Input type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
            <label className="flex flex-col gap-1 text-sm text-graphite">Senha da gestão<Input type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={onCancel}>Voltar</Button>
            <Button variant="gold" loading={pending} disabled={!email.trim() || !password} onClick={() => onApprove({ email: email.trim(), password })}>{confirmLabel}</Button>
          </div>
        </>
      )}
    </section>
  );
}
