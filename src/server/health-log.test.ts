import { it, expect, vi } from "vitest";

vi.mock("@/server/db", () => ({ pool: { query: async () => { throw new Error("ECONNREFUSED 127.0.0.1:5433"); } }, db: {} }));
import { getHealth } from "./health";

it("banco fora: 'down' e o motivo vai para o log", async () => {
  const errs: unknown[][] = []; const orig = console.error; console.error = (...a: unknown[]) => { errs.push(a); };
  try { expect((await getHealth()).status).toBe("down"); } finally { console.error = orig; }
  expect(errs.flat().map(String).join(" ")).toMatch(/ECONNREFUSED/);
});
