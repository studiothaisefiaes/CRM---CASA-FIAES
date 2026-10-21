import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { db } from "../db";
import { reportFiles, users } from "../db/schema";
import { ensureMonthlyReport } from "./pdf";
import { resetDb } from "../../../test/db";

describe("fechamento mensal em PDF", () => {
  beforeEach(async () => { await resetDb(); process.env.REPORTS_DIR = mkdtempSync(join(tmpdir(), "relatorios-")); });
  const fake = async () => Buffer.from("%PDF-1.7 fake");

  it("gera o do mês anterior uma vez só (rodar de novo no mesmo mês não duplica)", async () => {
    await db.insert(users).values({ name: "Thaíse", email: "g@c.com", role: "gestor", passwordHash: "x" });
    const now = new Date("2026-11-02T09:00:00Z");
    expect(await ensureMonthlyReport(now, fake)).toEqual({ created: "2026-10" });
    expect(await ensureMonthlyReport(now, fake)).toEqual({ created: null });
    const rows = await db.select().from(reportFiles);
    expect(rows).toHaveLength(1);
    expect(rows[0].path).toBe("2026-10.pdf"); // só o nome: restaurar o backup em outra pasta continua achando o arquivo
    expect(existsSync(join(process.env.REPORTS_DIR!, rows[0].path))).toBe(true);
  });

  it("sem ninguém que veja equipe, valores e exporte: não gera", async () => {
    await db.insert(users).values({ name: "Ana", email: "a@c.com", role: "atendente", passwordHash: "x" });
    expect(await ensureMonthlyReport(new Date("2026-11-02T09:00:00Z"), fake)).toEqual({ created: null });
  });
});
