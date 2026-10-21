/**
 * Virada (Fase B, Task 10): o lembrete da véspera e o Depois do atendimento saem do ChatGuru e do Avec para o CRM. Só ligam depois do
 * checklist: o do ChatGuru e o do Avec desligados, o texto conferido e um teste de verdade recebido. Sem isso a cliente recebe 2 ou 3
 * mensagens. Parte pura (servidor e tela).
 */
export type ViradaAlvo = "lembrete" | "depois";
export const VIRADA_ALVOS: readonly ViradaAlvo[] = ["lembrete", "depois"];
export const isViradaAlvo = (x: unknown): x is ViradaAlvo => x === "lembrete" || x === "depois";

/** O checklist de cada alvo, na ordem da tela. */
export const VIRADA_ITENS = {
  lembrete: ["chatguru_lembrete", "avec_confirmacao", "texto_conferido", "teste_enviado"],
  depois: ["avec_agradecimento", "texto_conferido", "teste_enviado"],
} as const;
export type ViradaItem = (typeof VIRADA_ITENS)[ViradaAlvo][number];

/** Depois do atendimento: o modo que a troca do ChatGuru para o CRM liga (o teste vale para o modo testado). */
export type ViradaModo = "agradecimento" | "pesquisa";
/** O texto de verdade com a visita de exemplo: texto (lembrete, agradecimento) ou enquete (Pesquisa de satisfação). */
export type ViradaPreview = { kind: "text"; text: string } | { kind: "poll"; text: string; options: string[] };

/** `settings.virada_<alvo>` (auditada). `quem`: o id de quem marcou por último; `quando`: ISO. */
export type Virada = { alvo: ViradaAlvo; marcados: string[]; quem: string; quando: string };
export const viradaKey = (alvo: ViradaAlvo) => `virada_${alvo}` as const;
/** `audit_log.action` do teste de verdade (entity "virada", entityId = alvo, data { phone, dealId, modo? }). */
export const TESTE_VIRADA = "teste_virada";
/** O registro em Configurações › Recursos: só o número "O teste vale por" (liga na própria tela). */
export const VIRADA_FUNCAO = "virada";
export const VIRADA_HORAS_PARAM = "horas_validade_teste";

/** Todos os itens do alvo marcados? */
export const viradaPronta = (alvo: ViradaAlvo, marcados: readonly string[]): boolean => VIRADA_ITENS[alvo].every((i) => marcados.includes(i));

export const VIRADA_FALTA: Record<ViradaAlvo, string> = {
  lembrete: "Faça a troca do ChatGuru para o CRM antes de ligar: confirme que o lembrete do ChatGuru e a confirmação do Avec estão desligados.",
  depois: "Faça a troca do ChatGuru para o CRM antes de ligar: confirme que o agradecimento do Avec está desligado.",
};
export const viradaTesteVencido = (horas: number) => `Mande o teste antes: ele vale por ${horas} ${horas === 1 ? "hora" : "horas"}.`;

/** O que liga em cada alvo (nome da tela, para os botões e avisos). */
export const VIRADA_NOME: Record<ViradaAlvo, string> = { lembrete: "Lembrete do horário", depois: "Depois do atendimento" };

/** Uma pergunta por passo. `caminho`: onde desligar no outro sistema; `sim`: o que a pessoa marca. */
export const VIRADA_PASSOS: Record<ViradaItem, { pergunta: string; ajuda: string; caminho?: string; sim: string }> = {
  chatguru_lembrete: {
    pergunta: "O lembrete do ChatGuru está desligado?",
    ajuda: "No ChatGuru, desligue o diálogo que manda o lembrete do horário. Com os dois ligados, a cliente recebe duas mensagens.",
    caminho: "No ChatGuru, desative o diálogo automático do lembrete do horário",
    sim: "Sim, está desligado",
  },
  avec_confirmacao: {
    pergunta: "A confirmação por WhatsApp do Avec está desligada?",
    ajuda: "No Avec, desligue a confirmação do horário por WhatsApp (também a da Avec IA).",
    caminho: "Configurações › Notificações › Envio de WhatsApp para clientes",
    sim: "Sim, está desligada",
  },
  avec_agradecimento: {
    pergunta: "O agradecimento por WhatsApp do Avec está desligado?",
    ajuda: "No Avec, desligue o agradecimento depois do atendimento por WhatsApp.",
    caminho: "Configurações › Notificações › Envio de WhatsApp para clientes",
    sim: "Sim, está desligado",
  },
  texto_conferido: {
    pergunta: "O texto está certo?",
    ajuda: "É assim que a cliente vai receber, com uma visita de exemplo.",
    sim: "Sim, o texto está certo",
  },
  teste_enviado: {
    pergunta: "Chegou o teste no seu WhatsApp?",
    ajuda: "O texto de verdade vai para o WhatsApp que você digitar.",
    sim: "Sim, chegou",
  },
};
