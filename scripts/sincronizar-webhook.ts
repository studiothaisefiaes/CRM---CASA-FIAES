import "dotenv/config";
import { db, pool } from "../src/server/db";
import { channels } from "../src/server/db/schema";
import { whatsapp, WEBHOOK_EVENTS } from "../src/server/whatsapp/evolution";

/**
 * Reaplica a lista de eventos do webhook (agora com CALL, Lote 5) em cada número. Não envia mensagem nem mexe em rejectCall/msgCall.
 * --dry-run: só mostra o que faria. --aplicar: chama /webhook/set de cada instância (só em produção, com o ok do dono).
 */
async function main() {
  const apply = process.argv.includes("--aplicar");
  if (!apply && !process.argv.includes("--dry-run")) throw new Error("Use --dry-run (só mostra) ou --aplicar.");
  if (/127\.0\.0\.1:9\b/.test(process.env.EVOLUTION_URL ?? "")) throw new Error("EVOLUTION_URL é o endereço morto dos testes: nada a fazer.");
  const list = await db.select({ name: channels.name, instance: channels.instanceName, status: channels.status }).from(channels);
  console.log(`Eventos que ficarão ligados: ${WEBHOOK_EVENTS.join(", ")}`);
  for (const c of list) {
    console.log(`${apply ? "Aplicando" : "Ensaio"}: ${c.name} (${c.instance}, ${c.status})`);
    if (apply) await whatsapp().syncWebhook?.(c.instance);
  }
  console.log(apply ? "Feito. Confira em Configurações › WhatsApp que o número segue conectado." : "Ensaio: nada foi alterado.");
}
main().then(() => pool.end()).catch(async (e) => { console.error(e instanceof Error ? e.message : e); await pool.end(); process.exit(1); });
