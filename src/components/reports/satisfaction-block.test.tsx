// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SatisfactionBlock } from "./satisfaction-block";

afterEach(cleanup);

it("mostra respondidas de enviadas, a média e a tabela por profissional", () => {
  const { container } = render(<SatisfactionBlock d={{ asked: 10, answered: 4, average: 4.25,
    byProfessional: [{ id: "g", name: "Gilvan", answered: 3, average: 4.666 }, { id: "l", name: "Lia", answered: 1, average: 2 }] }} />);
  expect(screen.getByRole("heading", { name: "Pesquisa de satisfação" })).toBeTruthy();
  expect(container.textContent).toContain("4 de 10");
  expect(container.textContent).toContain("4,3");
  expect(container.textContent).toContain("Gilvan");
  expect(container.textContent).toContain("4,7");
  expect(container.textContent).toContain("Lia");
});

it("sem pesquisa no período: avisa em vez de mostrar números vazios", () => {
  const { container } = render(<SatisfactionBlock d={{ asked: 0, answered: 0, average: null, byProfessional: [] }} />);
  expect(screen.getByRole("heading", { name: "Pesquisa de satisfação" })).toBeTruthy();
  expect(container.textContent).toContain("Nenhuma Pesquisa de satisfação enviada no período.");
});
