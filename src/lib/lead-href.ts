import { isUuid } from "./uuid";

/** Único lugar que sabe para onde "abrir o lead" aponta: a Fila. No celular, /atendimento?lead=ID leva a /atendimento/ID. */
export const leadHref = (dealId: string | null | undefined) => (dealId ? `/atendimento?lead=${dealId}` : "/atendimento");

/** A conversa em tela cheia (/atendimento/ID e /atendimento/ID/cliente): no celular não tem barra superior nem inferior do app, o cabeçalho do lead já traz o voltar. */
export const isConversationPath = (path: string | null | undefined): boolean => isUuid(path?.match(/^\/atendimento\/([^/]+)(?:\/cliente)?\/?$/)?.[1]);

/** Único lugar que sabe onde fica a ficha da cliente (Lote 2: nome e foto abrem a ficha em todas as telas). */
export const contactHref = (contactId: string) => `/contatos/${contactId}`;
