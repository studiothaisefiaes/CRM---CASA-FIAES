import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";

/**
 * Lote 1C: o servidor decide pela ETAPA (tipo), nunca pela chave escrita à mão. Só o seed, a migração do funil e os modelos
 * de automação (configuráveis pela gestão) citam chaves.
 */
const ROOT = __dirname;
const ALLOWED = new Set(["db/seed-data.ts", "domain/funnel-migration.ts", "rules/templates.ts"]);
const KEY_CALL = /\b(stageByKey|moveDealTx|moveDeal)\([^)]*["'](lead|atendimento|agendado|followup_[1-4]|orcamento|atendida|retorno|fechado|perdido)["']/;
const FOLLOWUP_KEY = /["']followup_[1-4]["']/;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) return files(p);
    return p.endsWith(".ts") && !p.endsWith(".test.ts") ? [p] : [];
  });
}

it("nenhum código de servidor busca ou move etapa pela chave escrita à mão", () => {
  const bad = files(ROOT).map((f) => path.relative(ROOT, f)).filter((rel) => !ALLOWED.has(rel))
    .filter((rel) => { const src = readFileSync(path.join(ROOT, rel), "utf8"); return KEY_CALL.test(src) || FOLLOWUP_KEY.test(src); });
  expect(bad).toEqual([]);
});
