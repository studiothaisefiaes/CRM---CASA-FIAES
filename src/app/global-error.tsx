"use client";
import "./globals.css";
import { BoundaryError } from "@/components/boundary-error";

/** Erro no próprio layout raiz (o resto não chegou a carregar): documento próprio, em português, com a marca. */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="pt-BR">
      <body style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
        <title>Algo deu errado · Casa Fiaes</title>
        <BoundaryError error={error} retry={retry} />
      </body>
    </html>
  );
}
