import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { phoneSearchVariants } from "@/lib/phone-search";
import { contacts } from "../../db/schema";
import { zInstanteSaida } from "../rota";

/** `%` e `_` digitados viram texto (no LIKE eles seriam curinga). */
export const likeDe = (q: string) => `%${q.trim().toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/**
 * Busca por nome ou telefone, como a Fila e Clientes: telefone em qualquer formato (com ou sem +55, DDD, máscara, o 9 da frente),
 * ver `phoneSearchVariants`. Menos de 3 dígitos = só nome.
 */
export function buscaContato(q: string): SQL {
  const vs = phoneSearchVariants(q);
  const tel = vs.length ? sql.join(vs.map((v) => sql`${contacts.phoneE164} like ${`%${v}%`}`), sql` or `) : sql`false`;
  return sql`(lower(coalesce(${contacts.name}, '')) like ${likeDe(q)} or ${tel})`;
}

/** Telefone para fora: o número em E.164; contato sem número de WhatsApp (pessoa no mesmo número, número oculto) = null. */
export const telefoneDe = (p: string) => (p.startsWith("+") ? p : null);

export const zContatoResumo = z.object({ id: z.uuid(), nome: z.string().nullable(), telefone: z.string().nullable() });
export const zPessoa = z.object({ id: z.uuid(), nome: z.string() }).nullable();
export const zInstanteOuNulo = zInstanteSaida.nullable();
export const zBool = z.enum(["true", "false", "1", "0", "sim", "nao"]).transform((v) => v === "true" || v === "1" || v === "sim");
