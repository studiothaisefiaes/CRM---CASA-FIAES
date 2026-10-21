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
