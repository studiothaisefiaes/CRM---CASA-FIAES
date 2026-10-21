// @vitest-environment jsdom
import { it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { ContactsFilterBar, FILTROS_VISIVEIS, type FilterLink } from "./contacts-filters";
afterEach(cleanup);

const todos = ["sumidas", "na_hora", "aniversario_semana", "aniversario_mes", "com_pacote", "com_horario", "sem_dono", "nunca_voltou", "vip", "faltosas"];
const links = (on?: string): FilterLink[] => todos.map((k) => ({ key: k, label: k, count: 1, href: `/x?f=${k}`, on: k === on }));

it("no máximo 4 filtros visíveis; o resto atrás de 'Mais filtros'", () => {
  const { container, getByText } = render(<ContactsFilterBar filters={links()} toggles={[]} clearHref="/x" hasActive={false}><span>form</span></ContactsFilterBar>);
  const visiveis = container.querySelectorAll('nav[aria-label="Filtros"] a');
  expect(visiveis.length).toBe(4);
  expect(FILTROS_VISIVEIS.length).toBe(4);
  const det = container.querySelector("details")!;
  expect(det.open).toBe(false);
  expect(getByText("Mais filtros")).toBeTruthy();
  expect(det.querySelectorAll("a").length).toBe(6);
});

it("filtro ativo escondido aparece à vista e abre 'Mais filtros'", () => {
  const { container } = render(<ContactsFilterBar filters={links("vip")} toggles={[]} clearHref="/x" hasActive><span>form</span></ContactsFilterBar>);
  const visiveis = [...container.querySelectorAll('nav[aria-label="Filtros"] a')];
  expect(visiveis.length).toBe(5);
  expect(visiveis.some((a) => a.getAttribute("aria-current") === "true" && a.textContent?.includes("vip"))).toBe(true);
  expect(container.querySelector("details")!.open).toBe(true);
});
