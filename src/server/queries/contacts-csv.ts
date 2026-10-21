import { sql } from "drizzle-orm";
import { originLabel } from "@/lib/origin-label";
import { db } from "../db";
import { tagsOf } from "../domain/tags";
import { listContacts, type ContactListOpts, type ContactRow } from "./contacts";
import { toCsv } from "../reports/common";
import { displayName } from "../../lib/client-rhythm";
import { formatPhone } from "../domain/phone";
import { isHiddenNumber } from "@/lib/phone-client";

export const EXPORT_MAX = 5000;
export type ContactExportRow = ContactRow & { tags: string[]; totalCents: number | null };

const brDate = (day: string | null) => (day ? day.split("-").reverse().join("/") : "");
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Bahia", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
const reais = (c: number | null) => (c == null ? "" : (c / 100).toFixed(2).replace(".", ","));

/** As linhas do CSV: a lista com os mesmos filtros (até 5.000), as etiquetas e, só com `money`, o total gasto. */
export async function exportContactRows(opts: ContactListOpts, money: boolean): Promise<ContactExportRow[]> {
  const { rows } = await listContacts({ ...opts, page: 1, pageSize: EXPORT_MAX });
  const ids = rows.map((r) => r.id);
  const [tagMap, totals] = await Promise.all([
    tagsOf(ids),
    money && ids.length
      ? db.execute(sql`select contact_id as id, total_cents as cents from contact_stats where contact_id = any(${`{${ids.join(",")}}`}::uuid[])`).then((r) => new Map((r.rows as { id: string; cents: string | number | null }[]).map((x) => [x.id, x.cents == null ? null : Number(x.cents)])))
      : Promise.resolve(new Map<string, number | null>()),
  ]);
  return rows.map((r) => ({ ...r, tags: (tagMap.get(r.id) ?? []).map((t) => t.name), totalCents: money ? totals.get(r.id) ?? null : null }));
}

/** CSV com BOM e ; (Excel em português). Nunca CPF, RG, endereço ou banco (não existem no CRM). Telefone no formato nacional, como no CSV de cobranças
 * (o "+" do E.164 faria o Excel ler fórmula e o toCsv prefixaria '); número oculto sai vazio. */
export function contactsCsv(rows: ContactExportRow[], opts: { money: boolean }): string {
  const header = ["Nome", "Telefone", "E-mail", "Situação", "Última visita", "Visitas", "Próximo horário", "Profissional preferida", "Pacote", "Aniversário", "Responsável", "Etiquetas", "Como conheceu", ...(opts.money ? ["Total gasto (R$)"] : [])];
  return toCsv(header, rows.map((r) => [
    r.name ?? "", isHiddenNumber(r.phone) ? "" : formatPhone(r.phone), r.email ?? "", r.situation, brDate(r.lastVisitOn), r.visits, when(r.nextAppointmentAt),
    displayName(r.preferredProfessional) ?? "", r.pkg ? `${r.pkg.used}/${r.pkg.total}` : "", r.birthday ?? "", r.openDealOwnerName ?? "", r.tags.join(", "), originLabel(r.origin) ?? "",
    ...(opts.money ? [reais(r.totalCents)] : []),
  ]));
}
