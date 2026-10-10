/** Tipos de mensagem da cliente que não abrem espera de resposta: figurinha ou reação de "obrigada" só encerra a conversa. */
export const NON_OPENING_KINDS = ["sticker", "reaction"] as const;
export const closesConversation = (kind?: string) => !!kind && (NON_OPENING_KINDS as readonly string[]).includes(kind);
