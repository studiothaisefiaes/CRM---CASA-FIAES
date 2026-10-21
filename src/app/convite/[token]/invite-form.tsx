"use client";
import { useActionState } from "react";
import { acceptInviteAction, type InviteState } from "./actions";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";

export function InviteForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState<InviteState, FormData>(acceptInviteAction.bind(null, token), {});
  return (
    <form action={action} className="flex flex-col gap-4">
      <Field label="Crie uma senha" hint="Pelo menos 8 caracteres." htmlFor="password">
        <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={8} autoFocus />
      </Field>
      <Field label="Repita a senha" htmlFor="confirm">
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required minLength={8} />
      </Field>
      {state.error && <p className="text-sm text-alert bg-alert-soft rounded-[var(--radius-control)] px-3 py-2" role="alert">{state.error}</p>}
      <Button type="submit" size="lg" loading={pending}>Criar senha e entrar</Button>
    </form>
  );
}
