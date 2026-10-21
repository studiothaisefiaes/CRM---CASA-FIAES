import "dotenv/config";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { pool } from "../src/server/db";
import { applyAvecFiles, type AvecFileInput } from "../src/server/domain/avec/apply";
import type { AvecSummary } from "../src/server/domain/avec/context";
import { readXlsx } from "../src/server/domain/avec/xlsx";

// Carga dos relatórios do Avec (mesma lógica da tela Relatórios › Avec): saneia, guarda e aplica. Idempotente.
// Uso: DATABASE_URL=... npx tsx scripts/importar-avec.ts <pasta|arquivo.xlsx> [mais arquivos ou pastas…]

const LABELS: [keyof AvecSummary, string, string][] = [
  ["contatosNovos", "contato novo", "contatos novos"], ["contatosCompletados", "contato completado", "contatos completados"], ["agendamentos", "agendamento", "agendamentos"],
  ["bloqueios", "bloqueio", "bloqueios"], ["pacotes", "pacote", "pacotes"], ["usosPacote", "uso de pacote", "usos de pacote"], ["itensVenda", "item de venda", "itens de venda"],
  ["pagamentos", "pagamento", "pagamentos"], ["profissionais", "profissional", "profissionais"], ["servicos", "serviço", "serviços"],
];
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const line = (s: AvecSummary) => LABELS.map(([k, one, many]) => plural(s[k], one, many)).join(", ");

async function collect(p: string): Promise<string[]> {
  const st = await stat(p);
  if (st.isFile()) return /\.xlsx$/i.test(p) ? [p] : [];
  const out: string[] = [];
  for (const e of (await readdir(p)).sort()) if (!e.startsWith("~$") && !e.startsWith(".")) out.push(...(await collect(path.join(p, e))));
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.length) throw new Error("Informe uma pasta ou arquivos .xlsx do Avec");
  const files = (await Promise.all(args.map(collect))).flat();
  if (!files.length) throw new Error("Nenhum .xlsx encontrado");
  const inputs: AvecFileInput[] = [];
  for (const f of files) inputs.push({ fileName: path.basename(f), rows: await readXlsx(await readFile(f)) });
  const res = await applyAvecFiles(inputs);
  for (const f of res.files) {
    if (f.error) { console.log(`✗ ${f.fileName}: ${f.error}`); continue; }
    const removed = f.removedColumns.length ? ` [sem ${f.removedColumns.join(", ")}]` : "";
    console.log(`${f.newReport ? "+" : "="} ${f.fileName} → ${f.title} (${f.signature}, ${plural(f.rowCount, "linha", "linhas")})${removed}: ${line(f.summary)}`);
  }
  console.log(`\nTotal (${res.files.length} arquivos): ${line(res.summary)}`);
  const f = res.funil;
  console.log(`Funil (só quem conversou nos últimos 30 dias): ${f.agendados} → Agendado, ${f.datasAtualizadas} datas atualizadas, ${f.atendidas} → Atendida, ${f.aguardando} → Aguardando, ${f.cartoesNovos} cartões novos${f.erros.length ? `, ${f.erros.length} erro(s)` : ""}`);
  console.log(res.visao
    ? `Visão por contato: ${res.visao.contatos} contatos recalculados (${res.visao.comVisita} com visita).`
    : "Visão por contato: não recalculou (veja o erro acima); o worker refaz às 03:30.");
}
main().then(() => pool.end()).catch(async (e) => { console.error(e.message); await pool.end(); process.exit(1); });
