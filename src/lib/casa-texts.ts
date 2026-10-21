/**
 * Textos padrão da Casa para a cliente (Fase B, item 11), no estilo da Casa: "Método Fiaes®" sempre com ®, sem artigo antes de nome de
 * pessoa, coração 💛, data e hora em negrito do WhatsApp. São o "Usar o texto da Casa" de cada tela; a gestão edita em Configurações.
 * Rascunho: os definitivos vêm da Casa. Puro (servidor e tela).
 */

/**
 * Confirmação da véspera (é o texto padrão do lembrete). `{endereco}` vazio tira a linha do 📍 e a do mapa.
 * 21/10 (Cati, "chega bagunçadinho, a cliente não vê a data e a hora"): data e hora cada uma na sua linha, só elas em negrito, a data
 * por extenso com o dia da semana ("quinta-feira, 22/10") e a hora como a Casa escreve ("às 14h"); um serviço por linha; a pergunta no fim.
 */
export const CASA_CONFIRMACAO_D1 = [
  "Olá, {primeiro_nome}! 💛", "", "Passando para lembrar do seu horário amanhã na Casa Fiaes:", "",
  "📅 *{data}*", "⏰ às *{hora}*", "✨ {servicos}", "",
  "📍 {endereco}", "{mapa}", "", "Temos tolerância de 15 minutos.", "",
  "Você confirma sua presença? Se precisar remarcar, é só responder por aqui.",
].join("\n");

/** Depois do atendimento, modo Agradecimento: com o link da Avaliação no Google. */
export const CASA_AGRADECIMENTO = [
  "Oi, {primeiro_nome}! Obrigada por estar com a gente hoje na Casa Fiaes. 💛", "",
  "Se puder, conte como foi no Google. Sua avaliação ajuda muito: {link_google}", "", "E quando quiser voltar, pergunte pelos nossos Combos Especiais.",
].join("\n");

/** Depois do atendimento, modo Pesquisa de satisfação: o título da enquete de 1 a 5. */
export const CASA_PESQUISA_TITULO = "{primeiro_nome}, de 1 a 5, como foi seu atendimento hoje na Casa Fiaes?";

/** Resposta à nota alta da Pesquisa de satisfação. */
export const CASA_NOTA_ALTA = "Que alegria, {primeiro_nome}! 💛 Se puder, conte como foi no Google: {link_google}";
