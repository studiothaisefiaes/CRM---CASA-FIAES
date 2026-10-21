import { expect, it, vi } from "vitest";

vi.mock("@/server/build-id", () => ({ buildId: () => "b42" }));
import { GET } from "./route";

it("devolve a versão do servidor, sem cache (o aviso 'Versão nova do CRM' compara com a da tela)", async () => {
  const res = GET();
  expect(res.status).toBe(200);
  expect(res.headers.get("cache-control")).toBe("no-store");
  expect(await res.json()).toEqual({ versao: "b42" });
});
