"use client";
import { useEffect } from "react";
import "./globals.css";
import { Button } from "@/components/ui/button";
import { ErrorScreen, ERROR_TEXT } from "@/components/error-screen";

/** Erro no próprio layout raiz (o resto não chegou a carregar): documento próprio, em português, com a marca. */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <html lang="pt-BR">
      <body style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
        <title>Algo deu errado · Casa Fiaes</title>
        <ErrorScreen {...ERROR_TEXT} code={error.digest} action={<Button onClick={() => retry()}>Tentar de novo</Button>} />
      </body>
    </html>
  );
}
