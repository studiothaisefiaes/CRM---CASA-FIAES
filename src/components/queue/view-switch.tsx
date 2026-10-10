"use client";
import { useRouter } from "next/navigation";
import { Segmented } from "@/components/ui/segmented";

/** Fila | Quadro: as duas formas de ver os mesmos leads. A Fila é a principal; o Quadro (kanban) fica dentro de Atendimento. */
export function ViewSwitch({ current }: { current: "fila" | "quadro" }) {
  const router = useRouter();
  return (
    <Segmented label="Forma de ver os leads" value={current} onChange={(v) => router.push(v === "fila" ? "/atendimento" : "/funil")} className="flex-nowrap gap-1"
      options={[{ value: "fila", label: "Fila" }, { value: "quadro", label: "Quadro" }]} />
  );
}
