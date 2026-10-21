import { Pool } from "pg";
import { like } from "drizzle-orm";
import { db } from "../db";
import { contacts } from "../db/schema";
import { env } from "../env";
import { normalizePhone } from "../domain/phone";
import { mergeLidInto } from "../domain/lid-merge";

export type LidPair = { lid: string; phone: string };
let pool: Pool | null = null;
/** Conexão só de leitura com o banco da Evolution. Prazo curto: a consulta roda no meio do webhook e do "Iniciar conversa". */
const evoPool = (url: string) => new Pool({ connectionString: url, max: 1, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 2_000, query_timeout: 3_000 });

/**
 * Pares @lid ↔ número que a Evolution guardou nas mensagens (o eco que chega pelo webhook às vezes vem só com o @lid, mas a
 * cópia dela traz o número em remoteJidAlt). Só leitura, no banco da Evolution; sem EVOLUTION_DATABASE_URL, nenhum par.
 */
export async function lidPairsFromEvolution(): Promise<LidPair[]> {
  const url = env().EVOLUTION_DATABASE_URL;
  if (!url) return [];
  pool ??= evoPool(url);
  const r = await pool.query<{ lid: string; jid: string }>(`
    select distinct split_part(key->>'remoteJid', '@', 1) as lid, key->>'remoteJidAlt' as jid from evolution_api."Message"
      where key->>'remoteJid' like '%@lid' and key->>'remoteJidAlt' like '%@s.whatsapp.net'
    union
    select distinct split_part(key->>'remoteJidAlt', '@', 1) as lid, key->>'remoteJid' as jid from evolution_api."Message"
      where key->>'remoteJidAlt' like '%@lid' and key->>'remoteJid' like '%@s.whatsapp.net'`);
  return r.rows.flatMap((x) => { const phone = normalizePhone(x.jid); return phone && x.lid ? [{ lid: x.lid, phone }] : []; });
}

/** Variações do número como o WhatsApp escreve no JID (celular brasileiro com e sem o 9). */
function jidVariants(phone: string): string[] {
  const d = phone.replace(/\D/g, "");
  const out = [d];
  if (d.length === 13 && d.startsWith("55") && d[4] === "9") out.push(d.slice(0, 4) + d.slice(5));
  return out.map((x) => `${x}@s.whatsapp.net`);
}

/**
 * Consulta pontual de um par @lid ↔ número na Evolution (mesmas mensagens guardadas que o `lidPairsFromEvolution` lê).
 * Usada na hora (webhook e "Iniciar conversa") para não esperar o worker. Sem EVOLUTION_DATABASE_URL ou com a Evolution fora: null.
 * Objeto mutável de propósito: os testes trocam as funções (`vi.spyOn`) sem precisar da Evolution.
 */
export const lidLookup = {
  async phoneForLid(lid: string): Promise<string | null> {
    const url = env().EVOLUTION_DATABASE_URL;
    if (!url || !lid) return null;
    pool ??= evoPool(url);
    const r = await pool.query<{ jid: string }>(`
      select key->>'remoteJidAlt' as jid from evolution_api."Message" where key->>'remoteJid' = $1 and key->>'remoteJidAlt' like '%@s.whatsapp.net'
      union all
      select key->>'remoteJid' as jid from evolution_api."Message" where key->>'remoteJidAlt' = $1 and key->>'remoteJid' like '%@s.whatsapp.net'
      limit 1`, [`${lid}@lid`]);
    return r.rows[0] ? normalizePhone(r.rows[0].jid) : null;
  },
  async lidForPhone(phone: string): Promise<string | null> {
    const url = env().EVOLUTION_DATABASE_URL;
    if (!url || !phone) return null;
    pool ??= evoPool(url);
    const r = await pool.query<{ lid: string }>(`
      select split_part(key->>'remoteJid', '@', 1) as lid from evolution_api."Message" where key->>'remoteJid' like '%@lid' and key->>'remoteJidAlt' = any($1)
      union all
      select split_part(key->>'remoteJidAlt', '@', 1) as lid from evolution_api."Message" where key->>'remoteJidAlt' like '%@lid' and key->>'remoteJid' = any($1)
      limit 1`, [jidVariants(phone)]);
    return r.rows[0]?.lid || null;
  },
};

/** Junta os contatos de número oculto cujo número já é conhecido (worker, a cada minuto). `source` permite testar sem a Evolution. */
export async function syncLidPairs(source: () => Promise<LidPair[]> = lidPairsFromEvolution): Promise<{ merged: number; renamed: number }> {
  const hidden = new Set((await db.select({ lid: contacts.waLid }).from(contacts).where(like(contacts.phoneE164, "lid:%"))).map((c) => c.lid));
  if (!hidden.size) return { merged: 0, renamed: 0 };
  let merged = 0, renamed = 0;
  for (const p of await source()) {
    if (!hidden.has(p.lid)) continue;
    const r = await mergeLidInto(p.lid, p.phone);
    if (r.merged) merged++; else if (r.renamed) renamed++;
  }
  return { merged, renamed };
}
