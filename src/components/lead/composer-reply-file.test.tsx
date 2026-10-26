// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { sendMessageAction, sendQuickReplyAction } = vi.hoisted(() => ({
  sendMessageAction: vi.fn(async (..._a: unknown[]) => ({ ok: true as const, data: { waitedSeconds: null } })),
  sendQuickReplyAction: vi.fn(async (..._a: unknown[]) => ({ ok: true as const, data: { waitedSeconds: null } })),
}));
vi.mock("@/app/(app)/funil/actions", () => ({ sendMessageAction, sendMediaAction: vi.fn() }));
vi.mock("@/app/(app)/conversa/actions", () => ({ addNoteAction: vi.fn(), scheduleMessageAction: vi.fn(), sendQuickReplyAction }));
import { Composer } from "./composer";
import { offerDraft } from "./composer-draft";
import { act } from "@testing-library/react";

afterEach(() => { cleanup(); vi.clearAllMocks(); });
const replies = [{ id: "q1", label: "tabela", body: "Segue a tabela, {primeiro_nome}!", folder: "Preços", attachment: { name: "tabela.pdf", kind: "document" } }];
const vars = { primeiroNome: "Maria", dataHorario: null, profissional: null };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const choose = async () => {
  const field = screen.getByLabelText("Mensagem");
  fireEvent.change(field, { target: { value: "/pre" } }); // acha pela pasta
  const opt = screen.getByRole("button", { name: /Preços · Tabela \/tabela/ });
  expect(opt.textContent).toContain("📎 tabela.pdf");
  fireEvent.click(opt);
  await wait(500);
  return field;
};

describe("resposta pronta com anexo no campo", () => {
  it("escolher leva o arquivo junto e envia pela resposta pronta", async () => {
    render(<Composer dealId="d1" firstName="Maria" quickReplies={replies} onOptimistic={() => {}} vars={vars} />);
    const field = await choose();
    expect(screen.getByRole("group", { name: "Arquivo da resposta pronta" }).textContent).toContain("tabela.pdf");
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(sendQuickReplyAction).toHaveBeenCalledWith({ dealId: "d1", replyId: "q1", text: "Segue a tabela, Maria!" }));
    expect(sendMessageAction).not.toHaveBeenCalled();
  });
  it("tirar o arquivo manda só o texto", async () => {
    render(<Composer dealId="d1" firstName="Maria" quickReplies={replies} onOptimistic={() => {}} vars={vars} />);
    const field = await choose();
    fireEvent.click(screen.getByRole("button", { name: "Não enviar o arquivo" }));
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(sendMessageAction).toHaveBeenCalledWith("d1", "Segue a tabela, Maria!", null));
    expect(sendQuickReplyAction).not.toHaveBeenCalled();
  });
});

describe("foto e vídeo vão com o texto como legenda (24/10)", () => {
  it("a prévia diz que o texto vai como legenda embaixo do vídeo; PDF continua depois do texto", async () => {
    const video = [{ id: "q2", label: "metodo", body: "Assista!", folder: null, attachment: { name: "metodo.mp4", kind: "video" } }];
    render(<Composer dealId="d1" firstName="Maria" quickReplies={video} onOptimistic={() => {}} vars={vars} />);
    fireEvent.change(screen.getByLabelText("Mensagem"), { target: { value: "/metodo" } });
    fireEvent.click(screen.getByRole("button", { name: /\/metodo/ }));
    await wait(500);
    expect(screen.getByRole("group", { name: "Arquivo da resposta pronta" }).textContent).toContain("o texto vai como legenda, embaixo");
    cleanup();
    render(<Composer dealId="d1" firstName="Maria" quickReplies={replies} onOptimistic={() => {}} vars={vars} />);
    await choose();
    expect(screen.getByRole("group", { name: "Arquivo da resposta pronta" }).textContent).toContain("vai junto, depois do texto");
  });

  it("sugestão da IA com vídeo: o texto chega na caixa com o anexo preso e só sai no Enviar, pela resposta pronta", async () => {
    render(<Composer dealId="d5" firstName="Maria" quickReplies={[]} onOptimistic={() => {}} vars={vars} />);
    act(() => offerDraft("d5", "Assista ao vídeo do Método!", { replyFile: { replyId: "q9", name: "metodo.mp4", kind: "video" } }));
    const field = screen.getByLabelText("Mensagem") as HTMLTextAreaElement;
    expect(field.value).toBe("Assista ao vídeo do Método!");
    expect(screen.getByRole("group", { name: "Arquivo da resposta pronta" }).textContent).toContain("metodo.mp4");
    expect(sendQuickReplyAction).not.toHaveBeenCalled();
    await wait(500);
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(sendQuickReplyAction).toHaveBeenCalledWith({ dealId: "d5", replyId: "q9", text: "Assista ao vídeo do Método!" }));
    expect(sendMessageAction).not.toHaveBeenCalled();
  });

  it("outra sugestão SEM vídeo (ou o link de confirmação) troca o texto e solta o vídeo: ele não vai com um texto que não é dele", async () => {
    render(<Composer dealId="d6" firstName="Maria" quickReplies={[]} onOptimistic={() => {}} vars={vars} />);
    act(() => offerDraft("d6", "Assista ao vídeo do Método!", { replyFile: { replyId: "q9", name: "metodo.mp4", kind: "video" } }));
    expect(screen.getByRole("group", { name: "Arquivo da resposta pronta" })).toBeTruthy();
    act(() => offerDraft("d6", "Oi, Maria! O horário de quinta está confirmado."));
    // (a saída é animada: espera o cartão sumir)
    await waitFor(() => expect(screen.queryByRole("group", { name: "Arquivo da resposta pronta" })).toBeNull());
    await wait(500);
    fireEvent.keyDown(screen.getByLabelText("Mensagem"), { key: "Enter" });
    await waitFor(() => expect(sendMessageAction).toHaveBeenCalledWith("d6", "Oi, Maria! O horário de quinta está confirmado.", null));
    expect(sendQuickReplyAction).not.toHaveBeenCalled();
  });
});
