// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AcompanhandoBloco } from "./following";

afterEach(cleanup);

it("sem conversas acompanhadas, o bloco fica apagado e explica como acompanhar", () => {
  render(<AcompanhandoBloco items={[]} />);
  expect(screen.getByRole("region", { name: "Acompanhando" }).getAttribute("data-vazio")).toBe("sim");
  expect(screen.getByText("Nenhuma conversa acompanhada.")).toBeTruthy();
});
it("mostra o nome de cada conversa e marca quem espera a Casa", () => {
  render(<AcompanhandoBloco items={[{ dealId: "d1", name: "Maria Souza", lastAt: null, waiting: true }, { dealId: "d2", name: "Ana Lima", lastAt: "2026-10-17T15:00:00Z", waiting: false }]} />);
  const b = screen.getByRole("region", { name: "Acompanhando" });
  expect(b.textContent).toContain("Maria Souza");
  expect(b.textContent).toContain("Ana Lima");
  expect(b.textContent).toContain("Esperando");
});
