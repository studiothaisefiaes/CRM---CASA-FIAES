// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { CashClosedStrip } from "./cash-closed-notice";

afterEach(cleanup);

it("psico r68 #6: aviso discreto 'O caixa está fechado' com o botão 'Abrir caixa' que leva ao Caixa", () => {
  render(<CashClosedStrip />);
  expect(screen.getByRole("status").textContent).toContain("O caixa está fechado.");
  expect(screen.getByRole("link", { name: "Abrir caixa" }).getAttribute("href")).toBe("/caixa");
  expect(screen.getByRole("status").className).not.toContain("alert"); // aviso, não erro: sem vermelho
});
