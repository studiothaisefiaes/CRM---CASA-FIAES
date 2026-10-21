import "dotenv/config";
import { access, writeFile } from "node:fs/promises";
import path from "node:path";
import { db, pool } from "../src/server/db";
import { professionalServices } from "../src/server/db/schema";
import { acceptSuggestions, suggestProfessionalServices } from "../src/server/domain/agenda/who-does-what";

// Quem faz o quê pelo histórico do Avec ("Serviços por profissional" e vendas): 2 vezes ou mais em 12 meses. Idempotente; nunca tira
// nem troca vínculo feito à mão.
// Ensaio:  npx tsx scripts/quem-faz-o-que.ts --dry-run   (imprime a matriz e o que não casou; não grava)
// Aplicar: npx tsx scripts/quem-faz-o-que.ts --aplicar --backup /caminho/vinculos-antes.json   (EM PRODUÇÃO, SÓ COM O OK DO DONO)

async function main() {
  const args = process.argv.slice(2);
  const mode = args.includes("--aplicar") ? "aplicar" : args.includes("--dry-run") ? "ensaio" : null;
  if (!mode) throw new Error("Use --dry-run (ensaio) ou --aplicar --backup <arquivo>");
  const backup = args.includes("--backup") ? args[args.indexOf("--backup") + 1] : undefined;
  if (mode === "aplicar" && (!backup || backup.startsWith("--"))) throw new Error("--aplicar exige --backup <arquivo> (JSON com os vínculos de antes)");

  const { suggestions, unmatched } = await suggestProfessionalServices();
  console.log(`Sugestões (2 vezes ou mais em 12 meses, ainda não marcadas): ${suggestions.length}`);
  if (suggestions.length) console.table(suggestions.map((s) => ({ profissional: s.professionalName, servico: s.serviceLabel, vezes: s.count })));
  for (const u of unmatched) console.log(`${u.kind === "servico" ? "serviço não cadastrado" : "profissional não cadastrada"}: ${u.name} (${u.count} ${u.count === 1 ? "vez" : "vezes"})`);
  if (mode === "ensaio") return;

  const file = path.resolve(backup!);
  await access(file).then(() => { throw new Error(`Backup já existe: ${file}`); }, () => undefined);
  const before = await db.select().from(professionalServices);
  await writeFile(file, JSON.stringify({ geradoEm: new Date().toISOString(), vinculos: before }, null, 2));
  console.log(`Backup: ${file} (${before.length} vínculos antes)`);
  const { added } = await acceptSuggestions({}, null);
  const after = await db.select().from(professionalServices);
  console.log(`Aplicado: ${added} vínculos novos (origem avec_historico). Conferência: ${before.length} → ${after.length}.`);
  if (after.length !== before.length + added) throw new Error(`Conferência falhou: esperava ${before.length + added}, ficou ${after.length}`);
}
main().then(() => pool.end()).catch(async (e) => { console.error(e.message); await pool.end(); process.exit(1); });
