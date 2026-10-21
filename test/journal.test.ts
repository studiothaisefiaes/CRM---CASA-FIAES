import { describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { checarJournal, ULTIMO_WHEN_CONHECIDO } from "../scripts/checar-journal";

function fake(entries: { idx: number; when: number; tag: string }[]) {
  const dir = mkdtempSync(path.join(tmpdir(), "journal-"));
  mkdirSync(path.join(dir, "meta"));
  writeFileSync(path.join(dir, "meta", "_journal.json"), JSON.stringify({ entries }));
  for (const e of entries) writeFileSync(path.join(dir, `${e.tag}.sql`), "select 1;");
  return dir;
}

describe("journal do Drizzle", () => {
  it("o journal real é sequencial, crescente e completo", () => {
    expect(checarJournal()).toEqual([]);
  });

  it("migration nova precisa de when maior que o último conhecido de produção", async () => {
    const j = (await import("../drizzle/meta/_journal.json")).default as { entries: { when: number }[] };
    expect(Math.max(...j.entries.map((x) => x.when))).toBeGreaterThanOrEqual(ULTIMO_WHEN_CONHECIDO);
  });

  it("a trava recusa when menor ou igual ao anterior, idx quebrado e arquivo faltando", () => {
    const ok = [{ idx: 0, when: 100, tag: "0000_a" }, { idx: 1, when: 200, tag: "0001_b" }];
    expect(checarJournal(fake(ok))).toEqual([]);
    expect(checarJournal(fake([...ok, { idx: 2, when: 200, tag: "0002_c" }]))[0]).toMatch(/0002_c.*não é maior/);
    expect(checarJournal(fake([...ok, { idx: 2, when: 150, tag: "0002_c" }]))[0]).toMatch(/0002_c.*não é maior/);
    expect(checarJournal(fake([...ok, { idx: 3, when: 300, tag: "0003_d" }]))[0]).toMatch(/idx 3, esperado 2/);
    const dir = fake(ok);
    writeFileSync(path.join(dir, "0009_solta.sql"), "select 1;");
    expect(checarJournal(dir)[0]).toMatch(/sem entrada/);
  });
});
