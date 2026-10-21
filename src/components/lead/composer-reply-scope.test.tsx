// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const { sendMessageAction, createQuickReplyAction, updateQuickReplyAction } = vi.hoisted(() => ({
  sendMessageAction: vi.fn(async (..._a: unknown[]) => ({ ok: true as const, data: { waitedSeconds: null } })),
  createQuickReplyAction: vi.fn(async (..._a: unknown[]) => ({ ok: true as const, data: { id: "novo" } })),
  updateQuickReplyAction: vi.fn(async (..._a: unknown[]) => ({ ok: true as const })),
}));
vi.mock("@/app/(app)/funil/actions", () => ({ sendMessageAction, sendMediaAction: vi.fn() }));
vi.mock("@/app/(app)/conversa/actions", () => ({ addNoteAction: vi.fn(), scheduleMessageAction: vi.fn(), sendQuickReplyAction: vi.fn(), createQuickReplyAction, updateQuickReplyAction }));
import { Composer } from "./composer";

afterEach(() => { cleanup(); vi.clearAllMocks(); });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const replies = [
  { id: "q1", label: "confirma", body: "{saudacao}, {primeiro_nome}! Confirmando {data_horario}." },
  { id: "q2", label: "meu-jeito", body: "Aqui é a {meu_nome} 😊", mine: true },
];
const vars = { primeiroNome: "Maria", dataHorario: null, profissional: null, servico: "Corte", meuNome: "Sara" };
const slash = (v = "/") => fireEvent.change(screen.getByLabelText("Mensagem"), { target: { value: v } });

describe("respostas prontas: selo, campo para variável sem dado e criar pela conversa", () => {
  it("a minha aparece com o selo Minha; a universal não", () => {
    render(<Composer dealId="d1" firstName="Maria" quickReplies={replies} onOptimistic={() => {}} vars={vars} />);
    slash();
    expect(within(screen.getByRole("button", { name: /\/meu-jeito/ })).getByText("Minha")).toBeTruthy();
    expect(within(screen.getByRole("button", { name: /\/confirma/ })).queryByText("Minha")).toBeNull();
  });

  it("variável sem dado vira campo: preencher troca no texto e só então envia", async () => {
    render(<Composer dealId="d1" firstName="Maria" quickReplies={replies} onOptimistic={() => {}} vars={vars} />);
    slash("/conf");
    fireEvent.click(screen.getByRole("button", { name: /\/confirma/ }));
    await wait(500);
    const field = screen.getByLabelText("Mensagem") as HTMLTextAreaElement;
    fireEvent.keyDown(field, { key: "Enter" });
    await wait(30);
    expect(sendMessageAction).not.toHaveBeenCalled();
    const input = screen.getByLabelText("Preencher data e horário");
    fireEvent.change(input, { target: { value: "sáb 24/10 às 10:30" } });
    fireEvent.click(screen.getByRole("button", { name: "Preencher" }));
    expect(field.value).toMatch(/Confirmando sáb 24\/10 às 10:30\.$/);
    expect(screen.queryByLabelText("Preencher data e horário")).toBeNull();
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(sendMessageAction).toHaveBeenCalledWith("d1", expect.stringMatching(/Maria! Confirmando sáb 24\/10 às 10:30\.$/), null));
  });

  it("nova resposta pela conversa: botões de variável, prévia com os dados da cliente e “Só minha” para quem não é gestão", async () => {
    const onRepliesChanged = vi.fn();
    render(<Composer dealId="d1" firstName="Maria" quickReplies={replies} onOptimistic={() => {}} vars={vars} onRepliesChanged={onRepliesChanged} />);
    slash();
    fireEvent.click(screen.getByRole("button", { name: "Nova resposta pronta" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Atalho"), { target: { value: "Oi Rapido" } });
    const body = within(dialog).getByLabelText("Texto da resposta") as HTMLTextAreaElement;
    fireEvent.change(body, { target: { value: "Oi, " } });
    body.setSelectionRange(4, 4);
    fireEvent.click(within(dialog).getByRole("button", { name: "Primeiro nome" }));
    expect(body.value).toBe("Oi, {primeiro_nome}");
    expect(within(dialog).getByTestId("previa-resposta").textContent).toBe("Oi, Maria");
    const universal = within(dialog).getByLabelText(/Universal/) as HTMLInputElement;
    expect(universal.disabled).toBe(true);
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar resposta" }));
    await waitFor(() => expect(createQuickReplyAction).toHaveBeenCalledWith({ label: "Oi Rapido", body: "Oi, {primeiro_nome}", scope: "minha", folder: null }));
    await waitFor(() => expect(onRepliesChanged).toHaveBeenCalled());
  });

  it("a gestão escolhe Universal", async () => {
    render(<Composer dealId="d1" firstName="Maria" quickReplies={replies} onOptimistic={() => {}} vars={vars} canShareReplies />);
    slash();
    fireEvent.click(screen.getByRole("button", { name: "Nova resposta pronta" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Atalho"), { target: { value: "geral" } });
    fireEvent.change(within(dialog).getByLabelText("Texto da resposta"), { target: { value: "Olá!" } });
    fireEvent.click(within(dialog).getByLabelText(/Universal/));
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar resposta" }));
    await waitFor(() => expect(createQuickReplyAction).toHaveBeenCalledWith({ label: "geral", body: "Olá!", scope: "universal", folder: null }));
  });

  it("a minha se edita pela lista do /", async () => {
    render(<Composer dealId="d1" firstName="Maria" quickReplies={replies} onOptimistic={() => {}} vars={vars} />);
    slash();
    fireEvent.click(screen.getByRole("button", { name: "Editar resposta meu-jeito" }));
    const dialog = await screen.findByRole("dialog");
    const body = within(dialog).getByLabelText("Texto da resposta");
    expect((body as HTMLTextAreaElement).value).toBe("Aqui é a {meu_nome} 😊");
    expect(within(dialog).getByTestId("previa-resposta").textContent).toBe("Aqui é a Sara 😊");
    fireEvent.change(body, { target: { value: "Aqui é a {meu_nome}!" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar resposta" }));
    await waitFor(() => expect(updateQuickReplyAction).toHaveBeenCalledWith("q2", { label: "meu-jeito", body: "Aqui é a {meu_nome}!" }));
  });
});
