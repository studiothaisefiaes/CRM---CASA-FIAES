import { sql } from "drizzle-orm";
import { db } from "../db";
import { contacts } from "../db/schema";

export async function listContacts(opts: { q?: string | null; onlyClients?: boolean; page?: number }) {
  const size = 50; const page = Math.max(1, opts.page ?? 1);
  const conds = [sql`true`];
  if (opts.q) {
    const like = `%${opts.q.trim().toLowerCase()}%`; const digits = opts.q.replace(/\D/g, "");
    conds.push(sql`(lower(coalesce(${contacts.name},'')) like ${like} or lower(coalesce(${contacts.email},'')) like ${like}${digits.length >= 3 ? sql` or ${contacts.phoneE164} like ${"%" + digits + "%"}` : sql``})`);
  }
  if (opts.onlyClients) conds.push(sql`${contacts.isClient}`);
  const where = sql.join(conds, sql` and `);
  const rows = await db.execute(sql`
    select c.id, c.name, c.phone_e164 as phone, c.email, c.instagram, c.is_client as "isClient", c.client_since as "clientSince", c.last_service_at as "lastServiceAt",
      (select d.id from deals d where d.contact_id = c.id order by d.created_at desc limit 1) as "lastDealId",
      (select count(*)::int from deals d where d.contact_id = c.id) as deals
    from contacts c where ${where} order by c.created_at desc limit ${size} offset ${(page - 1) * size}`);
  const [{ total }] = (await db.execute(sql`select count(*)::int as total from contacts c where ${where}`)).rows as { total: number }[];
  return { rows: rows.rows as { id: string; name: string | null; phone: string; email: string | null; instagram: string | null; isClient: boolean; clientSince: string | null; lastServiceAt: string | null; lastDealId: string | null; deals: number }[], total, page, size };
}
