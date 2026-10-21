"use client";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { ErrorScreen, ERROR_TEXT } from "@/components/error-screen";

/** Erro inesperado numa tela do sistema: o menu continua, a tela diz o que fazer e o código vai para a gestão (a mensagem técnica, não). */
export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return <ErrorScreen {...ERROR_TEXT} inShell code={error.digest} action={<Button onClick={() => retry()}>Tentar de novo</Button>} />;
}
