"use client";
import { useRouter } from "next/navigation";
import { Segmented } from "@/components/ui/segmented";

type View = "fila" | "quadro" | "jornada";
const HREF: Record<View, string> = { fila: "/atendimento", quadro: "/funil", jornada: "/jornada" };

/** Fila | Quadro | Jornada: formas de ver os mesmos leads. A Fila é a principal; o Quadro (kanban) é a secundária; a Jornada é só da gestão (`journey`). */
export function ViewSwitch({ current, journey = false }: { current: View; journey?: boolean }) {
  const router = useRouter();
  return (
    <Segmented<View> label="Forma de ver os leads" value={current} onChange={(v) => router.push(HREF[v])} className="flex-nowrap gap-1"
      options={[{ value: "fila", label: "Fila" }, { value: "quadro", label: "Quadro" }, ...(journey ? [{ value: "jornada" as const, label: "Jornada" }] : [])]} />
  );
}
