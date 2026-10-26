/**
 * Tamanho do corpo dos pedidos da API v1 (revisão de segurança 26/10). Sem dependências: o src/proxy.ts também usa.
 * - Qualquer corpo: até 17 MB (o arquivo de até 16 MB + a folga do multipart), pelo Content-Length que o proxy confere.
 * - JSON: até 64 KB (o maior campo de texto da API é a mensagem de 4.000 caracteres).
 */
export const API_MAX_BYTES = 17 * 1024 * 1024;
export const JSON_MAX_BYTES = 64 * 1024;
export const TEXTO_CORPO_GRANDE = "Corpo grande demais para a API (máximo 17 MB; arquivo até 16 MB).";
export const TEXTO_JSON_GRANDE = "Corpo JSON grande demais (máximo 64 KB).";
export const TEXTO_SEM_TAMANHO = "Mande o cabeçalho Content-Length: a API não aceita corpo enviado em pedaços (chunked).";
