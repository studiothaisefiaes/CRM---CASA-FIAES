/** A mensagem é só um link, sem nenhuma palavra da cliente (Cati 31/10, Iara mandou um vídeo do YouTube). Módulo puro. */
export const SO_LINK_SQL = "^\\s*https?://\\S+\\s*$";
const SO_LINK = new RegExp(SO_LINK_SQL, "i");
export const isOnlyLink = (body: string | null | undefined) => !!body && SO_LINK.test(body);
