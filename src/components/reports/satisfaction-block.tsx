import type { SatisfactionNumbers } from "@/server/domain/satisfaction";
import { DataList, type Col } from "./data-list";
import { Fig } from "./fig";
import { Muted, Section } from "./section";

/** Nota média com uma casa decimal ("4,3"). */
const nota = (n: number | null) => (n == null ? "—" : n.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }));

/** Relatórios › Salão (Fase B, Task 9): respondidas de enviadas, média e por profissional. Só chega aqui com `relatorios.equipe`. */
export function SatisfactionBlock({ d }: { d: SatisfactionNumbers }) {
  type R = SatisfactionNumbers["byProfessional"][number];
  const cols: Col<R>[] = [
    { key: "n", label: "Profissional", render: (p) => p.name },
    { key: "r", label: "Respostas", align: "right", render: (p) => p.answered },
    { key: "m", label: "Média", align: "right", render: (p) => nota(p.average) },
  ];
  return (
    <Section id="salao-pesquisa" title="Pesquisa de satisfação" lead="Notas de 1 a 5 depois do atendimento, no período." legend="salaoPesquisa">
      {d.asked === 0 ? <Muted>Nenhuma Pesquisa de satisfação enviada no período.</Muted> : (
        <>
          <dl className="grid grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4">
            <Fig label="Respondidas" value={`${d.answered} de ${d.asked}`} />
            <Fig label="Nota média" value={nota(d.average)} />
          </dl>
          {d.byProfessional.length === 0 ? <Muted>Nenhuma resposta no período.</Muted>
            : <div className="mt-6"><DataList rows={d.byProfessional} cols={cols} rowKey={(p) => p.id} caption="Pesquisa de satisfação por profissional" /></div>}
        </>
      )}
    </Section>
  );
}
