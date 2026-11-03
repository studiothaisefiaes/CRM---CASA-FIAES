import "dotenv/config";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db, pool } from "../src/server/db";
import { messages } from "../src/server/db/schema";
import { parseContent } from "../src/server/whatsapp/webhook";

// 03/11: mensagens que chegaram como balão vazio ("other") antes de o CRM ler modelo com botões, mensagem interativa e foto de álbum.
// Relê do evento cru guardado (webhook_events, o worker guarda 14 dias) e preenche tipo e texto. Só mexe no que ainda está vazio.
// Ensaio:  npx tsx scripts/reler-vazias.ts --dry-run
// Aplicar: npx tsx scripts/reler-vazias.ts --aplicar

const MEDIA = new Set(["image", "video", "audio", "sticker", "document"]);

async function main() {
  const mode = process.argv.includes("--aplicar") ? "aplicar" : process.argv.includes("--dry-run") ? "ensaio" : null;
  if (!mode) throw new Error("Use --dry-run (ensaio) ou --aplicar");
  const rows = await db.execute<{ id: string; payload: { data?: { key?: Record<string, unknown>; message?: Record<string, unknown> } } }>(sql`
    select m.id, w.payload from messages m
    join lateral (select payload from webhook_events w where w.event = 'messages.upsert' and w.payload->'data'->'key'->>'id' = m.external_id limit 1) w on true
    where m.kind = 'other' and m.body is null`);
  const porTipo: Record<string, number> = {};
  let feitas = 0;
  for (const r of rows.rows) {
    const d = r.payload.data;
    const c = parseContent(d?.message as never);
    if (!c || c.kind === "other") continue;
    porTipo[c.kind] = (porTipo[c.kind] ?? 0) + 1;
    if (mode === "aplicar") {
      const media = MEDIA.has(c.kind) && d?.key && d.message ? { key: d.key, message: d.message } : null;
      const up = await db.update(messages).set({ kind: c.kind, body: c.body, ...(media ? { media } : {}) })
        .where(and(eq(messages.id, r.id), eq(messages.kind, "other"), isNull(messages.body))).returning({ id: messages.id });
      feitas += up.length;
    }
  }
  console.log(`${mode === "ensaio" ? "ENSAIO (nada gravado)" : "APLICADO"} · vazias com evento guardado: ${rows.rows.length} · ${mode === "ensaio" ? "leria" : "lidas"}:`, porTipo, mode === "aplicar" ? `gravadas: ${feitas}` : "");
}
main().then(() => pool.end()).catch(async (e) => { console.error(e instanceof Error ? e.message : e); await pool.end(); process.exit(1); });
