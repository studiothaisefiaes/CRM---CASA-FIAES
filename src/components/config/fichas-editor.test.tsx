// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const save = vi.fn(async (..._a: unknown[]) => ({ ok: true as const, data: { id: "n" } }));
const move = vi.fn(async (..._a: unknown[]) => ({ ok: true as const }));
const active = vi.fn(async (..._a: unknown[]) => ({ ok: true as const }));
vi.mock("@/app/(app)/config/fichas/actions", () => ({
  saveQuestionAction: (...a: unknown[]) => save(...a), moveQuestionAction: (...a: unknown[]) => move(...a), setQuestionActiveAction: (...a: unknown[]) => active(...a),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }), usePathname: () => "/config/fichas" }));
import { FichasEditor } from "./fichas-editor";
import { ToastProvider } from "@/components/ui/toast";

afterEach(() => { cleanup(); vi.clearAllMocks(); });
const QS = [
  { id: "q1", label: "Como é sua rotina?", kind: "opcao" as const, options: ["Corrida", "Tranquila"], active: true },
  { id: "q2", label: "Você já utilizou:", kind: "caixas" as const, options: ["Coloração", "Outro"], active: false },
];
const ui = (on = true) => render(<ToastProvider><FichasEditor form="anamnese" questions={QS} fichasOn={on} /></ToastProvider>);

it("mostra as três fichas e a lista; sobe, desce e põe em uso", async () => {
  ui();
  expect(screen.getAllByRole("link").map((a) => a.textContent)).toEqual(["Anamnese", "Consultoria de imagem", "Campos da ficha"]);
  expect((screen.getByRole("button", { name: "Subir Como é sua rotina?" }) as HTMLButtonElement).disabled).toBe(true);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Descer Como é sua rotina?" })); });
  expect(move).toHaveBeenCalledWith("q1", "down");
  await act(async () => { fireEvent.click(screen.getByRole("switch", { name: "Pôr em uso: Você já utilizou:" })); });
  expect(active).toHaveBeenCalledWith("q2", true);
});
it("nova pergunta: opções só aparecem para opção e caixas, uma por linha", async () => {
  ui();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Nova pergunta" })); });
  expect(screen.queryByLabelText("Opções")).toBeNull();
  fireEvent.change(screen.getByLabelText("Pergunta"), { target: { value: "Cor favorita" } });
  fireEvent.change(screen.getByLabelText("Tipo de resposta"), { target: { value: "caixas" } });
  fireEvent.change(screen.getByLabelText("Opções"), { target: { value: "Azul\nVerde" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Salvar" })); });
  expect(save).toHaveBeenCalledWith({ id: undefined, form: "anamnese", label: "Cor favorita", kind: "caixas", options: ["Azul", "Verde"] });
});
it("função desligada: avisa e trava", () => {
  ui(false);
  expect(screen.getByRole("note")).toBeTruthy();
  expect((screen.getByRole("button", { name: "Nova pergunta" }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("switch", { name: "Tirar de uso: Como é sua rotina?" }) as HTMLButtonElement).disabled).toBe(true);
});
it("pergunta com respostas: o tipo fica travado com a explicação", async () => {
  render(<ToastProvider><FichasEditor form="anamnese" questions={[{ ...QS[0], answered: true }]} fichasOn /></ToastProvider>);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Editar Como é sua rotina?" })); });
  expect((screen.getByLabelText("Tipo de resposta") as HTMLSelectElement).disabled).toBe(true);
  expect(screen.getByText("Essa pergunta já tem respostas. Crie uma nova e tire esta de uso.")).toBeTruthy();
});
