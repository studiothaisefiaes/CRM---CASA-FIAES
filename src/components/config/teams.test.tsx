// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
const save = vi.hoisted(() => vi.fn(async (_: unknown) => ({ ok: true as const })));
vi.mock("@/app/(app)/config/equipe/setores/actions", () => ({ saveTeamAction: save }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => () => {} }));
import { TeamsEditor } from "./teams";

afterEach(() => { cleanup(); save.mockClear(); });
const teams = [{ id: "t1", name: "Recepção", active: true, members: [{ id: "p1", name: "Sara" }] }, { id: "t2", name: "Método Fiaes®", active: true, members: [] }];
const people = [{ id: "p1", name: "Sara" }, { id: "p2", name: "Cati" }];

it("mostra os setores com as pessoas marcadas e salva a troca de pessoas", async () => {
  render(<TeamsEditor teams={teams} people={people} canManage />);
  expect(screen.getByText("Quem faz parte de cada setor?")).toBeTruthy();
  const rec = screen.getByRole("group", { name: "Pessoas do setor Recepção" });
  const boxes = rec.querySelectorAll("input[type=checkbox]") as NodeListOf<HTMLInputElement>;
  expect([...boxes].map((b) => b.checked)).toEqual([true, false]);
  fireEvent.click(boxes[1]);
  fireEvent.click(screen.getByRole("button", { name: "Salvar Recepção" }));
  await waitFor(() => expect(save).toHaveBeenCalledWith({ id: "t1", name: "Recepção", active: true, memberIds: ["p1", "p2"] }));
});

it("o interruptor desativa o setor", async () => {
  render(<TeamsEditor teams={teams} people={people} canManage />);
  fireEvent.click(screen.getByRole("switch", { name: "Desativar Método Fiaes®" }));
  await waitFor(() => expect(save).toHaveBeenCalledWith({ id: "t2", name: "Método Fiaes®", active: false, memberIds: [] }));
});

it("cria um setor novo", async () => {
  render(<TeamsEditor teams={teams} people={people} canManage />);
  fireEvent.change(screen.getByLabelText("Nome do novo setor"), { target: { value: "Maquiagem" } });
  fireEvent.click(screen.getByRole("button", { name: "Criar setor" }));
  await waitFor(() => expect(save).toHaveBeenCalledWith({ name: "Maquiagem", memberIds: [] }));
});

it("sem permissão de gerir, só olha: sem botões de salvar nem de criar", () => {
  render(<TeamsEditor teams={teams} people={people} canManage={false} />);
  expect(screen.queryByRole("button", { name: "Salvar Recepção" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Criar setor" })).toBeNull();
});
