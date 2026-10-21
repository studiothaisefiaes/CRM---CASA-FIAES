"use client";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { ErrorScreen, ERROR_TEXT } from "@/components/error-screen";
import { isVersionSkewError, NEW_VERSION_TEXT } from "@/lib/version-skew";
import { announceNewVersion } from "@/components/shell/version-state";

/**
 * O que as telas de erro (error.tsx, global-error.tsx) mostram. Erro de versão (20/10: "Failed to find Server Action … older or newer
 * deployment" depois de subir versão nova) não é "Algo deu errado": diz que saiu versão nova e o Atualizar recarrega a mesma página
 * (mesma conversa; o texto da caixa de mensagem fica guardado). Os outros erros seguem com "Tentar de novo" e o código.
 */
export function BoundaryError({ error, retry, inShell = false }: { error: Error & { digest?: string }; retry: () => void; inShell?: boolean }) {
  const skew = isVersionSkewError(error);
  useEffect(() => { if (skew) announceNewVersion(); else console.error(error); }, [error, skew]);
  if (skew) {
    return <ErrorScreen title={NEW_VERSION_TEXT.titulo} text={NEW_VERSION_TEXT.tela} inShell={inShell}
      action={<Button onClick={() => window.location.reload()}>{NEW_VERSION_TEXT.botao}</Button>} />;
  }
  return <ErrorScreen {...ERROR_TEXT} inShell={inShell} code={error.digest} action={<Button onClick={() => retry()}>Tentar de novo</Button>} />;
}
