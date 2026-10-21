/**
 * Avaliação da sugestão de resposta por IA com conversas REAIS, sem gravar nada (nem em ai_suggestions) e sem enviar nada.
 *
 *   npx tsx scripts/ai-avaliar.ts <arquivo-saida.md> [--n 40] [--dias 30] [--so-horario] [--manual manual.json]
 *
 * Padrão: as N respostas mais recentes da equipe (uma por conversa); a conversa é cortada logo antes da resposta e fica lado a lado:
 * o que a cliente escreveu, a sugestão da IA (com a linha de horários e o horário proposto) e o que a Casa respondeu de verdade.
 * --so-horario: só pedidos de horário (e "pode ser" depois de a Casa oferecer horário): pedido → sugestão → horário proposto, com alertas
 * ("vou verificar" com horários na mão, horário fora da lista). Ex.: npx tsx scripts/ai-avaliar.ts ~/avaliacao-horario.md --n 20 --so-horario
 * --manual: avalia com o Manual da Casa de um arquivo ({ "secoes": {…} }, o mesmo de scripts/manual-ia.ts), sem gravar nada em settings.
 * A linha "Horários livres" vai como a tela manda (quando a cliente pede horário), nos dois modos.
 * Usa ANTHROPIC_API_KEY, AI_MODEL e AI_BASE_URL do .env. Cada conversa é UMA chamada paga (~US$ 0,0002–0,001).
 * O arquivo de saída fica FORA do repositório (tem conversa de cliente). A lógica mora em src/server/ai/avaliar.ts (testada com IA falsa).
 */
import "dotenv/config";
process.env.TZ ??= "America/Bahia";
import { readFileSync, writeFileSync } from "node:fs";
import { pool } from "../src/server/db";
import { aiEnv } from "../src/server/ai/settings";
import { formatUsd } from "../src/server/ai/pricing";
import { avaliar } from "../src/server/ai/avaliar";
import { MANUAL_KEYS, type ManualSections } from "../src/lib/ai-manual";

function args() {
  const a = process.argv.slice(2);
  const num = (k: string, d: number) => { const i = a.indexOf(k); const v = i >= 0 ? Number(a[i + 1]) : NaN; return Number.isFinite(v) && v > 0 ? Math.floor(v) : d; };
  const out = a.find((x, i) => !x.startsWith("--") && !["--n", "--dias", "--manual"].includes(a[i - 1]));
  if (!out) { console.error("Uso: npx tsx scripts/ai-avaliar.ts <arquivo-saida.md> [--n 40] [--dias 30] [--so-horario] [--manual manual.json]"); process.exit(2); }
  const mi = a.indexOf("--manual");
  let manual: Partial<ManualSections> | null = null;
  if (mi >= 0) {
    const secoes = (JSON.parse(readFileSync(a[mi + 1], "utf8")) as { secoes?: Record<string, unknown> }).secoes ?? {};
    manual = Object.fromEntries(MANUAL_KEYS.map((k) => [k, typeof secoes[k] === "string" ? (secoes[k] as string).trim() : ""]));
  }
  return { out, n: Math.min(num("--n", 40), 200), dias: num("--dias", 30), soHorario: a.includes("--so-horario"), manual };
}

async function main() {
  const { out, n, dias, soHorario, manual } = args();
  const { apiKey, model, baseUrl } = aiEnv();
  if (!apiKey) { console.error("Sem ANTHROPIC_API_KEY no .env: nada a avaliar."); process.exit(2); }
  console.log(`Avaliando até ${n} conversas${soHorario ? " (só pedidos de horário)" : ""} · modelo ${model}…`);
  const { markdown, totals } = await avaliar({ n, dias, soHorario, apiKey, model, baseUrl, manual });
  writeFileSync(out, markdown);
  console.log(`Pronto: ${out} · ${totals.conversas} conversas · ${totals.comHorario} com horário proposto · ${totals.vouVerificar} "vou verificar" com horários · ${formatUsd(totals.micros)}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => pool.end());
