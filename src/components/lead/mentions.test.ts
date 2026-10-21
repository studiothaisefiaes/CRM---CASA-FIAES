import { describe, expect, it } from "vitest";
import { insertMention, mentionOptions, mentionQuery, mentionsIn } from "./mentions";

const team = [{ id: "u1", name: "Catarina Rocha" }, { id: "u2", name: "Sara Lima" }, { id: "u3", name: "Thaíse Fiaes" }];

describe("@ nas notas", () => {
  it("só abre a lista quando o @ está no fim do que se digita", () => {
    expect(mentionQuery("Confere @ca")).toBe("ca");
    expect(mentionQuery("@")).toBe("");
    expect(mentionQuery("email@teste")).toBeNull();
    expect(mentionQuery("Confere @Sara depois")).toBeNull();
  });
  it("filtra pelo primeiro nome, sem acento nem maiúscula", () => {
    expect(mentionOptions(team, "tha").map((p) => p.id)).toEqual(["u3"]);
    expect(mentionOptions(team, "").map((p) => p.id)).toEqual(["u1", "u2", "u3"]);
  });
  it("troca o @ digitado pelo primeiro nome escolhido", () => {
    expect(insertMention("Confere @ca", "Catarina Rocha")).toBe("Confere @Catarina ");
  });
  it("só conta quem continua chamado no texto final", () => {
    expect(mentionsIn("@catarina e @Thaise, olhem isso", team)).toEqual(["u1", "u3"]);
    expect(mentionsIn("Cati vai ver", team)).toEqual([]);
  });
});
