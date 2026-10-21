// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StageBadge } from "./stage-badge";

describe("StageBadge", () => {
  it("mostra o nome e usa a cor da etapa na bolinha e no fundo", () => {
    const { container } = render(<StageBadge name="Em atendimento" color="#1938d2" />);
    const b = container.querySelector("[data-etapa]") as HTMLElement;
    expect(b.textContent).toBe("Em atendimento");
    expect((b.firstElementChild as HTMLElement).style.backgroundColor).toBe("rgb(25, 56, 210)");
    expect(b.style.backgroundColor).toBe("rgba(25, 56, 210, 0.12)");
  });
  it("cor inválida ou vazia cai no cinza", () => {
    const { container } = render(<StageBadge name="X" color="azul" />);
    expect(((container.querySelector("[data-etapa]") as HTMLElement).firstElementChild as HTMLElement).style.backgroundColor).toBe("rgb(92, 92, 92)");
  });
});
