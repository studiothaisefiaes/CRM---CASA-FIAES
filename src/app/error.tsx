"use client";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { ErrorScreen, ERROR_TEXT } from "@/components/error-screen";

/** Erro inesperado fora do sistema (login, página da cliente, app da profissional): a marca da Casa e a saída. */
export default function PublicError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return <ErrorScreen {...ERROR_TEXT} code={error.digest} action={<Button onClick={() => retry()}>Tentar de novo</Button>} />;
}
