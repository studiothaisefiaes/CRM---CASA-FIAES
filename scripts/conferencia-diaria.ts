/**
 * Conferência diária (plano nota 10, 29/10): todo dia às 18h, o que costuma dar errado sem ninguém ver. Grava o relatório em
 * $CONFERENCIA_DIR/AAAA-MM-DD.txt e, se achou problema, avisa só o dono no sino (CONFERENCIA_USER_ID). Só lê: não corrige nada.
 * cron: 0 18 * * * cd /opt/crm && TZ=America/Bahia npx tsx scripts/conferencia-diaria.ts
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { db } from "../src/server/db";
import { alerts } from "../src/server/db/schema";

const DIR = process.env.CONFERENCIA_DIR ?? "/home/crm/backups/conferencia";
const DONO = process.env.CONFERENCIA_USER_ID ?? "744e2e43-8c7a-4811-925d-e8176bc0986a";
const LOGS = (process.env.CONFERENCIA_LOGS ?? "/home/crm/.pm2/logs/crm-web-error.log,/home/crm/.pm2/logs/crm-worker-error.log").split(",");

type Row = Record<string, unknown>;
const rows = async (q: ReturnType<typeof sql>) => (await db.execute(q)).rows as Row[];
const hoje = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Bahia" });

async function main() {
  const dia = hoje();
  const desde = sql`(${dia}::date::timestamp at time zone 'America/Bahia')`;
  const out: string[] = [`Conferência do CRM · ${dia}`, ""];
  const problemas: string[] = [];
  const secao = (titulo: string, linhas: string[], problema = true) => {
    out.push(`## ${titulo}: ${linhas.length ? linhas.length : "ok"}`, ...linhas.slice(0, 30), "");
    if (problema && linhas.length) problemas.push(`${titulo} (${linhas.length})`);
  };

  // 1. Lembrete da véspera que saiu hoje para um horário que não existe mais (remarcado, cancelado, sumiu do Avec). A visita mexida depois do lembrete não conta: quando ele saiu, estava certo.
  secao("Lembrete para horário que não existe mais", (await rows(sql`
    select o.id, split_part(o.options->>'source', ':', 2) as visita, o.options->>'visitStart' as inicio from outbox o
    where o.status = 'sent' and o.sent_at >= ${desde} and o.options->>'source' like 'lembrete_d1:%'
      and not exists (select 1 from appointments a where a.visit_id::text = split_part(o.options->>'source', ':', 2)
        and ((a.starts_at = (o.options->>'visitStart')::timestamptz and a.status in ('agendado', 'confirmado', 'solicitado', 'conferir', 'compareceu')) or a.updated_at > o.sent_at))`))
    .map((r) => `- lembrete ${r.id} · visita ${r.visita} · horário ${r.inicio}`));

  // 2. Mensagem ou ligação gravada hoje num contato com o número da própria Casa.
  secao("Mensagem no contato com o número da Casa", (await rows(sql`
    select c.name, m.kind, count(*)::int as n from messages m join contacts c on c.id = m.contact_id
    where m.created_at >= ${desde} and m.hidden_at is null
      and right(regexp_replace(c.phone_e164, '\D', '', 'g'), 8) in (select right(regexp_replace(phone, '\D', '', 'g'), 8) from channels where phone is not null)
    group by 1, 2`)).map((r) => `- ${r.name} · ${r.kind} · ${r.n}`));

  // 3. Retomada pela IA: o que saiu hoje, se a cliente respondeu, e as que não saíram.
  const ia = await rows(sql`
    select o.status, o.error, o.text, o.sent_at, exists (select 1 from messages m where m.deal_id = o.deal_id and m.direction = 'in' and m.created_at > o.sent_at) as respondeu
    from outbox o where o.options ? 'ia' and coalesce(o.sent_at, o.status_at, o.not_before) >= ${desde} and o.status <> 'pending' order by o.sent_at nulls last`);
  const enviadas = ia.filter((r) => r.status === "sent");
  out.push(`## Retomadas da IA: ${enviadas.length} enviadas, ${enviadas.filter((r) => r.respondeu).length} responderam, ${ia.length - enviadas.length} não saíram`);
  for (const r of ia) out.push(`- [${r.status}${r.respondeu ? ", respondeu" : ""}] ${r.status === "sent" ? String(r.text).replace(/\s+/g, " ").slice(0, 200) : r.error ?? ""}`);
  out.push("");
  if (ia.some((r) => r.status === "failed")) problemas.push("Retomada da IA que falhou");

  // 4. Avec: a importação de Reservas parou (o robô roda de hora em hora, das 8h às 20h; fora disso não confere).
  const [avec] = await rows(sql`select to_char(max(imported_at) at time zone 'America/Bahia', 'DD/MM HH24:MI') as ultima,
    (extract(hour from now() at time zone 'America/Bahia') between 10 and 20 and coalesce(extract(epoch from now() - max(imported_at)) / 3600 > 3, true)) as atrasado from avec_reports where title = 'Reservas'`);
  secao("Avec sem importar Reservas há mais de 3 h", avec?.atrasado ? [`- última: ${avec.ultima ?? "nunca"}`] : []);

  // 5. Envios que falharam hoje (fila de envio) e eventos do WhatsApp que não foram registrados.
  secao("Envios que falharam hoje", (await rows(sql`select coalesce(o.options->>'source', o.kind) as tipo, left(o.error, 120) as erro, count(*)::int as n from outbox o
    where o.status = 'failed' and coalesce(o.status_at, o.created_at) >= ${desde} group by 1, 2`)).map((r) => `- ${r.tipo} · ${r.erro} · ${r.n}`));
  secao("Eventos do WhatsApp não registrados", (await rows(sql`select event, left(error, 120) as erro, count(*)::int as n from webhook_events
    where processed_at is null and event <> 'messages.set' and received_at >= ${desde} and received_at < now() - interval '10 minutes' group by 1, 2`))
    .map((r) => `- ${r.event} · ${r.erro ?? "sem erro"} · ${r.n}`));

  // 6. Erros no registro do servidor hoje (só a contagem por tipo; o texto completo fica no log).
  const erros = new Map<string, number>();
  for (const f of LOGS) {
    const txt = await readFile(f, "utf8").catch(() => "");
    // Robô da internet testando a falha de Server Actions (cabeçalho Next-Action com "x", "0", "1", "action"): o Next recusa, não é erro nosso.
    for (const l of txt.split("\n")) if (l.startsWith(dia) && !/Server Reference ID|failed-to-find-server-action|ignore-listed frames/.test(l)) { const k = l.slice(20).replace(/[0-9a-f-]{36}/g, "…").slice(0, 90); erros.set(k, (erros.get(k) ?? 0) + 1); }
  }
  secao("Erros no registro do servidor", [...erros.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `- ${n}× ${k}`), false);
  // Cada erro ocupa várias linhas (o rastro); 50 linhas é dia ruim de verdade (depois de um deploy, a tela aberta antiga gera algumas).
  if ([...erros.values()].reduce((a, b) => a + b, 0) >= 50) problemas.push("Muitos erros no registro");

  await mkdir(DIR, { recursive: true });
  const file = join(DIR, `${dia}.txt`);
  await writeFile(file, out.join("\n"));
  if (problemas.length) {
    await db.insert(alerts).values({ userId: DONO, audience: "responsavel", type: "conferencia_diaria", severity: "info",
      message: `Conferência de hoje: ${problemas.join(", ")}. Detalhes no servidor em ${file}.`, dedupeKey: `conferencia:${dia}` }).onConflictDoNothing();
  }
  console.log(`${file} · ${problemas.length ? problemas.join(", ") : "tudo ok"}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
