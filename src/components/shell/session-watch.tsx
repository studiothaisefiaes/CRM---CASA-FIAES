"use client";
import { useEffect, useState } from "react";
import { RenewSession } from "@/components/pro/renew-session";

/** Evento que o tempo real dispara quando a sessão caiu (stream/poll recebeu 401 e /api/sessao confirmou). */
export const SESSAO_CAIU = "cf-sessao-caiu";

/**
 * Sessão da equipe (03/11): renova uma vez por dia ao abrir o CRM (antes só o app da profissional renovava, e a sessão vencia no
 * 30º dia com a tela aberta e muda). Se cair mesmo assim, uma faixa fixa avisa e leva ao login voltando para a mesma tela.
 */
export function SessionWatch() {
  const [caiu, setCaiu] = useState(false);
  useEffect(() => {
    const on = () => setCaiu(true);
    window.addEventListener(SESSAO_CAIU, on);
    return () => window.removeEventListener(SESSAO_CAIU, on);
  }, []);
  const voltar = typeof window === "undefined" ? "/" : window.location.pathname + window.location.search;
  return (
    <>
      <RenewSession />
      {caiu && (
        <div role="alert" className="fixed inset-x-0 top-0 z-[100] flex flex-wrap items-center justify-center gap-3 bg-red-700 px-4 py-3 text-sm font-medium text-white shadow-lg">
          <span>Sua sessão terminou: as mensagens novas não estão chegando nesta tela.</span>
          <a href={`/login?voltar=${encodeURIComponent(voltar)}`} className="rounded-md bg-white px-3 py-1 font-semibold text-red-800">Entrar de novo</a>
        </div>
      )}
    </>
  );
}
