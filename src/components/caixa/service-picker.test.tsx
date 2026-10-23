// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { money } from "@/lib/format";
import { rankServices, ServicePicker } from "./service-picker";

afterEach(cleanup);
const services = [
  { id: "col", label: "Coloração", priceCents: 25000 }, { id: "cor", label: "Corte Feminino", priceCents: 12000 },
  { id: "esc", label: "Escova Modelada", priceCents: 8000 }, { id: "mec", label: "Mechas", priceCents: null }, { id: "man", label: "Manicure", priceCents: 4000 },
];
const pro = { ana: ["cor", "esc"] };
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

it("busca sem acento e sem maiúscula; a palavra que começa com o termo vem antes de 'contém'", () => {
  expect(ids(rankServices(services, "escova", null, pro))).toEqual(["esc"]);
  expect(ids(rankServices(services, "mecha", null, pro))).toEqual(["mec"]);
  expect(ids(rankServices(services, "MANICURE", null, pro))).toEqual(["man"]);
  expect(ids(rankServices(services, "coloracao", null, pro))).toEqual(["col"]);
  expect(ids(rankServices(services, "cure", null, pro))).toEqual(["man"]); // contém, no meio da palavra
});

it("os serviços da profissional escolhida vêm primeiro; sem busca, os dela e depois o resto, por nome", () => {
  expect(ids(rankServices(services, "co", "ana", pro))).toEqual(["cor", "esc", "col"]); // dela que começa, dela que contém (Es-co-va), depois o resto
  expect(ids(rankServices(services, "", "ana", pro))).toEqual(["cor", "esc", "col", "man", "mec"]);
  expect(ids(rankServices(services, "", null, pro))).toEqual(["col", "cor", "esc", "man", "mec"]);
});

it("digitar, ↓ e Enter escolhem; cada linha mostra o preço", () => {
  const onPick = vi.fn();
  render(<ServicePicker services={services} proServices={pro} professionalId={null} value={null} onPick={onPick} />);
  const input = screen.getByRole("combobox", { name: "Serviço" });
  fireEvent.change(input, { target: { value: "esc" } });
  expect(screen.getByRole("option", { name: /Escova Modelada/ }).textContent).toContain(money(8000));
  fireEvent.keyDown(input, { key: "ArrowDown" });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(onPick).toHaveBeenCalledWith("esc");
});

it("escolhido: mostra o nome e o preço com 'Trocar'", () => {
  const onPick = vi.fn();
  render(<ServicePicker services={services} proServices={pro} professionalId={null} value="cor" onPick={onPick} />);
  expect(screen.getByText("Corte Feminino")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Trocar serviço" }));
  expect(onPick).toHaveBeenCalledWith(null);
});
