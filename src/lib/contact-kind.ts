/** Tipo do contato (0054, 17/10). Ver `contacts.kind` em src/server/db/schema.ts. */
export const CONTACT_KINDS = ["cliente", "equipe", "fornecedor", "spam"] as const;
export type ContactKind = (typeof CONTACT_KINDS)[number];

export const KIND_LABEL: Record<ContactKind, string> = { cliente: "Cliente", equipe: "Equipe", fornecedor: "Fornecedor", spam: "Spam" };

/** O que acontece com a conversa ao marcar (texto curto do menu "Marcar como…"). */
export const KIND_HINT: Record<ContactKind, string> = {
  cliente: "Volta para a Fila de atendimento",
  equipe: "Número da Casa: lista Equipe, fora das etapas e dos números",
  fornecedor: "Lista Fornecedores; conversa resolvida, fora dos números",
  spam: "Sai da Fila e fica guardado (recuperável)",
};

/** Fornecedor e Spam: fora da Fila, dos números e relatórios, e sem mensagem automática nem lembrete. */
export const isOutOfService = (k: ContactKind | null | undefined) => k === "fornecedor" || k === "spam";
