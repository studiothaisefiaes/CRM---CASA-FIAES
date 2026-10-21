// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
const save = vi.hoisted(() => vi.fn(async (_: unknown) => ({ ok: true as const })));
vi.mock("@/app/(app)/config/menu/actions", () => ({ saveWelcomeMenuAction: save }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => () => {} }));
import { WelcomeMenuEditor } from "./welcome-menu";

afterEach(() => { cleanup(); save.mockClear(); });

const teams = [{ id: "t1", name: "Recepção" }, { id: "t2", name: "Método Fiaes®" }];
const people = [{ id: "p1", name: "Sara" }];
const files = [{ id: "f1", name: "Tabela de preços.pdf" }];
const OLD = { enabled: false, intro: "Olá! Responda com o número:", options: [{ label: "Agendar horário", tag: "Quer agendar" }, { label: "Método Fiaes®", tag: null }] };
const ed = (initial = OLD) => render(<WelcomeMenuEditor initial={initial} teams={teams} people={people} files={files} />);
const panel = () => screen.getByRole("group", { name: /O que acontece quando ela escolhe/ });

it("uma opção por vez, com a pergunta e as quatro escolhas; o formato antigo abre com a etiqueta marcada", () => {
  ed();
  expect(screen.getByRole("heading", { name: "O que acontece quando ela escolhe Agendar horário?" })).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "O que acontece quando ela escolhe Método Fiaes®?" })).toBeNull();
  const p = within(panel());
  for (const n of ["Pôr etiqueta", "Responder", "Passar para", "Abrir outro menu"]) expect(p.getByRole("checkbox", { name: n })).toBeTruthy();
  expect((p.getByRole("checkbox", { name: "Pôr etiqueta" }) as HTMLInputElement).checked).toBe(true);
  expect((p.getByLabelText("Etiqueta") as HTMLInputElement).value).toBe("Quer agendar");
  fireEvent.click(screen.getByRole("button", { name: "Configurar a opção 2" }));
  expect(screen.getByRole("heading", { name: "O que acontece quando ela escolhe Método Fiaes®?" })).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "O que acontece quando ela escolhe Agendar horário?" })).toBeNull();
});

it("responder com texto e arquivo da Biblioteca e passar para o setor: salva no formato novo", async () => {
  ed();
  fireEvent.click(screen.getByRole("button", { name: "Configurar a opção 2" }));
  const p = within(panel());
  fireEvent.click(p.getByRole("checkbox", { name: "Responder" }));
  fireEvent.change(p.getByLabelText("Texto da resposta"), { target: { value: "Já te passo para a equipe 💛" } });
  fireEvent.change(p.getByLabelText("Arquivo da Biblioteca"), { target: { value: "f1" } });
  fireEvent.click(p.getByRole("checkbox", { name: "Passar para" }));
  fireEvent.change(p.getByLabelText("Para quem passa"), { target: { value: "team:t2" } });
  fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
  await waitFor(() => expect(save).toHaveBeenCalledWith({ enabled: false, intro: OLD.intro, options: [
    { label: "Agendar horário", tag: "Quer agendar", reply: null, passTo: null, submenu: null },
    { label: "Método Fiaes®", tag: null, reply: { text: "Já te passo para a equipe 💛", fileId: "f1" }, passTo: { team: "t2" }, submenu: null },
  ] }));
});

it("abrir outro menu: o submenu ganha opções, e dentro dele não há um terceiro nível", async () => {
  ed();
  fireEvent.click(screen.getByRole("button", { name: "Configurar a opção 2" }));
  fireEvent.click(within(panel()).getByRole("checkbox", { name: "Abrir outro menu" }));
  fireEvent.change(screen.getByLabelText("Saudação do submenu"), { target: { value: "Sobre o Método Fiaes®:" } });
  fireEvent.change(screen.getByLabelText("Opção 1 do submenu"), { target: { value: "Primeira avaliação" } });
  fireEvent.change(screen.getByLabelText("Opção 2 do submenu"), { target: { value: "Já sou cliente" } });
  fireEvent.click(screen.getByRole("button", { name: "Configurar a opção 2.1" }));
  expect(screen.getByRole("heading", { name: "O que acontece quando ela escolhe Primeira avaliação?" })).toBeTruthy();
  expect(within(panel()).queryByRole("checkbox", { name: "Abrir outro menu" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
  await waitFor(() => expect(save).toHaveBeenCalled());
  const sub = (save.mock.calls[0][0] as { options: { submenu: unknown }[] }).options[1].submenu;
  expect(sub).toEqual({ intro: "Sobre o Método Fiaes®:", options: [
    { label: "Primeira avaliação", tag: null, reply: null, passTo: null, submenu: null },
    { label: "Já sou cliente", tag: null, reply: null, passTo: null, submenu: null },
  ] });
});

it("Testar como cliente: usa o menu da tela, entra no submenu e não envia nada", () => {
  ed({ ...OLD, options: [OLD.options[0], { label: "Método Fiaes®", tag: null, submenu: { intro: "Sobre o Método Fiaes®:", options: [{ label: "Primeira avaliação", tag: "Avaliação" }, { label: "Já sou cliente", tag: null }] } } as never] });
  const t = within(screen.getByRole("region", { name: "Testar como cliente" }));
  expect(t.getByText(/1\. Agendar horário/)).toBeTruthy();
  const send = (v: string) => { fireEvent.change(t.getByLabelText("Ela escreve"), { target: { value: v } }); fireEvent.click(t.getByRole("button", { name: "Testar" })); };
  send("tenho 2 filhas");
  expect(t.getByText("Não é uma escolha: a equipe atende.")).toBeTruthy();
  send("2️⃣");
  expect(t.getByText(/1\. Primeira avaliação/)).toBeTruthy();
  send("1");
  expect(t.getByText("Escolheu: Método Fiaes® › Primeira avaliação")).toBeTruthy();
  expect(t.getByText("Etiqueta “Avaliação”")).toBeTruthy();
  expect(save).not.toHaveBeenCalled();
});

it("saudação tem o botão Usar o texto sugerido", () => {
  ed({ ...OLD, intro: "" });
  fireEvent.click(screen.getByRole("button", { name: "Usar o texto sugerido" }));
  expect((screen.getByLabelText("Saudação") as HTMLTextAreaElement).value).toMatch(/Casa Fiaes/);
});
