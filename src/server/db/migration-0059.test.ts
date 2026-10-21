import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { db } from "./index";
import { auditLog, settings } from "./schema";
import { resetDb } from "../../../test/db";

const SQL = readFileSync(path.join(__dirname, "../../../drizzle/0059_contagem_cega_padrao.sql"), "utf8");
const run = () => db.execute(sql.raw(SQL.replaceAll("--> statement-breakpoint", "")));
const rules = async () => (await db.select().from(settings).where(eq(settings.key, "caixa_regras")))[0]?.value;

describe("0059: contagem cega ligada por padrão (QA r58, I-1)", () => {
  beforeEach(resetDb);

  it("liga onde a regra foi gravada só pelo modo do caixa (ninguém escolheu a contagem), sem mexer no resto", async () => {
    await db.insert(settings).values({ key: "caixa_regras", value: { exigeCaixaAberto: true, toleranciaCents: 500, contagemCega: false, sangriaGrandeCents: 20000 } });
    await run();
    expect(await rules()).toEqual({ exigeCaixaAberto: true, toleranciaCents: 500, contagemCega: true, sangriaGrandeCents: 20000 });
  });

  it("respeita a escolha da gestão em Caixas da equipe (auditoria caixa_regras)", async () => {
    await db.insert(settings).values({ key: "caixa_regras", value: { contagemCega: false, toleranciaCents: 1000 } });
    await db.insert(auditLog).values({ action: "caixa_regras", entity: "settings", entityId: "caixa_regras", data: { para: { contagemCega: false } } });
    await run();
    expect(await rules()).toEqual({ contagemCega: false, toleranciaCents: 1000 });
  });
});
