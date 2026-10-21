import { describe, it, expect } from "vitest";
import { chooseAssignee, type Candidate } from "./routing";

const c = (id: string, priority: number, load: number, lastAssignedAt: string | null = null): Candidate =>
  ({ id, priority, load, lastAssignedAt: lastAssignedAt ? new Date(lastAssignedAt) : null });

describe("chooseAssignee", () => {
  it("lista vazia: ninguém", () => {
    expect(chooseAssignee([])).toBeNull();
  });

  it("preferência (cliente que volta) ganha, se estiver entre as livres", () => {
    expect(chooseAssignee([c("ana", 1, 0), c("bia", 2, 2)], { preferId: "bia" })).toBe("bia");
    expect(chooseAssignee([c("ana", 1, 0)], { preferId: "bia" })).toBe("ana"); // a anterior não está livre
  });

  it("nível 1 recebe antes do nível 2, mesmo com mais conversas", () => {
    expect(chooseAssignee([c("carla", 2, 0), c("ana", 1, 2)])).toBe("ana");
  });

  it("no mesmo nível, quem tem menos conversas esperando", () => {
    expect(chooseAssignee([c("ana", 1, 2), c("bia", 1, 1)])).toBe("bia");
  });

  it("empate: quem está há mais tempo sem receber (quem nunca recebeu primeiro)", () => {
    expect(chooseAssignee([c("ana", 1, 1, "2026-10-13T12:00:00Z"), c("bia", 1, 1, "2026-10-13T11:00:00Z")])).toBe("bia");
    expect(chooseAssignee([c("ana", 1, 1, "2026-10-13T11:00:00Z"), c("bia", 1, 1, null)])).toBe("bia");
  });

  it("empate total: resultado estável (por id)", () => {
    expect(chooseAssignee([c("b", 1, 0), c("a", 1, 0)])).toBe("a");
  });

  it("excluídos ficam de fora, inclusive a preferência", () => {
    expect(chooseAssignee([c("ana", 1, 0), c("bia", 1, 1)], { excludeIds: ["ana"] })).toBe("bia");
    expect(chooseAssignee([c("ana", 1, 0)], { preferId: "ana", excludeIds: ["ana"] })).toBeNull();
  });
});
