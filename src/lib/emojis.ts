/**
 * Emojis do seletor da conversa, por categoria, com nomes em português para a busca.
 * Lista enxuta e pensada para o salão (beleza, agradecimento, festa), não o catálogo inteiro do Unicode.
 */
export type EmojiCategory = { key: string; label: string; icon: string; items: [emoji: string, nomes: string][] };

export const EMOJI_CATEGORIES: EmojiCategory[] = [
  { key: "rostos", label: "Carinhas", icon: "😀", items: [
    ["😀", "feliz sorriso"], ["😃", "alegre"], ["😄", "rindo"], ["😁", "sorrisão"], ["😆", "gargalhada"], ["😅", "ufa"], ["😂", "chorando de rir"], ["🤣", "rolando de rir"],
    ["😊", "sorriso fofo"], ["😇", "anjo"], ["🙂", "leve sorriso"], ["😉", "piscadinha"], ["😍", "apaixonada"], ["🥰", "amor carinho"], ["😘", "beijo"], ["😗", "beijinho"],
    ["😋", "delícia"], ["😛", "língua"], ["🤩", "encantada"], ["🥳", "festa comemorando"], ["😎", "estilosa óculos"], ["🤗", "abraço"], ["🤭", "ops risadinha"], ["🤔", "pensando"],
    ["🙄", "revirando olhos"], ["😏", "sorrisinho"], ["😌", "aliviada"], ["😴", "sono"], ["🥺", "por favor pidona"], ["😢", "triste choro"], ["😭", "chorando muito"], ["😮", "surpresa"],
    ["😱", "susto"], ["😳", "envergonhada"], ["🙃", "de cabeça para baixo"], ["😬", "nervosa"], ["😮‍💨", "suspiro"], ["🥹", "emocionada"], ["😤", "brava"], ["🫶", "coração com as mãos"],
  ] },
  { key: "gestos", label: "Gestos", icon: "👍", items: [
    ["👍", "ok joinha positivo"], ["👎", "negativo"], ["👏", "palmas parabéns"], ["🙌", "comemorar"], ["🙏", "obrigada por favor amém"], ["🤝", "combinado acordo"], ["👋", "oi tchau"], ["✌️", "paz vitória"],
    ["🤞", "dedos cruzados torcendo"], ["👌", "perfeito"], ["🤌", "chique"], ["💪", "força"], ["👀", "olhos olhando"], ["☝️", "atenção um"], ["👉", "aqui apontando"], ["✋", "pare espera"],
    ["🫡", "certo entendido"], ["🤙", "me liga"], ["💁‍♀️", "atendente informação"], ["🙋‍♀️", "eu"], ["🤷‍♀️", "não sei"], ["🙆‍♀️", "tudo certo"], ["🙅‍♀️", "não"], ["💃", "dança alegria"],
  ] },
  { key: "coracoes", label: "Corações", icon: "❤️", items: [
    ["❤️", "coração vermelho amor"], ["🩷", "coração rosa"], ["🧡", "coração laranja"], ["💛", "coração amarelo"], ["💚", "coração verde"], ["🩵", "coração azul claro"], ["💙", "coração azul"], ["💜", "coração roxo"],
    ["🤎", "coração marrom"], ["🖤", "coração preto"], ["🤍", "coração branco"], ["💖", "coração brilhando"], ["💗", "coração crescendo"], ["💓", "coração batendo"], ["💕", "dois corações"], ["💞", "corações girando"],
    ["💘", "coração flecha"], ["💝", "coração presente"], ["❣️", "exclamação coração"], ["💯", "cem perfeito"], ["✨", "brilho"], ["⭐", "estrela"], ["🌟", "estrela brilhante"], ["💫", "tontura brilho"],
  ] },
  { key: "beleza", label: "Beleza", icon: "💇‍♀️", items: [
    ["💇‍♀️", "corte cabelo"], ["💆‍♀️", "massagem tratamento"], ["💅", "unha manicure"], ["💄", "batom maquiagem"], ["💋", "boca beijo"], ["👩‍🦰", "ruiva cabelo"], ["👱‍♀️", "loira"], ["👩‍🦱", "cacheada cachos"],
    ["👩‍🦳", "grisalha"], ["🧖‍♀️", "spa"], ["🪮", "pente"], ["✂️", "tesoura corte"], ["🪞", "espelho"], ["💎", "diamante luxo"], ["👑", "coroa rainha"], ["🌸", "flor"],
    ["🧴", "creme produto"], ["🧼", "sabonete"], ["🫧", "bolhas lavagem"], ["💐", "buquê flores"], ["👰‍♀️", "noiva casamento"], ["👗", "vestido"], ["👠", "salto"], ["👜", "bolsa"],
  ] },
  { key: "festa", label: "Festa e datas", icon: "🎉", items: [
    ["🎉", "festa parabéns"], ["🎊", "confete"], ["🎂", "bolo aniversário"], ["🎁", "presente"], ["🎈", "balão"], ["🥂", "brinde"], ["🍾", "champanhe"], ["🎀", "laço"],
    ["📅", "agenda data"], ["🗓️", "calendário"], ["⏰", "horário despertador"], ["🕐", "hora"], ["📍", "endereço local"], ["📞", "telefone"], ["📲", "celular mensagem"], ["💳", "cartão pagamento"],
    ["💰", "dinheiro"], ["🧾", "recibo"], ["✅", "confirmado certo"], ["❌", "cancelado errado"], ["⚠️", "atenção aviso"], ["❗", "importante"], ["❓", "dúvida pergunta"], ["🔥", "fogo top"],
  ] },
  { key: "natureza", label: "Natureza", icon: "🌷", items: [
    ["🌷", "tulipa"], ["🌹", "rosa"], ["🌺", "hibisco"], ["🌻", "girassol"], ["🌼", "margarida"], ["🍀", "trevo sorte"], ["🌿", "folha erva"], ["🌴", "palmeira praia"],
    ["☀️", "sol"], ["🌤️", "sol nuvem"], ["🌧️", "chuva"], ["🌈", "arco-íris"], ["🌙", "lua noite"], ["🌊", "mar onda"], ["🦋", "borboleta"], ["🐝", "abelha"],
  ] },
  { key: "comida", label: "Comida", icon: "☕", items: [
    ["☕", "café"], ["🍵", "chá"], ["🥤", "bebida"], ["🍓", "morango"], ["🍫", "chocolate"], ["🍰", "bolo fatia"], ["🧁", "cupcake"], ["🍷", "vinho"],
    ["🍕", "pizza"], ["🍔", "hambúrguer"], ["🥗", "salada"], ["🍉", "melancia"], ["🍇", "uva"], ["🥥", "coco"], ["🍦", "sorvete"], ["🍿", "pipoca"],
  ] },
];

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Busca pelo nome em português (sem acento). Vazio: nada. */
export function searchEmojis(q: string): string[] {
  const t = norm(q.trim());
  if (!t) return [];
  return EMOJI_CATEGORIES.flatMap((c) => c.items).filter(([, nomes]) => norm(nomes).includes(t)).map(([e]) => e);
}

/** Põe o emoji onde o cursor está (substituindo a seleção) e devolve o texto novo e a posição do cursor depois dele. */
export function insertAt(text: string, emoji: string, start: number, end: number): { text: string; caret: number } {
  const s = Math.max(0, Math.min(start, text.length)), e = Math.max(s, Math.min(end, text.length));
  return { text: text.slice(0, s) + emoji + text.slice(e), caret: s + emoji.length };
}

const RECENT_MAX = 16;
/** Recentes: o último usado vai para a frente, sem repetir, no máximo 16. */
export const pushRecent = (list: string[], emoji: string) => [emoji, ...list.filter((e) => e !== emoji)].slice(0, RECENT_MAX);
