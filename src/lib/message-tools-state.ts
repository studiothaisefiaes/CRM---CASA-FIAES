/** O que a pessoa pode fazer na conversa (Task 12): permissão do perfil E função ligada em Configurações › Recursos. */
export type MessageToolsState = { reagir: boolean; editar: boolean; localizacao: boolean; contato: boolean; encaminhar: boolean; editWindowMin: number; maxDestinos: number; naoLida: boolean; acompanhar: boolean; acompanhando: boolean };
export const NO_TOOLS: MessageToolsState = { reagir: false, editar: false, localizacao: false, contato: false, encaminhar: false, editWindowMin: 0, maxDestinos: 0, naoLida: false, acompanhar: false, acompanhando: false };
export const REACTION_CHOICES = ["👍", "❤️", "🙏", "😂"] as const;
