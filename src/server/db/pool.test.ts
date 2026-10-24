import { expect, it } from "vitest";
import { pool } from ".";
import { dbStatementTimeoutMs } from "./pool-config";

it("consulta presa não segura a conexão para sempre: 60 s por comando", async () => {
  const { rows } = await pool.query("show statement_timeout");
  expect(rows[0].statement_timeout).toBe("1min");
});

it("DB_STATEMENT_TIMEOUT_MS muda o prazo (0 desliga, para um script de manutenção longo)", () => {
  expect(dbStatementTimeoutMs({})).toBe(60_000);
  expect(dbStatementTimeoutMs({ DB_STATEMENT_TIMEOUT_MS: "0" })).toBe(0);
  expect(dbStatementTimeoutMs({ DB_STATEMENT_TIMEOUT_MS: "120000" })).toBe(120_000);
  expect(dbStatementTimeoutMs({ DB_STATEMENT_TIMEOUT_MS: "abc" })).toBe(60_000);
});
