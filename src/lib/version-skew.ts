/**
 * Erro de versão (20/10, Cati): quem estava com o CRM aberto quando subiu uma versão nova recebia "Failed to find Server Action …
 * older or newer deployment" (os botões param, o enviar trava) até dar F5. A tela antiga chama uma ação que o servidor novo não tem,
 * ou busca um pedaço de tela (chunk) que não existe mais. Puro (navegador e testes).
 */
const SKEW_TEXT = /Server Action .*(?:was not found|not found on the server)|Failed to find Server Action|older or newer deployment|Loading chunk [\w-]+ failed|Failed to load chunk|ChunkLoadError/i;

export function isVersionSkewError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const { name, message } = e as { name?: unknown; message?: unknown };
  if (name === "UnrecognizedActionError" || name === "ChunkLoadError") return true;
  return typeof message === "string" && SKEW_TEXT.test(message);
}

/** O que aparece no lugar do erro: a pessoa atualiza quando quiser, e o que estava escrevendo fica guardado. */
export const NEW_VERSION_TEXT = {
  aviso: "Versão nova do CRM.",
  botao: "Atualizar",
  enviar: "Saiu uma versão nova do CRM. Toque em Atualizar (lá em cima) e envie de novo: o texto fica guardado.",
  titulo: "Saiu uma versão nova do CRM",
  tela: "Toque em Atualizar para continuar de onde parou. O que você estava escrevendo fica guardado.",
} as const;

/** O id de build quando não há build (next dev): nunca conta como versão nova. */
export const DEV_BUILD = "dev";
