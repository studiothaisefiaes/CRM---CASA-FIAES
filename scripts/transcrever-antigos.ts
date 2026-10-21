import "dotenv/config";
import { pool } from "../src/server/db";
import { planOldAudio, queueOldAudio } from "../src/server/whatsapp/audio";

// Áudios antigos (de antes da transcrição) → fila do worker, que converte para .m4a e transcreve um por vez (até 5 por minuto).
// Ensaio:  npx tsx scripts/transcrever-antigos.ts --dry-run [--dias 30]   (conta quantos e o tempo total; não grava)
// Aplicar: npx tsx scripts/transcrever-antigos.ts --aplicar [--dias 30]   (só marca como "pendente"; o worker processa aos poucos)

const fmt = (s: number) => `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}min`;

async function main() {
  const mode = process.argv.includes("--aplicar") ? "aplicar" : process.argv.includes("--dry-run") ? "ensaio" : null;
  if (!mode) throw new Error("Use --dry-run (ensaio) ou --aplicar [--dias 30]");
  const i = process.argv.indexOf("--dias");
  const days = i > -1 ? Number(process.argv[i + 1]) : 30;
  if (!Number.isInteger(days) || days < 1 || days > 3650) throw new Error("--dias precisa ser um número inteiro entre 1 e 3650");
  const plan = await planOldAudio(days);
  console.log(`Áudios dos últimos ${days} dias sem transcrição: ${plan.count} · tempo total: ${fmt(plan.seconds)}${plan.estimated ? ` (${plan.estimated} com duração estimada pelo tamanho do arquivo)` : ""}`);
  if (mode === "ensaio") return;
  const n = await queueOldAudio(days);
  console.log(`Enfileirados: ${n}. O worker processa um por vez, até 5 por minuto (acompanhe em "pm2 logs crm-worker", linhas [áudio]).`);
}
main().then(() => pool.end()).catch(async (e) => { console.error(e.message); await pool.end(); process.exit(1); });
