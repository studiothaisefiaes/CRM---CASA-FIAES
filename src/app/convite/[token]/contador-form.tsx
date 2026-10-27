"use client";
import { useActionState } from "react";
import { acceptContadorLinkAction, type ContadorLinkState } from "./actions";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";

/** Link do contador: nome, e-mail e senha (as mesmas regras do convite). Depois de um erro, nome e e-mail continuam preenchidos. */
export function ContadorLinkForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState<ContadorLinkState, FormData>(acceptContadorLinkAction.bind(null, token), {});
  return (
    <form action={action} className="flex flex-col gap-4">
      <Field label="Seu nome" htmlFor="name">
        <Input id="name" name="name" autoComplete="name" required minLength={2} maxLength={80} defaultValue={state.values?.name} autoFocus />
      </Field>
      <Field label="Seu e-mail" hint="É com ele que você entra no CRM." htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="email" required maxLength={200} defaultValue={state.values?.email} />
      </Field>
      <Field label="Crie uma senha" hint="Pelo menos 8 caracteres." htmlFor="password">
        <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={8} />
      </Field>
      <Field label="Repita a senha" htmlFor="confirm">
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required minLength={8} />
      </Field>
      {state.error && <p className="text-sm text-alert bg-alert-soft rounded-[var(--radius-control)] px-3 py-2" role="alert">{state.error}</p>}
      <Button type="submit" size="lg" loading={pending}>Criar acesso e entrar</Button>
    </form>
  );
}
