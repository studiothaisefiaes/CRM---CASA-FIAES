import { sql } from "drizzle-orm";
import { channels } from "@/server/db/schema";

/** Remover um número mantém a linha (histórico) e acrescenta este sufixo ao nome. */
export const REMOVED_SUFFIX = " (removido)";
export const isRemovedChannel = (name: string) => name.endsWith("(removido)");
/** Condição SQL: canais que não foram removidos. */
export const notRemovedChannel = sql`${channels.name} not like '%(removido)'`;
