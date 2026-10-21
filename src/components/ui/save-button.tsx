"use client";
import { Button, type ButtonProps } from "./button";
import { IconCheck } from "@/components/icons";

/**
 * Salvar (dsgfix, r68 #10): sem mudança não existe botão cinza parado; aparece "Tudo salvo". Com mudança, é o botão preto.
 * Mudança que ainda não pode ser salva diz o porquê (`blocked`) ao lado do botão, nunca um cinza sem explicação.
 */
export function SaveButton({ dirty, blocked, savedText = "Tudo salvo", children = "Salvar", ...rest }: ButtonProps & {
  dirty: boolean; blocked?: string | null; savedText?: string;
}) {
  if (!dirty && !rest.loading) return savedText ? <span role="status" className="inline-flex h-10 items-center gap-1.5 text-sm text-muted"><IconCheck size={14} aria-hidden />{savedText}</span> : null;
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-3">
      {blocked && <span className="text-sm text-alert" role="alert">{blocked}</span>}
      <Button {...rest} disabled={!!blocked || rest.disabled}>{children}</Button>
    </span>
  );
}
