"use client";
import { useActionState } from "react";
import { motion } from "motion/react";
import { login, type LoginState } from "./actions";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { EASE } from "@/lib/motion";

export function LoginForm({ voltar }: { voltar?: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, {});
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="voltar" value={voltar ?? ""} />
      <Field label="E-mail" htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="email" required defaultValue={state.email} autoFocus aria-invalid={!!state.error} />
      </Field>
      <Field label="Senha" htmlFor="password">
        <Input id="password" name="password" type="password" autoComplete="current-password" required aria-invalid={!!state.error} />
      </Field>
      {state.error && (
        <motion.p key={state.error} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: [6, -4, 0] }} transition={{ duration: 0.35, ease: EASE }}
          className="text-sm text-alert bg-alert-soft rounded-[var(--radius-control)] px-3 py-2" role="alert">
          {state.error}
        </motion.p>
      )}
      <Button type="submit" size="lg" loading={pending} className="mt-2">Entrar</Button>
    </form>
  );
}
