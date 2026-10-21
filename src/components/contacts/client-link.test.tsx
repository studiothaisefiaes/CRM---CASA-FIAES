// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ClientLink } from "./client-link";

afterEach(cleanup);

it("leva à ficha, com nome acessível que contém o nome visível, e não deixa o toque chegar na linha nem no arrasto", () => {
  const onRow = vi.fn();
  render(<div onPointerDown={onRow}><ClientLink contactId="c-1" name="Rita Souza">Rita Souza</ClientLink></div>);
  const a = screen.getByRole("link", { name: "Ficha de Rita Souza" });
  expect(a.getAttribute("href")).toBe("/contatos/c-1");
  fireEvent.pointerDown(a);
  expect(onRow).not.toHaveBeenCalled();
});
