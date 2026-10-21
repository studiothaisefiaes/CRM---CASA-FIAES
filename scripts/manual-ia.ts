// scripts/manual-ia.ts
import "dotenv/config";
import { readFile } from "node:fs/promises";
import { pool } from "../src/server/db";
import { getAiManual, saveAiManual } from "../src/server/ai/manual";
import { MANUAL_SECTIONS, approxTokens, countMissing, manualLength, type ManualSections } from "../src/lib/ai-manual";

// Carrega o Manual da Casa para a IA (seções de skill) a partir de um JSON { "secoes": { casa, fala, regras, pacotes, perguntas, cenarios, objecoes, exemplos } }.
// O mesmo texto pode ser editado depois em Configurações › Conversas › Sugestão de resposta por IA › O que a IA sabe sobre a Casa.
// No servidor: cd /opt/crm && sudo -u crm npx tsx scripts/manual-ia.ts <arquivo.json> --dry-run | --aplicar
const args = process.argv.slice(2);
async function main() {
  const file = args.find((a) => a.endsWith(".json"));
  if (!file || (!args.includes("--dry-run") && !args.includes("--aplicar"))) throw new Error("Uso: manual-ia.ts <arquivo.json> --dry-run | --aplicar");
  const secoes = (JSON.parse(await readFile(file, "utf8")) as { secoes: Partial<ManualSections> }).secoes ?? {};
  const atual = await getAiManual();
  for (const s of MANUAL_SECTIONS) console.log(`${s.title.padEnd(26)} agora ${String(atual.secoes[s.key].length).padStart(5)} · arquivo ${String(secoes[s.key]?.trim().length ?? 0).padStart(5)} caracteres`);
  console.log(`Total do arquivo: ${manualLength(secoes)} caracteres (≈ ${approxTokens(Object.values(secoes).join(""))} tokens), ${countMissing(secoes)} itens "[a Casa precisa preencher]".`);
  if (args.includes("--dry-run")) { console.log("Ensaio: nada foi gravado."); return; }
  const r = await saveAiManual(secoes, null);
  console.log(`Gravado em ${r.updatedAt.toISOString()} (o anterior tinha ${manualLength(atual.secoes)} caracteres).`);
}
main().then(() => pool.end()).catch(async (e) => { console.error(e instanceof Error ? e.message : e); await pool.end(); process.exit(1); });
