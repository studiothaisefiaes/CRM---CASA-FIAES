import { describe, expect, it } from "vitest";
import { teamProLabel } from "./assistant";

describe("nome da profissional dentro do CRM (17/10)", () => {
  it("a equipe vê a assistente com a principal; sem principal, só o nome", () => {
    expect(teamProLabel("SIDNEY", "THAISE")).toBe("Sidney (assistente de Thaise)");
    expect(teamProLabel("Ana", null)).toBe("Ana");
  });
});
