// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { sendMessageAction } = vi.hoisted(() => ({ sendMessageAction: vi.fn(async (..._a: unknown[]) => ({ ok: true as const, data: { waitedSeconds: null } })) }));
vi.mock("@/app/(app)/funil/actions", () => ({ sendMessageAction, sendMediaAction: vi.fn() }));
vi.mock("@/app/(app)/conversa/actions", () => ({ addNoteAction: vi.fn(), scheduleMessageAction: vi.fn(), sendQuickReplyAction: vi.fn() }));
import { Composer } from "./composer";

afterEach(() => { cleanup(); vi.clearAllMocks(); });
const replies = [{ id: "q1", label: "confirma", body: "Oi, {primeiro_nome}! Confirmando {data_horario} com {profissional}." }];
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pick = async () => {
  const field = screen.getByLabelText("Mensagem");
  fireEvent.change(field, { target: { value: "/conf" } });
  fireEvent.click(screen.getByRole("button", { name: /\/confirma/ }));
  await wait(500); // o campo não envia nos 450 ms depois de preencher (tempo de revisar)
  return field as HTMLTextAreaElement;
};

describe("respostas prontas com variáveis no campo", () => {
  it("sem horário marcado, o texto cru nunca sai: o envio é bloqueado", async () => {
    render(<Composer dealId="d1" firstName="Maria" quickReplies={replies} onOptimistic={() => {}} vars={{ primeiroNome: "Maria", dataHorario: null, profissional: null }} />);
    const field = await pick();
    expect(field.value).toBe("Oi, Maria! Confirmando {data_horario} com {profissional}.");
    fireEvent.keyDown(field, { key: "Enter" });
    await wait(50);
    expect(sendMessageAction).not.toHaveBeenCalled();
  });
  it("com horário e profissional, sai preenchida", async () => {
    render(<Composer dealId="d1" firstName="Maria" quickReplies={replies} onOptimistic={() => {}} vars={{ primeiroNome: "Maria", dataHorario: "qui 22/10 às 15:00", profissional: "Maiara" }} />);
    const field = await pick();
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(sendMessageAction).toHaveBeenCalledWith("d1", "Oi, Maria! Confirmando qui 22/10 às 15:00 com Maiara.", null));
  });
});

describe("Mandar parabéns (Hoje)", () => {
  it("só PREENCHE o campo com a resposta 'aniversario' (com o nome); nada é enviado", async () => {
    const r = [{ id: "a1", label: "aniversario", body: "Feliz aniversário, {primeiro_nome}! 🎉" }];
    render(<Composer dealId="d1" firstName="Maria" quickReplies={r} onOptimistic={() => {}} vars={{ primeiroNome: "Maria", dataHorario: null, profissional: null }} prefillReply="aniversario" />);
    const field = screen.getByLabelText("Mensagem") as HTMLTextAreaElement;
    await waitFor(() => expect(field.value).toBe("Feliz aniversário, Maria! 🎉"));
    await wait(50);
    expect(sendMessageAction).not.toHaveBeenCalled();
  });
  it("sem a resposta cadastrada, preenche um parabéns padrão", async () => {
    render(<Composer dealId="d1" firstName="Maria" quickReplies={[]} onOptimistic={() => {}} vars={{ primeiroNome: "Maria", dataHorario: null, profissional: null }} prefillReply="aniversario" />);
    const field = screen.getByLabelText("Mensagem") as HTMLTextAreaElement;
    await waitFor(() => expect(field.value).toContain("Feliz aniversário, Maria!"));
  });
  it("a conversa ainda carregando: quando a resposta chega, troca o padrão por ela (se ninguém mexeu no campo)", async () => {
    const vars = { primeiroNome: "Maria", dataHorario: null, profissional: null };
    const { rerender } = render(<Composer dealId="d1" firstName="Maria" quickReplies={[]} onOptimistic={() => {}} prefillReply="aniversario" />);
    rerender(<Composer dealId="d1" firstName="Maria" quickReplies={[{ id: "a1", label: "aniversario", body: "Parabéns, {primeiro_nome}!" }]} onOptimistic={() => {}} vars={vars} prefillReply="aniversario" />);
    const field = screen.getByLabelText("Mensagem") as HTMLTextAreaElement;
    await waitFor(() => expect(field.value).toBe("Parabéns, Maria!"));
  });
});
