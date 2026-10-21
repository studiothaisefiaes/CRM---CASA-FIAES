"use client";
import { BoundaryError } from "@/components/boundary-error";

/**
 * Erro inesperado numa tela do sistema: o menu continua, a tela diz o que fazer e o código vai para a gestão (a mensagem técnica, não).
 * Versão nova do CRM no meio do uso (20/10): "Saiu uma versão nova do CRM" com Atualizar, ver `BoundaryError`.
 */
export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <BoundaryError error={error} retry={retry} inShell />;
}
