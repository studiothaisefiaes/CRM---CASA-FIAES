// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AssistantsField } from "./assistants-field";

afterEach(cleanup);
const pros = [
  { id: "ana", name: "Ana", active: true }, { id: "bia", name: "Bia", active: true },
  { id: "sid", name: "Sidney", active: true, assistantOf: "ana" }, { id: "rob", name: "Roberta", active: true, assistantOf: "ana" }, { id: "old", name: "Inativa", active: false },
];
const A = (professionalId: string, name: string, position: 1 | 2) => ({ professionalId, name, position });
const item = (assistants: ReturnType<typeof A>[]) => ({ label: "Corte", professionalId: "ana", assistants });

it("mostra as assistentes com 'Tirar'; tirar manda a lista sem ela", () => {
  const onChange = vi.fn();
  render(<AssistantsField item={item([A("sid", "Sidney", 1), A("rob", "Roberta", 2)])} professionals={pros} max={2} onChange={onChange} />);
  expect(screen.getByText("Sidney")).toBeTruthy();
  expect(screen.getByText("Roberta")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Tirar Sidney" }));
  expect(onChange).toHaveBeenCalledWith(["rob"]);
});

it("com o limite atingido o '+ Assistente' some; com menos, o Select não oferece a profissional do item, nem inativa, nem quem já está", () => {
  const { rerender } = render(<AssistantsField item={item([A("sid", "Sidney", 1), A("rob", "Roberta", 2)])} professionals={pros} max={2} onChange={() => {}} />);
  expect(screen.queryByText("+ Assistente")).toBeNull();
  rerender(<AssistantsField item={item([A("sid", "Sidney", 1)])} professionals={pros} max={2} onChange={() => {}} />);
  const opts = [...screen.getByLabelText("+ Assistente em Corte").querySelectorAll("option")].map((o) => o.textContent);
  expect(opts).toEqual(["+ Assistente", "Roberta", "Bia"]); // o par da Ana primeiro; sem Ana, Inativa nem Sidney
  rerender(<AssistantsField item={item([A("sid", "Sidney", 1)])} professionals={pros} max={1} onChange={() => {}} />);
  expect(screen.queryByLabelText("+ Assistente em Corte")).toBeNull();
});

it("escolher no Select soma à lista; só leitura (sem caixa.assistente) não tem Tirar nem +", () => {
  const onChange = vi.fn();
  const { rerender } = render(<AssistantsField item={item([A("sid", "Sidney", 1)])} professionals={pros} max={2} onChange={onChange} />);
  fireEvent.change(screen.getByLabelText("+ Assistente em Corte"), { target: { value: "bia" } });
  expect(onChange).toHaveBeenCalledWith(["sid", "bia"]);
  rerender(<AssistantsField item={item([A("sid", "Sidney", 1)])} professionals={pros} max={2} disabled onChange={onChange} />);
  expect(screen.getByText("Sidney")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Tirar Sidney" })).toBeNull();
  expect(screen.queryByLabelText("+ Assistente em Corte")).toBeNull();
});

it("sem assistente e sem poder pôr: não ocupa lugar", () => {
  const { container } = render(<AssistantsField item={item([])} professionals={pros} max={2} disabled onChange={() => {}} />);
  expect(container.innerHTML).toBe("");
});
