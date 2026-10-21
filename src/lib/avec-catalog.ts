/**
 * Relatórios do Avec organizados (Lote 3): os 11 principais em cartões no topo, os outros por assunto (seções recolhíveis), o selo
 * "Virou dado no CRM" (o relatório alimentou agenda, contatos ou vendas: `applied`), os vazios num grupo no fim e os tipos repetidos
 * (mesmas linhas e mesmo período, no mesmo assunto) juntados. Puro: só reorganiza a lista que `listAvecReports` já devolve.
 */
export type AvecReportLite = { id: string; title: string; rowCount: number; dateFrom: string | null; dateTo: string | null; importedAt: string; applied: Record<string, number> };
export type AvecType<T extends AvecReportLite = AvecReportLite> = {
  title: string; latest: T; items: T[]; applied: boolean; empty: boolean;
  /** Outros tipos com as mesmas linhas e o mesmo período (provável repetição do Avec). */ also: { title: string; id: string }[];
};
export type SectionKey = "agenda" | "vendas" | "profissionais" | "financeiro" | "clientes" | "produtos" | "notas" | "pacotes" | "outros";
export type AvecCatalog<T extends AvecReportLite = AvecReportLite> = {
  principais: { title: string; type: AvecType<T> | null }[];
  secoes: { key: SectionKey; label: string; types: AvecType<T>[] }[];
  vazios: AvecType<T>[];
};

export const PRINCIPAIS = [
  "Faturamento por dia", "Comissão por profissional", "Faturamento por serviço", "Recebimentos por forma de pagamento", "Reservas", "Cancelamentos",
  "Lista de espera", "Clientes sumidas", "Retorno sugerido", "Aniversariantes", "Pacotes das clientes",
] as const;
export const SECTION_ORDER: SectionKey[] = ["agenda", "vendas", "profissionais", "financeiro", "clientes", "produtos", "notas", "pacotes", "outros"];
export const SECTION_LABEL: Record<SectionKey, string> = {
  agenda: "Agenda", vendas: "Vendas e comandas", profissionais: "Profissionais e comissões", financeiro: "Financeiro e caixa", clientes: "Clientes",
  produtos: "Produtos e estoque", notas: "Notas fiscais", pacotes: "Pacotes e fidelidade", outros: "Outros",
};
/** A primeira regra que casa decide (a ordem importa: "Faturamento por profissional" é de Profissionais, não de Vendas). */
const RULES: [SectionKey, RegExp][] = [
  ["agenda", /reserva|cancelamento|lista de espera|bloqueio|agenda|agendamento|ocupa[cç][aã]o/i],
  ["pacotes", /pacote|fidelidade|vale|cupo|promo[cç]/i],
  ["profissionais", /comiss|profissiona|repasse|recibo|caixinha|assistente|cargo/i],
  ["notas", /nota|nfc|nfs|fiscal/i],
  ["produtos", /produto|estoque|invent[aá]rio|marca|reposi[cç][aã]o|pedidos de compra/i],
  ["financeiro", /pagamento|recebimento|taxa|despesa|contas a pagar|caixa|lan[cç]amento|cr[eé]dito|d[ií]vida|cheque|bandeira|split|movimenta/i],
  ["clientes", /^clientes?\b|aniversari|conheceu|etiqueta|avalia|g[eê]nero|bairro|retorno sugerido|sumidas|visitas por|campos extras das clientes/i],
  ["vendas", /comanda|iten|venda|faturamento|servi[cç]o|lucr|margem|custo|categoria|ticket|totais|tipos de/i],
];
export const sectionOf = (title: string): SectionKey => RULES.find(([, re]) => re.test(title))?.[0] ?? "outros";

const byTitle = (a: { title: string }, b: { title: string }) => a.title.localeCompare(b.title, "pt-BR");

/** Junta os tipos com as mesmas linhas e o mesmo período (o primeiro pelo nome fica; os outros vão em `also`). */
function mergeRepeated<T extends AvecReportLite>(types: AvecType<T>[]): AvecType<T>[] {
  const out: AvecType<T>[] = [];
  for (const t of [...types].sort(byTitle)) {
    const twin = out.find((o) => o.latest.rowCount > 0 && o.latest.rowCount === t.latest.rowCount && o.latest.dateFrom === t.latest.dateFrom && o.latest.dateTo === t.latest.dateTo);
    if (twin) { twin.also.push({ title: t.title, id: t.latest.id }); twin.applied ||= t.applied; } else out.push({ ...t, also: [] });
  }
  return out;
}

export function organizeAvecReports<T extends AvecReportLite>(list: T[]): AvecCatalog<T> {
  const by = new Map<string, T[]>();
  for (const r of list) by.set(r.title, [...(by.get(r.title) ?? []), r]);
  const types: AvecType<T>[] = [...by.entries()].map(([title, items]) => {
    const sorted = [...items].sort((a, b) => (b.dateTo ?? "").localeCompare(a.dateTo ?? "") || b.importedAt.localeCompare(a.importedAt));
    return {
      title, latest: sorted[0], items: sorted, also: [],
      applied: items.some((i) => Object.values(i.applied ?? {}).some((n) => n > 0)), empty: items.every((i) => i.rowCount === 0),
    };
  });
  const principal = new Set<string>(PRINCIPAIS);
  const rest = types.filter((t) => !principal.has(t.title));
  return {
    principais: PRINCIPAIS.map((title) => ({ title, type: types.find((t) => t.title === title) ?? null })),
    secoes: SECTION_ORDER.map((key) => ({ key, label: SECTION_LABEL[key], types: mergeRepeated(rest.filter((t) => !t.empty && sectionOf(t.title) === key)) }))
      .filter((s) => s.types.length > 0),
    vazios: rest.filter((t) => t.empty).sort(byTitle),
  };
}
