import "dotenv/config";
import { pool } from "../src/server/db";
import { reprocessAdOrigins } from "../src/server/domain/ad-origin-reprocess";

// De onde veio a conversa (anúncio e porta de entrada) nas conversas que chegaram antes de 26/10, a partir dos eventos crus guardados
// (webhook_events: messages.upsert e messages.set; o worker guarda 14 dias). Só preenche o que está vazio: pode rodar quantas vezes quiser.
// Ensaio:  npx tsx scripts/origem-anuncio-reprocessar.ts --dry-run   (conta o que faria; não grava nada)
// Aplicar: npx tsx scripts/origem-anuncio-reprocessar.ts --aplicar

async function main() {
  const mode = process.argv.includes("--aplicar") ? "aplicar" : process.argv.includes("--dry-run") ? "ensaio" : null;
  if (!mode) throw new Error("Use --dry-run (ensaio) ou --aplicar");
  const t = Date.now();
  const r = await reprocessAdOrigins({ dryRun: mode === "ensaio" });
  console.log(`${mode === "ensaio" ? "ENSAIO (nada gravado)" : "APLICADO"} em ${Math.round((Date.now() - t) / 1000)} s`);
  console.log(`Eventos lidos: ${r.eventos} · mensagens da cliente com origem: ${r.mensagens} (fora do CRM: ${r.semConversa}) · anúncios diferentes: ${r.anunciosVistos}`);
  console.log(`Conversas que ${mode === "ensaio" ? "ganhariam" : "ganharam"}: anúncio ${r.anuncios} · porta de entrada ${r.portas} · origem do anúncio ${r.origens}`);
}
main().then(() => pool.end()).catch(async (e) => { console.error(e instanceof Error ? e.message : e); await pool.end(); process.exit(1); });
