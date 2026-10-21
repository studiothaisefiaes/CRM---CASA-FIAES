// @vitest-environment jsdom
import { it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";

vi.mock("@/app/(app)/funil/actions", () => ({ closeSaleAction: vi.fn() }));
import { CloseSaleSheet } from "./close-sale-sheet";

beforeAll(() => {
  // jsdom não tem matchMedia (usado para escolher folha lateral × de baixo)
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as typeof window.matchMedia;
});
afterEach(cleanup);

const base = { open: true, onClose: () => {}, dealId: "d1", name: "Maria", initial: { serviceId: null, valueCents: null, paymentMethod: null }, onDone: () => {} };

it("sem serviço cadastrado, a gestão vê o aviso e o link para a aba Serviços", () => {
  render(<CloseSaleSheet {...base} services={[]} canManage />);
  const note = screen.getByRole("note");
  expect(note.textContent).toContain("Nenhum serviço cadastrado");
  const link = screen.getByRole("link", { name: "Cadastrar serviços" });
  expect(link.getAttribute("href")).toBe("/servicos");
});

it("sem serviço cadastrado, a atendente é orientada a pedir à gestão (sem link)", () => {
  render(<CloseSaleSheet {...base} services={[]} canManage={false} />);
  expect(screen.getByRole("note").textContent).toContain("Peça à gestão para cadastrar os serviços");
  expect(screen.queryByRole("link", { name: "Cadastrar serviços" })).toBeNull();
});

it("com serviços, não mostra o aviso", () => {
  render(<CloseSaleSheet {...base} services={[{ id: "s1", label: "Corte" }]} canManage />);
  expect(screen.queryByRole("note")).toBeNull();
  expect(screen.getByRole("radio", { name: "Corte" })).toBeTruthy();
});
