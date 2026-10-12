/** Textos que mudam no ambiente de demonstração (DEMO=true). Módulo puro: servidor e navegador. */

/** Subtítulo dos Relatórios: na demonstração, deixa claro que os números são fictícios. */
export function reportsSubtitle(periodLabel: string, demo: boolean): string {
  return `${periodLabel} · ${demo ? "dados de demonstração" : "números reais do CRM"}`;
}

/** Valores iniciais do simulador. Na demonstração, um número da faixa fictícia +55 71 90000-xxxx. */
export function simulatorDefaults(demo: boolean): { phone: string; name: string; text: string } {
  return demo
    ? { phone: "71 90000-0901", name: "Rebeca Andrade", text: "Oi, bom dia! Vi no Instagram a progressiva de vocês. Qual o valor pra cabelo na altura do ombro?" }
    : { phone: "71 99981-2244", name: "Mariana Couto", text: "Oi! Vi o vídeo do preenchimento e queria saber o valor 😊" };
}
