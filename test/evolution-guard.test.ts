import { describe, it, expect } from "vitest";
import { assertNotRealEvolution, E2E_EVOLUTION_URL } from "../e2e/evolution-guard";

describe("guarda do e2e: nunca falar com a Evolution real", () => {
  it("recusa a porta 8080 (a Evolution local do usuário, com a Recepção conectada)", () => {
    for (const url of ["http://localhost:8080", "http://127.0.0.1:8080/", "http://0.0.0.0:8080/api"]) expect(() => assertNotRealEvolution(url)).toThrow(/8080/);
  });
  it("recusa a URL da Evolution do .env e a porta EVOLUTION_PORT", () => {
    expect(() => assertNotRealEvolution("http://evo.local:9999", { realUrl: "http://evo.local:9999" })).toThrow();
    expect(() => assertNotRealEvolution("http://localhost:8181", { realPort: "8181" })).toThrow();
  });
  it("recusa vazio ou inválido (cairia no padrão)", () => {
    expect(() => assertNotRealEvolution(undefined)).toThrow();
    expect(() => assertNotRealEvolution("não é url")).toThrow();
  });
  it("aceita o endereço morto do e2e", () => {
    expect(E2E_EVOLUTION_URL).toBe("http://127.0.0.1:9");
    expect(() => assertNotRealEvolution(E2E_EVOLUTION_URL, { realUrl: "http://localhost:8080", realPort: "8080" })).not.toThrow();
  });
});
