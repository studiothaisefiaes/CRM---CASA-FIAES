import type { ReactNode } from "react";
import { localHour } from "@/lib/daily-summary";

export function greeting(now: Date) {
  const h = localHour(now);
  return h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
}

/** O topo igual nas três visões de Hoje (Resumo · Recepção · Ao vivo): a saudação e a linha da data, numa linha só, para a barra de abas não mudar de lugar. */
export function HojeTopo({ name, now, children }: { name: string; now: Date; children: ReactNode }) {
  return (
    <>
      <h1 className="font-display text-[40px] lg:text-[48px] leading-none font-light">{greeting(now)}, {name.split(" ")[0]}.</h1>
      <p className="mt-2 text-sm text-muted">{children}</p>
    </>
  );
}

export function dataPorExtenso(now: Date) {
  return now.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", timeZone: "America/Bahia" });
}
