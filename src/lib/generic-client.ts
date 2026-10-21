import { sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

/**
 * A CLIENTE PADRÃO do Avec (17/10): a cliente genérica que o Avec usa para quem não foi cadastrada (balcão, encaixe sem ficha). Nunca
 * tem contato (726 horários em produção, nenhum ligado a ficha) e, tratada como cliente, virava visita, baixa pendente, lembrete e número.
 * Fica na grade (ocupa a profissional); sai do lembrete, do Sem baixa, do Hoje (quadro, Agenda de hoje, Na Casa e Ao vivo), da visita,
 * da comanda pelo horário e dos relatórios da agenda.
 */
const unaccent = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

/** O nome é o da cliente genérica? ("CLIENTE PADRÃO", "Cliente Padrao", "cliente padrão (x)"). */
export function isGenericClientName(name: string | null | undefined): boolean {
  return /^cliente padrao(\b|$)/.test(unaccent(String(name ?? "")).toLowerCase().replace(/\s+/g, " ").trim());
}

/** O horário é da cliente genérica: pelo nome da ficha, quando tem; sem ficha, pelo nome que veio do Avec. */
export function isGenericClient(a: { contactId?: string | null; clientName?: string | null; name?: string | null }): boolean {
  return isGenericClientName(a.contactId ? (a.name ?? a.clientName) : (a.clientName ?? a.name));
}

/** Regex do Postgres para o mesmo nome (sem diferenciar maiúsculas; com ou sem til). */
export const GENERIC_NAME_RE = String.raw`^\s*cliente\s+padr(a|ã|Ã)o(\M|$)`;

/** SQL: o horário (colunas `contact_id`/`client_name`) é da CLIENTE PADRÃO sem ficha. Com ficha, use o nome do contato (`contactName`). */
export function genericClientSql(t: { contactId: AnyPgColumn | SQL; clientName: AnyPgColumn | SQL }, contactName?: AnyPgColumn | SQL): SQL {
  return contactName
    ? sql`(coalesce(${contactName}, ${t.clientName}, '') ~* ${GENERIC_NAME_RE})`
    : sql`(${t.contactId} is null and coalesce(${t.clientName}, '') ~* ${GENERIC_NAME_RE})`; // sem nome nenhum: não é ela (e nunca NULL)
}
