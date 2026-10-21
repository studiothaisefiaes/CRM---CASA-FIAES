"use client";
import { BoundaryError } from "@/components/boundary-error";

/** Erro inesperado fora do sistema (login, página da cliente, app da profissional): a marca da Casa e a saída. Versão nova: ver `BoundaryError`. */
export default function PublicError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <BoundaryError error={error} retry={retry} />;
}
