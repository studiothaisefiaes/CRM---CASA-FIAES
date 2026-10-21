import { it, expect, vi } from "vitest";

vi.mock("@/server/health", () => ({ getHealth: async () => { throw new Error("conexão recusada pelo banco"); } }));
import { NextRequest } from "next/server";
import { GET } from "./route";

it("exceção ao montar a saúde: 503 'down' E registra o erro no log (nada de falha escondida)", async () => {
  const errs: unknown[][] = []; const orig = console.error; console.error = (...a: unknown[]) => { errs.push(a); };
  let res: Response;
  try { res = await GET(new NextRequest("http://localhost/api/health")); } finally { console.error = orig; }
  expect(res.status).toBe(503);
  expect(await res.json()).toEqual({ status: "down" }); // público: só o status (revisão 17/10, B5)
  expect(errs.flat().map(String).join(" ")).toMatch(/conexão recusada pelo banco/);
});
