import { sql, type SQL } from "drizzle-orm";

/**
 * O pacote em uso da cliente em SQL, como COMPRA (a mesma regra de src/lib/package-purchases.ts): as linhas do mesmo nome de pacote,
 * data de compra, preço e validade são uma compra só (o Avec grava uma linha por serviço). Sessões da compra: maior total e maior
 * usado entre os serviços (o serviço mais usado conta as idas da cliente). Linha sem data de compra fica sozinha.
 * Em uso = usado < total e validade de hoje em diante; a que vence antes primeiro. Colunas: used_sessions, total_sessions, package_name.
 * Para `left join lateral (…) pk on true`.
 */
export function activePurchaseSql(contactId: SQL, today: SQL, opts: { skipCancelled?: boolean } = {}): SQL {
  return sql`(select max(p.used_sessions) as used_sessions, max(p.total_sessions) as total_sessions, min(p.package_name) as package_name
      from client_packages p
     where p.contact_id = ${contactId}${opts.skipCancelled ? sql` and p.cancelled_at is null` : sql``}
     group by lower(regexp_replace(btrim(p.package_name), '\\s+', ' ', 'g')), p.purchased_on, p.price_cents, p.valid_until,
              case when p.purchased_on is null then p.id end
    having max(p.used_sessions) < max(p.total_sessions) and (p.valid_until is null or p.valid_until >= ${today})
     order by p.valid_until asc nulls last, p.purchased_on desc nulls last limit 1)`;
}
