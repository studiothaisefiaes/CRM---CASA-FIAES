import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/**
 * Trava do journal do Drizzle (QA r66, C-1): o migrador só aplica entradas com `when` MAIOR que o da última aplicada.
 * Migration nova com `when` menor ou igual ao anterior "sobe com sucesso" e não cria nada.
 * Regras: idx sequencial a partir de 0; `when` estritamente crescente; cada tag tem o .sql; nenhum .sql sem entrada.
 * 0062 a 0086 já estão no futuro em produção (último: 1792620000000) e não se reescrevem; a próxima passa desse valor.
 */
export const ULTIMO_WHEN_CONHECIDO = 1792620000000;

type Entry = { idx: number; when: number; tag: string };

export function checarJournal(dir = path.resolve(__dirname, "..", "drizzle")): string[] {
  const erros: string[] = [];
  const journal = JSON.parse(readFileSync(path.join(dir, "meta", "_journal.json"), "utf8")) as { entries: Entry[] };
  const e = journal.entries;
  e.forEach((x, i) => {
    if (x.idx !== i) erros.push(`${x.tag}: idx ${x.idx}, esperado ${i} (idx deve ser sequencial a partir de 0).`);
    if (i > 0 && x.when <= e[i - 1].when) erros.push(`${x.tag}: when ${x.when} não é maior que o da anterior (${e[i - 1].tag}, ${e[i - 1].when}); o Drizzle ignoraria esta migration. Use when > ${e[i - 1].when}.`);
    if (!existsSync(path.join(dir, `${x.tag}.sql`))) erros.push(`${x.tag}: falta o arquivo ${x.tag}.sql.`);
  });
  const tags = new Set(e.map((x) => x.tag));
  for (const f of readdirSync(dir)) if (f.endsWith(".sql") && !tags.has(f.slice(0, -4))) erros.push(`${f}: arquivo sem entrada no journal.`);
  return erros;
}

if (process.argv[1] && /checar-journal\.ts$/.test(process.argv[1])) {
  const erros = checarJournal();
  if (erros.length) { console.error(erros.join("\n")); process.exit(1); }
  console.log("journal ok");
}
