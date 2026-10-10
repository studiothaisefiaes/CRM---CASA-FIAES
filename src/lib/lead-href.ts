/** Único lugar que sabe para onde "abrir o lead" aponta: a Fila. No celular, /atendimento?lead=ID leva a /atendimento/ID. */
export const leadHref = (dealId: string | null | undefined) => (dealId ? `/atendimento?lead=${dealId}` : "/atendimento");

/** A conversa em tela cheia (/atendimento/ID e /atendimento/ID/cliente): no celular não tem barra superior nem inferior do app, o cabeçalho do lead já traz o voltar. */
export const isConversationPath = (path: string | null | undefined): boolean => !!path && /^\/atendimento\/[0-9a-f-]{36}(\/cliente)?\/?$/i.test(path);
